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
const callWeb = async (operation, value) =>
  JSON.parse(
    await psql(`SELECT otl.townhall_event_web_execute('${operation}',
      convert_from(decode('${payload(value)}','base64'),'UTF8')::jsonb)`),
  );
const callLifecycle = async (operation, value) =>
  JSON.parse(
    await psql(`SELECT otl.townhall_event_lifecycle_execute('${operation}',
      convert_from(decode('${payload(value)}','base64'),'UTF8')::jsonb)`),
  );
const callSeries = async (operation, value) =>
  JSON.parse(
    await psql(`SELECT otl.townhall_event_series_execute('${operation}',
      convert_from(decode('${payload(value)}','base64'),'UTF8')::jsonb)`),
  );
const callFollowup = async (operation, value) =>
  JSON.parse(
    await psql(`SELECT otl.townhall_event_followup_execute('${operation}',
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
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 76)
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
  assert.equal(created.event.goingCount, 1);
  assert.equal(created.event.viewerState, "going");
  assert.equal(await call("bind", { ...base, messageTs: "2000.000001" }), true);
  assert.deepEqual((await callSeries("get", base)).participants, [
    { userId: "UHOST", state: "going" },
  ]);
  const hostInterestAttempt = await callLifecycle("interest", {
    ...base, active: true, source: "button", now: "2026-10-02T00:00:00Z",
  });
  assert.equal(hostInterestAttempt.viewerState, "going");
  assert.equal(hostInterestAttempt.goingCount, 1);
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
  assert.equal(await call("bind", { ...base, eventId: "VFLEXIBLE", messageTs: "2001.000001" }), true);
  const configured = await callWeb("configure", {
    ...base,
    eventId: "VFLEXIBLE",
    startDate: "2026-10-20",
    endDate: "2026-10-21",
    dayStart: "18:00",
    dayEnd: "20:00",
    stepMinutes: 60,
  });
  assert.equal(configured.options.length, 4);
  assert.deepEqual(configured.poll, {
    startDate: "2026-10-20",
    endDate: "2026-10-21",
    dayStart: "18:00",
    dayEnd: "20:00",
    stepMinutes: 60,
    timezone: "Asia/Seoul",
  });
  const webVote = await callWeb("vote", {
    ...base,
    eventId: "VFLEXIBLE",
    actorId: "UONE",
    selected: configured.options.slice(0, 2).map((option) => option.startsAt),
  });
  assert.deepEqual(webVote.options.map((option) => option.votes), [1, 1, 0, 0]);
  await assert.rejects(callWeb("configure", {
    ...base,
    eventId: "VFLEXIBLE",
    actorId: "UOTHER",
    startDate: "2026-10-20",
    endDate: "2026-10-21",
    dayStart: "18:00",
    dayEnd: "20:00",
    stepMinutes: 60,
  }));
  await callLifecycle("configure", {
    ...base, eventId: "VFLEXIBLE", eventKind: "gathering", minConfirmed: 2,
    capacity: 4, recruitmentDeadline: "2026-10-19T09:00:00Z", graceHours: 24,
    autoCancel: true, now: "2026-10-02T00:00:00Z",
  });
  const durationConfigured = await callSeries("configure", {
    ...base, eventId: "VFLEXIBLE", recurrenceEveryWeeks: 1,
    occurrenceCount: 4, durationMinutes: 120,
  });
  assert.equal(durationConfigured.durationMinutes, 120);
  const finalized = await callLifecycle("finalize", {
    ...base, eventId: "VFLEXIBLE", startsAt: configured.options[0].startsAt,
    now: "2026-10-02T00:01:00Z",
  });
  assert.equal(finalized.phase, "confirmed");
  assert.equal(finalized.goingCount, 2);

  await call("create", { ...base, eventId: "VCANCEL", activity: "번개", location: "미정", options: [] });
  await call("bind", { ...base, eventId: "VCANCEL", messageTs: "2002.000001" });
  await callLifecycle("configure", { ...base, eventId: "VCANCEL", eventKind: "gathering",
    minConfirmed: 3, capacity: null, recruitmentDeadline: "2026-10-02T00:00:00Z",
    graceHours: 24, autoCancel: true, now: "2026-10-01T00:00:00Z" });
  const pendingCancel = await callLifecycle("due", { teamId: "TQA", channelId: "CTOWN",
    actorId: "UADMIN", now: "2026-10-02T00:01:00Z" });
  assert.equal(pendingCancel.find((event) => event.eventId === "VCANCEL").phase, "cancel_pending");
  const cancelled = await callLifecycle("due", { teamId: "TQA", channelId: "CTOWN",
    actorId: "UADMIN", now: "2026-10-03T00:02:00Z" });
  assert.equal(cancelled.find((event) => event.eventId === "VCANCEL").phase, "cancelled");

  await call("create", { ...base, eventId: "VSERIES", activity: "매주 독서", location: "온라인", options: [] });
  await call("bind", { ...base, eventId: "VSERIES", messageTs: "2003.000001" });
  const seriesGrid = await callWeb("configure", { ...base, eventId: "VSERIES",
    startDate: "2026-10-20", endDate: "2026-10-20", dayStart: "19:00", dayEnd: "20:00", stepMinutes: 60 });
  await callLifecycle("configure", { ...base, eventId: "VSERIES", eventKind: "series",
    minConfirmed: 2, capacity: 10, recruitmentDeadline: null, graceHours: 24,
    autoCancel: false, now: "2026-10-02T00:00:00Z" });
  const seriesConfigured = await callSeries("configure", { ...base, eventId: "VSERIES",
    recurrenceEveryWeeks: 1, occurrenceCount: 4, durationMinutes: 120 });
  assert.deepEqual(seriesConfigured.series.occurrences, []);
  await callLifecycle("finalize", { ...base, eventId: "VSERIES",
    startsAt: seriesGrid.options[0].startsAt, now: "2026-10-02T00:01:00Z" });
  const seriesFinal = await callSeries("finalize", { ...base, eventId: "VSERIES" });
  assert.equal(seriesFinal.series.recurrenceEveryWeeks, 1);
  assert.equal(seriesFinal.series.occurrenceCount, 4);
  assert.equal(seriesFinal.series.occurrences.length, 4);
  assert.equal(seriesFinal.durationMinutes, 120);
  assert.equal(Date.parse(seriesFinal.finalEndAt) - Date.parse(seriesFinal.finalStartAt), 120 * 60 * 1000);
  assert.equal(Date.parse(seriesFinal.series.occurrences[1].startsAt) - Date.parse(seriesFinal.series.occurrences[0].startsAt), 7 * 24 * 60 * 60 * 1000);
  assert.equal(await callFollowup("get", { ...base, eventId: "VSERIES" }), null);
  assert.equal(await callFollowup("put", { ...base, eventId: "VSERIES",
    scheduledMessageId: "Q123", postAt: "2026-10-20T12:15:00Z" }), true);
  assert.equal((await callFollowup("get", { ...base, eventId: "VSERIES" })).scheduledMessageId, "Q123");
  console.log(
    "PASS townhall event PostgreSQL: host inclusion, duration, flexible grid, RSVP, grace, cancellation, and recurring series",
  );
} finally {
  if (started)
    await run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
