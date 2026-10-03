import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const pgBin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const temp = await mkdtemp(join(tmpdir(), "otl-open-maintainers-"));
const data = join(temp, "data"), socket = join(temp, "socket");
const port = String(60000 + Math.floor(Math.random() * 3000));
const environment = { ...process.env, PGHOST: socket, PGPORT: port, PGDATABASE: "maintainers" };
let started = false;
const run = (bin, args) => exec(bin, args, { cwd: root, env: environment, encoding: "utf8" });
const psql = async (sql) =>
  (await run(join(pgBin, "psql"), ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql])).stdout.trim();
const payload = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const call = async (fn, value) => JSON.parse(await psql(
  `SELECT otl.${fn}(convert_from(decode('${payload(value)}','base64'),'UTF8')::jsonb)`,
));
const callOp = async (fn, operation, value) => JSON.parse(await psql(
  `SELECT otl.${fn}('${operation}',convert_from(decode('${payload(value)}','base64'),'UTF8')::jsonb)`,
));
try {
  await run("mkdir", ["-p", socket]);
  await run(join(pgBin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await run(join(pgBin, "pg_ctl"), ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-l", join(temp, "postgres.log"), "-w", "start"]);
  started = true;
  await run(join(pgBin, "createdb"), ["maintainers"]);
  const files = (await readdir(join(root, "migrations")))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 68)
    .sort();
  for (const file of files.filter((name) => Number(name.slice(0, 3)) <= 5))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);
  await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "--single-transaction",
    "-f", "migrations/006_normalized_foundation.sql", "-f", "migrations/007_normalized_legacy.sql"]);
  for (const file of files.filter((name) => Number(name.slice(0, 3)) >= 8))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);
  await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f",
    "migrations/078_idempotent_maintainer_activation.sql"]);

  await psql(`INSERT INTO otl.workspaces(team_id) VALUES('TQA');
    INSERT INTO otl.workspace_members(team_id,user_id,display_name,is_bot,is_app_user,slack_deleted)
    VALUES('TQA','UMAIN','Maintainer',false,false,false),('TQA','UADMIN','Founder',false,false,false)`);
  const maintainer = await callOp("community_maintainer_execute", "activate", {
    teamId: "TQA", actorId: "UMAIN",
  });
  assert.equal(maintainer.state, "active");
  assert.equal(maintainer.changed, true);
  const repeatedMaintainer = await callOp("community_maintainer_execute", "activate", {
    teamId: "TQA", actorId: "UMAIN",
  });
  assert.equal(repeatedMaintainer.changed, false);
  assert.equal(repeatedMaintainer.revision, maintainer.revision);
  const insertChange = async (bugId, alias, pr, sha) => psql(`
    INSERT INTO otl.bug_reports(bug_id,team_id,state,revision,packet_revision,public_alias,reporter_id,
      source,source_opaque_ref,title) VALUES('${bugId}','TQA','merge_eligible',1,1,'${alias}','UMAIN',
      'slack','opaque:${bugId}','Maintainer change');
    INSERT INTO otl.git_changes(bug_id,branch,commit_sha,pr_number)
      VALUES('${bugId}','feedback/test-${pr}','${sha}',${pr})`);
  const openSha = "a".repeat(40), digest = "b".repeat(64);
  await insertChange("BUG-OPEN0001", "B-OPENMAINT001", 101, openSha);
  await call("bug_runner_classify_change", { teamId: "TQA", prNumber: 101, headSha: openSha,
    changeClass: "open", changedPaths: ["src/community-townhall-events.ts"], classificationDigest: digest });
  const context = await call("bug_merge_approval_context", { teamId: "TQA", bugId: "BUG-OPEN0001",
    actorId: "UMAIN", packetRevision: 1, prNumber: 101 });
  assert.deepEqual({ changeClass: context.changeClass, maintainer: context.maintainer },
    { changeClass: "open", maintainer: true });
  const openApproved = await call("bug_actor_approve_merge", { teamId: "TQA", bugId: "BUG-OPEN0001",
    actorId: "UMAIN", founderId: "UADMIN", packetRevision: 1, prNumber: 101, headSha: openSha,
    classificationDigest: digest, idempotencyKey: "approve-open" });
  assert.equal(openApproved.approvedRole, "maintainer");

  const coreSha = "c".repeat(40), coreDigest = "d".repeat(64);
  await insertChange("BUG-CORE0001", "B-COREMAINT001", 102, coreSha);
  await call("bug_runner_classify_change", { teamId: "TQA", prNumber: 102, headSha: coreSha,
    changeClass: "core", changedPaths: ["src/community-runtime.ts"], classificationDigest: coreDigest });
  await assert.rejects(call("bug_actor_approve_merge", { teamId: "TQA", bugId: "BUG-CORE0001",
    actorId: "UMAIN", founderId: "UADMIN", packetRevision: 1, prNumber: 102, headSha: coreSha,
    classificationDigest: coreDigest, idempotencyKey: "reject-core" }));
  const coreApproved = await call("bug_actor_approve_merge", { teamId: "TQA", bugId: "BUG-CORE0001",
    actorId: "UADMIN", founderId: "UADMIN", packetRevision: 1, prNumber: 102, headSha: coreSha,
    classificationDigest: coreDigest, idempotencyKey: "approve-core" });
  assert.equal(coreApproved.approvedRole, "founder");
  console.log("PASS open maintainers: self-activation, open self-approval, core founder approval, SHA binding");
} finally {
  if (started) await run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
