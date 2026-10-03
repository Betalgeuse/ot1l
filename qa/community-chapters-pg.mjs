import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const pgBin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const temp = await mkdtemp(join(tmpdir(), "otl-community-chapters-"));
const data = join(temp, "data"), socket = join(temp, "socket");
const port = String(63000 + Math.floor(Math.random() * 1500));
const environment = { ...process.env, PGHOST: socket, PGPORT: port, PGDATABASE: "chapters" };
let started = false;
const run = (bin, args) => exec(bin, args, { cwd: root, env: environment, encoding: "utf8" });
const psql = async (sql) =>
  (await run(join(pgBin, "psql"), ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql])).stdout.trim();
const payload = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const call = async (operation, value) =>
  JSON.parse(await psql(
    `SELECT otl.community_chapter_execute('${operation}',convert_from(decode('${payload(value)}','base64'),'UTF8')::jsonb)`,
  ));

try {
  await run("mkdir", ["-p", socket]);
  await run(join(pgBin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await run(join(pgBin, "pg_ctl"), ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-l", join(temp, "postgres.log"), "-w", "start"]);
  started = true;
  await run(join(pgBin, "createdb"), ["chapters"]);
  const files = (await readdir(join(root, "migrations")))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 79)
    .sort();
  for (const file of files.filter((name) => Number(name.slice(0, 3)) <= 5))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);
  await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "--single-transaction",
    "-f", "migrations/006_normalized_foundation.sql", "-f", "migrations/007_normalized_legacy.sql"]);
  for (const file of files.filter((name) => Number(name.slice(0, 3)) >= 8))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);

  await psql(`INSERT INTO otl.workspaces(team_id) VALUES('TQA');
    INSERT INTO otl.workspace_members(team_id,user_id,display_name,is_bot,is_app_user,slack_deleted)
    VALUES('TQA','UCREATOR','Creator',false,false,false),('TQA','UOTHER','Other',false,false,false)`);
  const request = { teamId: "TQA", actorId: "UCREATOR", slug: "ai-research",
    title: "AI 연구 같이 보기", description: "논문과 실험을 함께 읽고 이야기해요." };
  const created = await call("request", request);
  assert.equal(created.changed, true);
  assert.equal(created.state, "creating");
  assert.equal((await call("request", request)).changed, false);
  await assert.rejects(call("request", { ...request, actorId: "UOTHER" }));
  const active = await call("activate", { teamId: "TQA", actorId: "UCREATOR",
    slug: "ai-research", channelId: "CNEWCHAPTER" });
  assert.equal(active.changed, true);
  assert.equal(active.state, "active");
  assert.equal((await call("activate", { teamId: "TQA", actorId: "UCREATOR",
    slug: "ai-research", channelId: "CNEWCHAPTER" })).changed, false);
  assert.equal(await call("active", { teamId: "TQA", channelId: "CNEWCHAPTER" }), true);
  const announced = await call("mark_announcement", { teamId: "TQA", slug: "ai-research",
    channelId: "CNEWCHAPTER", messageTs: "100.000001" });
  assert.equal(announced.announcementMessageTs, "100.000001");
  const guided = await call("mark_guide", { teamId: "TQA", slug: "ai-research",
    channelId: "CNEWCHAPTER" });
  assert.equal(guided.guideSynced, true);
  const listed = JSON.parse(await psql(
    `SELECT otl.community_chapter_list('{"teamId":"TQA"}'::jsonb)`,
  ));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].channelId, "CNEWCHAPTER");
  assert.equal(await psql(
    `SET ROLE otl_guide_admin; SELECT jsonb_array_length(otl.community_chapter_list('{"teamId":"TQA"}'::jsonb))`,
  ), "1");
  console.log("PASS Chapter PostgreSQL: request, actor binding, activation idempotency, list, announcement, and guide receipt");
} finally {
  if (started) await run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
