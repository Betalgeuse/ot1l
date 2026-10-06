import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const pgBin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const temp = await mkdtemp(join(tmpdir(), "otl-onboarding-"));
const data = join(temp, "data"), socket = join(temp, "socket");
const port = String(65000 + Math.floor(Math.random() * 400));
const environment = { ...process.env, PGHOST: socket, PGPORT: port, PGDATABASE: "onboarding" };
let started = false;
const run = (bin, args) => exec(bin, args, { cwd: root, env: environment, encoding: "utf8" });
const psql = async (sql) =>
  (await run(join(pgBin, "psql"), ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql])).stdout.trim();
const payload = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const call = async (op, value) => JSON.parse(await psql(
  `SELECT otl.member_onboarding_execute('${op}',convert_from(decode('${payload(value)}','base64'),'UTF8')::jsonb)`,
));
try {
  await run("mkdir", ["-p", socket]);
  await run(join(pgBin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await run(join(pgBin, "pg_ctl"), ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-l", join(temp, "postgres.log"), "-w", "start"]);
  started = true;
  await run(join(pgBin, "createdb"), ["onboarding"]);
  const files = (await readdir(join(root, "migrations")))
    .filter((name) => /^\d{3}_.*[.]sql$/.test(name) && Number(name.slice(0, 3)) <= 86)
    .sort();
  for (const file of files.filter((name) => Number(name.slice(0, 3)) <= 5))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);
  await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "--single-transaction",
    "-f", "migrations/006_normalized_foundation.sql", "-f", "migrations/007_normalized_legacy.sql"]);
  for (const file of files.filter((name) => Number(name.slice(0, 3)) >= 8 && Number(name.slice(0, 3)) <= 85))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);
  await psql(`INSERT INTO otl.workspaces(team_id,primary_goal_channel_id) VALUES('TQA',NULL);
    INSERT INTO otl.workspace_channels(team_id,channel_id) VALUES('TQA','CDAILY');
    UPDATE otl.workspaces SET primary_goal_channel_id='CDAILY' WHERE team_id='TQA';
    INSERT INTO otl.workspace_members(team_id,user_id,display_name,is_bot,is_app_user,slack_deleted)
      VALUES('TQA','ULEGACY','Legacy',false,false,false),
        ('TQA','UREPAIRED','Repaired',false,false,false);
    INSERT INTO otl.workspace_channel_memberships(team_id,channel_id,user_id,is_current,last_seen_at,synced_at)
      VALUES('TQA','CDAILY','ULEGACY',true,now(),now());
    INSERT INTO otl.community_records(team_id,channel_id,user_id,record_key,kind,body,status)
      VALUES('TQA','CDAILY','UREPAIRED','introduction-channel-welcome','introduction_welcome','{}','sent')`);
  await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", "migrations/086_durable_member_onboarding.sql"]);

  const base = { teamId: "TQA", channelId: "CDAILY", sourceKind: "reconcile",
    eventId: "reconcile:1", eventTs: "1791283742", displayName: "Member",
    isBot: false, isAppUser: false, deleted: false };
  assert.deepEqual(await call("enqueue", { ...base, userId: "ULEGACY" }), { enqueued: 0, legacy: true });
  assert.deepEqual(await call("enqueue", { ...base, userId: "UREPAIRED" }), { enqueued: 0, legacy: true });
  assert.deepEqual(await call("enqueue", { ...base, userId: "UNEW" }), { enqueued: 4, legacy: false });
  assert.equal(await psql("SELECT count(*) FROM otl.member_onboarding_deliveries WHERE team_id='TQA' AND user_id='UNEW'"), "4");
  assert.equal(await psql("SELECT enabled FROM otl.community_preferences WHERE team_id='TQA' AND channel_id='CDAILY' AND user_id='UNEW'"), "t");

  const lease1 = "11111111-1111-4111-8111-111111111111";
  const first = await call("claim", { teamId: "TQA", userId: "UNEW", workerId: "worker", leaseToken: lease1, now: "2030-10-06T11:00:00.000Z" });
  assert.equal(first.kind, "guide");
  assert.equal(await call("finish", { teamId: "TQA", userId: "UNEW", kind: "guide",
    leaseToken: lease1, status: "failed", errorCode: "SlackError", now: "2030-10-06T11:00:00.000Z" }), true);
  const lease2 = "22222222-2222-4222-8222-222222222222";
  const retried = await call("claim", { teamId: "TQA", userId: "UNEW", workerId: "worker", leaseToken: lease2, now: "2030-10-06T11:02:00.000Z" });
  assert.equal(retried.kind, "guide");
  assert.equal(retried.attempt, 2);
  assert.equal(await call("finish", { teamId: "TQA", userId: "UNEW", kind: "guide",
    leaseToken: lease2, status: "sent", now: "2030-10-06T11:02:00.000Z" }), true);

  await psql(`INSERT INTO otl.community_records(team_id,channel_id,user_id,record_key,kind,body,status)
    VALUES('TQA','CDAILY','UNEW','join-card','welcome','{}','failed');
    INSERT INTO otl.workspace_channels(team_id,channel_id) VALUES('TQA','CWELCOME');
    INSERT INTO otl.workspace_members(team_id,user_id,display_name) VALUES('TQA','UADMIN','Admin');
    INSERT INTO otl.guide_versions(team_id,channel_id,content_hash,body,author_id,source_ts,source_edited_ts,
      guide_version,ordered_file_ids,status,published_at,source_origin)
    VALUES('TQA','CWELCOME','${"a".repeat(64)}','Guide','UADMIN',NULL,NULL,'v1.0.0',
      '["FONE","FTWO"]','published',now(),'repo');
    INSERT INTO otl.guide_deliveries(team_id,channel_id,user_id,content_hash,status,guide_version,delivery_reason)
    VALUES('TQA','CWELCOME','UNEW','${"a".repeat(64)}','failed','v1.0.0','join')`);
  assert.equal(await psql(`SELECT otl.community_retry_failed_record('{"teamId":"TQA","channelId":"CDAILY","userId":"UNEW","key":"join-card"}'::jsonb)`), "t");
  assert.equal(await psql("SELECT status FROM otl.community_records WHERE team_id='TQA' AND user_id='UNEW' AND record_key='join-card'"), "pending");
  assert.equal(await psql(`SELECT otl.guide_runtime_retry_failed('{"teamId":"TQA","channelId":"CWELCOME","userId":"UNEW","version":"v1.0.0","hash":"${"a".repeat(64)}"}'::jsonb)`), "t");
  assert.equal(await psql("SELECT status FROM otl.guide_deliveries WHERE team_id='TQA' AND user_id='UNEW'"), "claimed");
  console.log("PASS onboarding outbox excludes legacy members, retries failures and restores failed card claims");
} finally {
  if (started) await run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
