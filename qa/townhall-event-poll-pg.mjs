import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const pgBin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const temp = await mkdtemp(join(tmpdir(), "otl-townhall-event-"));
const data = join(temp, "data");
const socket = join(temp, "socket");
const port = String(62000 + Math.floor(Math.random() * 2000));
const environment = { ...process.env, PGHOST: socket, PGPORT: port, PGDATABASE: "events" };
let started = false;
const run = (bin, args) => exec(bin, args, { cwd: root, env: environment, encoding: "utf8" });
const psql = async (sql) =>
  (await run(join(pgBin, "psql"), ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql])).stdout.trim();
const payload = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const call = async (operation, value) =>
  JSON.parse(
    await psql(`SELECT otl.townhall_event_execute('${operation}',
      convert_from(decode('${payload(value)}','base64'),'UTF8')::jsonb)`),
  );

try {
  await run("mkdir", ["-p", socket]);
  await run(join(pgBin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await run(join(pgBin, "pg_ctl"), [
    "-D",
    data,
    "-o",
    `-F -k ${socket} -p ${port}`,
    "-l",
    join(temp, "postgres.log"),
    "-w",
    "start",
  ]);
  started = true;
  await run(join(pgBin, "createdb"), ["events"]);
  const files = (await readdir(join(root, "migrations")))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 67)
    .sort();
  for (const file of files.filter((name) => Number(name.slice(0, 3)) <= 5))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);
  await run(join(pgBin, "psql"), [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "--single-transaction",
    "-f",
    "migrations/006_normalized_foundation.sql",
    "-f",
    "migrations/007_normalized_legacy.sql",
  ]);
  for (const file of files.filter((name) => Number(name.slice(0, 3)) >= 8))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);

  const base = {
    teamId: "TQA",
    channelId: "CTOWN",
    actorId: "UHOST",
    eventId: "VEVENT-1",
  };
  const first = "2026-10-10T10:00:00.000Z";
  const second = "2026-10-11T05:00:00.000Z";
  const third = "2026-10-12T11:00:00.000Z";
  const created = await call("create", {
    ...base,
    activity: "산책",
    location: "서울숲",
    options: [first, second],
  });
  assert.equal(created.created, true);
  assert.equal(created.event.options.length, 2);
  assert.equal(await call("bind", { ...base, messageTs: "2000.000001" }), true);
  await call("vote", { ...base, actorId: "UONE", selected: [first, second] });
  const voted = await call("vote", { ...base, actorId: "UTWO", selected: [first] });
  assert.deepEqual(
    voted.options.map((option) => option.votes),
    [2, 1],
  );
  const edited = await call("edit", {
    ...base,
    expectedRevision: 1,
    activity: "저녁 산책",
    location: "뚝섬역",
    options: [first, third],
  });
  assert.equal(edited.revision, 2);
  assert.deepEqual(
    edited.options.map((option) => option.votes),
    [2, 0],
  );
  assert.deepEqual((await call("get", { ...base, actorId: "UONE" })).selected, [
    "2026-10-10T10:00:00Z",
  ]);
  await assert.rejects(
    call("edit", {
      ...base,
      actorId: "UOTHER",
      expectedRevision: 2,
      activity: "위조",
      location: "위조",
      options: [first],
    }),
  );
  const flexible = await call("create", {
    ...base,
    eventId: "VFLEXIBLE",
    activity: "일주일 동안 고전 읽기",
    location: "Townhall 스레드",
    options: [],
  });
  assert.equal(flexible.created, true);
  assert.deepEqual(flexible.event.options, []);
  console.log(
    "PASS townhall event PostgreSQL: flexible events, multi-vote, host-only edit, and surviving-option vote preservation",
  );
} finally {
  if (started)
    await run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
