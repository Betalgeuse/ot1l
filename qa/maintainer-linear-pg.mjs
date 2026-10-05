import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const pgBin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const temp = await mkdtemp(join(tmpdir(), "otl-maintainer-linear-"));
const data = join(temp, "data"), socket = join(temp, "socket");
const port = String(63000 + Math.floor(Math.random() * 1500));
const environment = { ...process.env, PGHOST: socket, PGPORT: port, PGDATABASE: "linear_ops" };
let started = false;
const run = (bin, args) => exec(bin, args, { cwd: root, env: environment, encoding: "utf8" });
const psql = async (sql) =>
  (await run(join(pgBin, "psql"), ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql])).stdout.trim();
const payload = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const call = async (op, value) => JSON.parse(await psql(
  `SELECT otl.maintainer_ops_execute('${op}',convert_from(decode('${payload(value)}','base64'),'UTF8')::jsonb)`,
));
try {
  await run("mkdir", ["-p", socket]);
  await run(join(pgBin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await run(join(pgBin, "pg_ctl"), ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-l", join(temp, "postgres.log"), "-w", "start"]);
  started = true;
  await run(join(pgBin, "createdb"), ["linear_ops"]);
  const files = (await readdir(join(root, "migrations")))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 83)
    .sort();
  for (const file of files.filter((name) => Number(name.slice(0, 3)) <= 5))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);
  await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "--single-transaction",
    "-f", "migrations/006_normalized_foundation.sql", "-f", "migrations/007_normalized_legacy.sql"]);
  for (const file of files.filter((name) => Number(name.slice(0, 3)) >= 8))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);

  await psql(`INSERT INTO otl.workspaces(team_id) VALUES('TQA');
    INSERT INTO otl.workspace_members(team_id,user_id,display_name,is_bot,is_app_user,slack_deleted)
      VALUES('TQA','UADMIN','Founder',false,false,false),('TQA','UA','Alice',false,false,false),('TQA','UB','Bob',false,false,false);
    INSERT INTO otl.community_maintainers(team_id,user_id,state) VALUES('TQA','UA','active'),('TQA','UB','active')`);
  const base = { teamId: "TQA", actorId: "UA", founderId: "UADMIN" };
  const linearTeamId = "b2e0bc66-7bea-466c-b65e-2495e8d3edb9";
  await psql(`INSERT INTO otl.maintainer_linear_members(team_id,user_id,linear_team_id,linear_user_id,state,seat_source)
    VALUES('TQA','UADMIN','${linearTeamId}','99999999-9999-4999-8999-999999999999','linked','existing')`);
  const reserved = await call("member_reserve", { ...base, userId: "UA", linearTeamId, linearUserId: null, seatLimit: 1 });
  assert.equal(reserved.state, "reserved");
  await assert.rejects(call("member_reserve", { ...base, userId: "UB", linearTeamId, linearUserId: null, seatLimit: 1 }));
  await call("member_link", { ...base, userId: "UA", linearTeamId, linearUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const members = await call("members", base);
  assert.deepEqual(members.map((member) => [member.userId, member.linearState]), [["UA", "linked"], ["UB", "not_connected"]]);

  const work = await call("work_put", { ...base, workKey: "BUG-QA", reporterId: "UA", desiredDri: "UA",
    linearTeamId, title: "피드백", actual: "현재", expected: "원하는 상태", workKind: "feedback",
    sourceChannel: "CFEEDBACK", sourceThread: "1.000001" });
  assert.match(work.linear_issue_id, /^[a-f0-9-]{36}$/);
  const synced = await call("work_sync", { ...base, workKey: "BUG-QA", linearTeamId,
    identifier: "OT1-1", url: "https://linear.app/betalgeuse/issue/OT1-1/test", issueState: "작업 중",
    driUserId: "UA", linearUpdatedAt: "2026-10-05T08:00:00.000Z" });
  assert.equal(synced.issue_state, "작업 중");
  const stale = await call("work_sync", { ...base, workKey: "BUG-QA", linearTeamId,
    identifier: "OT1-1", url: "https://linear.app/betalgeuse/issue/OT1-1/test", issueState: "접수됨",
    driUserId: null, linearUpdatedAt: "2026-10-05T07:59:00.000Z" });
  assert.equal(stale.issue_state, "작업 중");
  await call("work_release", { ...base, workKey: "BUG-QA", releaseStage: "운영 반영 완료" });
  assert.equal((await call("work_get", { ...base, workKey: "BUG-QA" })).release_stage, "운영 반영 완료");
  await call("surface_put", { ...base, workKey: "BUG-QA", channelId: "CMAIN", messageTs: "2.000002" });
  assert.equal(await call("surface_get", { ...base, workKey: "BUG-QA", channelId: "CMAIN" }), "2.000002");
  assert.equal(await call("receipt_claim", { ...base, receiptKey: "linear:one" }), true);
  assert.equal(await call("receipt_claim", { ...base, receiptKey: "linear:one" }), false);
  console.log("PASS maintainer Linear store: opt-in seats, idempotent issue identity, stale update guard and receipts");
} finally {
  if (started) await run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
