import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const pgBin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const temp = await mkdtemp(join(tmpdir(), "otl-atomic-common-"));
const data = join(temp, "data");
const socket = join(temp, "socket");
const port = String(59000 + Math.floor(Math.random() * 3000));
const environment = { ...process.env, PGHOST: socket, PGPORT: port, PGDATABASE: "atomic" };
let started = false;
const run = (bin, args) => exec(bin, args, { cwd: root, env: environment, encoding: "utf8" });
const psql = async (sql) =>
  (await run(join(pgBin, "psql"), ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql])).stdout.trim();

try {
  await run("mkdir", ["-p", socket]);
  await run(join(pgBin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await run(join(pgBin, "pg_ctl"), ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-l", join(temp, "postgres.log"), "-w", "start"]);
  started = true;
  await run(join(pgBin, "createdb"), ["atomic"]);
  const files = (await readdir(join(root, "migrations")))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 65)
    .sort();
  for (const file of files.filter((name) => Number(name.slice(0, 3)) <= 5))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);
  await run(join(pgBin, "psql"), [
    "-X", "-v", "ON_ERROR_STOP=1", "--single-transaction",
    "-f", "migrations/006_normalized_foundation.sql",
    "-f", "migrations/007_normalized_legacy.sql",
  ]);
  for (const file of files.filter((name) => Number(name.slice(0, 3)) >= 8))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);

  await psql(`INSERT INTO otl.community_records(team_id,channel_id,user_id,record_key,kind,body)
    VALUES('T-ATOMIC','C-ATOMIC','UADMIN','common:2026-10-03:goal','dispatch',
      '{"date":"2026-10-03","kind":"goal","text":"atomic"}')`);
  const first = JSON.parse(await psql(`SELECT otl.claim_common_delivery_v2(
    '{"teamId":"T-ATOMIC","channelId":"C-ATOMIC","userId":"UADMIN",
      "now":"2026-10-03T01:00:00Z","leaseToken":"atomic-1"}')`));
  assert.equal(first.safeToPost, true);
  const uncertain = JSON.parse(await psql(`SELECT otl.claim_common_delivery_v2(
    '{"teamId":"T-ATOMIC","channelId":"C-ATOMIC","userId":"UADMIN",
      "now":"2026-10-03T01:01:01Z","leaseToken":"atomic-2"}')`));
  assert.equal(uncertain.safeToPost, false);
  assert.equal(await psql(`SELECT otl.finish_common_root(
    '{"teamId":"T-ATOMIC","channelId":"C-ATOMIC","userId":"UADMIN",
      "leaseToken":"atomic-2","date":"2026-10-03","kind":"goal",
      "messageTs":"2000.000001","bindReview":false}')`), "true");
  assert.equal(await psql(`SELECT count(*) FROM otl.community_records WHERE team_id='T-ATOMIC'
    AND ((record_key='common:2026-10-03:goal' AND status='sent' AND body->>'messageTs'='2000.000001')
      OR (record_key='prompt:2000.000001' AND body->>'kind'='goal')
      OR (record_key='common-thread:2026-10-03:goal' AND body->>'ts'='2000.000001'))`), "3");
  console.log("PASS atomic common delivery: uncertain retry cannot post and one receipt commits dispatch plus both roots");
} finally {
  if (started)
    await run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
