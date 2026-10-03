import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile),
  root = resolve(import.meta.dirname, ".."),
  pg = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const temp = await mkdtemp(join(tmpdir(), "otl-demands-")),
  data = join(temp, "data"),
  socket = join(temp, "socket"),
  port = String(64500 + Math.floor(Math.random() * 500));
const env = { ...process.env, PGHOST: socket, PGPORT: port, PGDATABASE: "demands" };
let started = false;
const run = (b, a) => exec(b, a, { cwd: root, env, encoding: "utf8" });
const sql = async (q) =>
  (await run(join(pg, "psql"), ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", q])).stdout.trim();
const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64");
const call = async (op, v) =>
  JSON.parse(
    await sql(
      `SELECT otl.townhall_event_demand_execute('${op}',convert_from(decode('${enc(v)}','base64'),'UTF8')::jsonb)`,
    ),
  );
try {
  await run("mkdir", ["-p", socket]);
  await run(join(pg, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await run(join(pg, "pg_ctl"), [
    "-D",
    data,
    "-o",
    `-F -k ${socket} -p ${port}`,
    "-l",
    join(temp, "pg.log"),
    "-w",
    "start",
  ]);
  started = true;
  await run(join(pg, "createdb"), ["demands"]);
  const files = (await readdir(join(root, "migrations")))
    .filter((n) => /^\d{3}_.*\.sql$/.test(n) && Number(n.slice(0, 3)) <= 80)
    .sort();
  for (const f of files.filter((n) => Number(n.slice(0, 3)) <= 5))
    await run(join(pg, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${f}`]);
  await run(join(pg, "psql"), [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "--single-transaction",
    "-f",
    "migrations/006_normalized_foundation.sql",
    "-f",
    "migrations/007_normalized_legacy.sql",
  ]);
  for (const f of files.filter((n) => Number(n.slice(0, 3)) >= 8))
    await run(join(pg, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${f}`]);
  await sql(
    `INSERT INTO otl.workspaces(team_id) VALUES('TQA');INSERT INTO otl.workspace_channels(team_id,channel_id) VALUES('TQA','CTOWN');INSERT INTO otl.workspace_members(team_id,user_id,display_name,is_bot,is_app_user,slack_deleted) VALUES('TQA','UREQ','Requester',false,false,false),('TQA','UHOST','Host',false,false,false),('TQA','UHOST2','Host2',false,false,false)`,
  );
  const base = { teamId: "TQA", channelId: "CTOWN", actorId: "UREQ", demandId: "DDEMAND1" };
  assert.equal(
    (
      await call("create", {
        ...base,
        mode: "host_request",
        activity: "고전 읽기",
        description: "함께 읽기",
        locationHint: "온라인",
        timingHint: "10월",
      })
    ).status,
    "draft",
  );
  assert.equal((await call("bind", { ...base, messageTs: "100.000001" })).status, "active");
  for (const [eventId, host, ts] of [
    ["VEVENT1", "UHOST", "200.000001"],
    ["VEVENT2", "UHOST2", "201.000001"],
  ]) {
    await sql(
      `INSERT INTO otl.townhall_events(team_id,channel_id,event_id,host_user_id,activity,location,status,message_ts) VALUES('TQA','CTOWN','${eventId}','${host}','고전 읽기','온라인','active','${ts}')`,
    );
    await call("link_event", { ...base, actorId: host, eventId });
  }
  const linked = await call("get", base);
  assert.equal(linked.events.length, 2);
  assert.deepEqual(
    linked.events.map((e) => e.hostUserId),
    ["UHOST", "UHOST2"],
  );
  await assert.rejects(
    call("edit", {
      ...base,
      actorId: "UHOST",
      expectedRevision: 1,
      mode: "validate",
      activity: "위조",
      description: "",
      locationHint: "",
      timingHint: "",
    }),
  );
  const edited = await call("edit", {
    ...base,
    expectedRevision: 1,
    mode: "validate",
    activity: "고전 다시 읽기",
    description: "설명",
    locationHint: "서울",
    timingHint: "11월",
  });
  assert.equal(edited.revision, 2);
  const closed = await call("close", { ...base });
  assert.equal(closed.status, "closed");
  console.log("PASS event demand PostgreSQL: create, bind, two hosts, owner edit, and close");
} finally {
  if (started)
    await run(join(pg, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
