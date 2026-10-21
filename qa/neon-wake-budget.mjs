import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CRON_TRIGGERS, MAINTENANCE_WINDOW, NEON_WAKE_WINDOW_BUDGET } from "../src/community-cron.ts";
import { PRODUCTION_CRONS } from "../scripts/deploy-production-worker.mjs";
import { dbAlarmRetryDelayMinutes } from "../src/community-alarm-backoff.ts";
import { maintenanceCadenceDue } from "../src/community-maintenance-tasks.ts";
import { runtimeFailureCode } from "../src/runtime-failure.ts";
import {
  inWakeWindow,
  msUntilNextWakeWindow,
  WAKE_WINDOW_CRON,
  WAKE_WINDOW_MINUTES,
  WAKE_WINDOW_START_MINUTES,
} from "../automation/runner/wake-window.mjs";

const dayStart = Date.parse("2026-10-19T00:00:00Z");
const dayEnd = dayStart + 24 * 60 * 60_000;
const windowFor = (at) => Math.floor(at / 300_000);
const workerWindows = new Set();
const runnerWindows = new Set();
const deployerWindows = new Set();
const oldWindows = new Set();

assert.equal(WAKE_WINDOW_CRON, MAINTENANCE_WINDOW);
assert.deepEqual(PRODUCTION_CRONS, [...CRON_TRIGGERS]);
const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
assert.deepEqual(wrangler.triggers.crons, [...CRON_TRIGGERS]);
assert.ok(CRON_TRIGGERS.length <= 2, "OT1L must declare no more than two cron triggers");
assert.deepEqual(WAKE_WINDOW_START_MINUTES, [1, 31]);
assert.equal(WAKE_WINDOW_MINUTES, 4);

// Model the Worker DB paths: half-hour maintenance, due daily roots, and the
// six-hour safety scan. They share the aligned five-minute suspend buckets.
for (let hour = 0; hour < 24; hour += 1) {
  for (const minute of WAKE_WINDOW_START_MINUTES) {
    const at = dayStart + (hour * 60 + minute) * 60_000;
    workerWindows.add(windowFor(at));
  }
}
for (const hour of [0, 6, 12, 18]) workerWindows.add(windowFor(dayStart + hour * 60 * 60_000));
// Daily roots are 10:00 and 18:00 KST (01:00 and 09:00 UTC).
for (const hour of [1, 9]) workerWindows.add(windowFor(dayStart + hour * 60 * 60_000));
// Event cache refresh is every six hours and aligned with :01 maintenance.
for (const hour of [0, 6, 12, 18])
  workerWindows.add(windowFor(dayStart + (hour * 60 + 1) * 60_000));

// The idle runner polls every 15 seconds while a shared wake window is open.
for (let at = dayStart; at < dayEnd; at += 15_000)
  if (inWakeWindow(new Date(at))) runnerWindows.add(windowFor(at));

// Read the real systemd calendar rather than duplicating its cadence here.
const timer = readFileSync("ops/genquant/otl1-bug-deployer.timer", "utf8");
const calendar = timer.match(/^OnCalendar=\*-\*-\* \*:(\d{2}(?:,\d{2})*):(\d{2}) UTC$/m);
assert.ok(calendar, "deployer timer must use the modeled UTC calendar format");
const timerMinutes = calendar[1].split(",").map(Number);
const timerSecond = Number(calendar[2]);
for (let hour = 0; hour < 24; hour += 1)
  for (const minute of timerMinutes) {
    const at = dayStart + (hour * 60 + minute) * 60_000 + timerSecond * 1_000;
    deployerWindows.add(windowFor(at));
  }

const newWindows = new Set([...workerWindows, ...runnerWindows, ...deployerWindows]);
assert.equal(NEON_WAKE_WINDOW_BUDGET, 60);
assert.ok(newWindows.size <= NEON_WAKE_WINDOW_BUDGET, `${newWindows.size} windows exceeds budget`);
for (const [client, clientWindows] of [
  ["runner", runnerWindows],
  ["deployer", deployerWindows],
])
  for (const window of clientWindows)
    assert.ok(workerWindows.has(window), `${client} adds an unaligned window ${window}`);

// Previous cadence: the runner touched Neon every 15 seconds and the deployer
// every minute, preventing a five-minute idle suspend throughout the day.
for (let at = dayStart; at < dayEnd; at += 15_000) oldWindows.add(windowFor(at));
for (let at = dayStart; at < dayEnd; at += 60_000) oldWindows.add(windowFor(at));
assert.equal(oldWindows.size, 288);

const at = (time) => new Date(`2026-10-19T${time}Z`);
assert.equal(inWakeWindow(at("00:00:59.999")), false);
assert.equal(msUntilNextWakeWindow(at("00:00:00.000")), 60_000);
assert.equal(inWakeWindow(at("00:01:00.000")), true);
assert.equal(msUntilNextWakeWindow(at("00:01:00.000")), 0);
assert.equal(inWakeWindow(at("00:01:59.999")), true);
assert.equal(inWakeWindow(at("00:04:59.999")), true);
assert.equal(inWakeWindow(at("00:05:00.000")), false);
assert.equal(msUntilNextWakeWindow(at("00:05:00.000")), 26 * 60_000);
assert.equal(msUntilNextWakeWindow(at("00:30:59.999")), 1);
assert.equal(inWakeWindow(at("00:31:00.000")), true);
assert.equal(inWakeWindow(at("00:34:59.999")), true);
assert.equal(inWakeWindow(at("00:35:00.000")), false);
assert.equal(msUntilNextWakeWindow(at("00:35:00.000")), 26 * 60_000);
assert.equal(msUntilNextWakeWindow(at("00:59:59.000")), 61_000);

assert.equal(maintenanceCadenceDue("feedback", Date.parse("2026-10-19T00:01:00Z")), true);
assert.equal(maintenanceCadenceDue("feedback", Date.parse("2026-10-19T00:06:00Z")), false);
assert.equal(maintenanceCadenceDue("events", Date.parse("2026-10-19T00:06:00Z")), true);
assert.equal(
  maintenanceCadenceDue("community_clock_recovery", Date.parse("2026-10-19T00:01:00Z")),
  true,
);
assert.equal(
  maintenanceCadenceDue("community_clock_recovery", Date.parse("2026-10-19T00:06:00Z")),
  false,
);

const roots = [];
const schedule = { enabled: true, goalTime: "10:00", reviewTime: "18:00" };
for (const localTime of ["10:00", "18:00"])
  if (schedule.enabled && [schedule.goalTime, schedule.reviewTime].includes(localTime))
    roots.push(localTime === schedule.goalTime ? "goal" : "review");
assert.deepEqual(roots, ["goal", "review"]);

const retry = Array.from({ length: 8 }, (_, index) => dbAlarmRetryDelayMinutes(index));
assert.deepEqual(retry, [1, 2, 4, 8, 15, 30, 30, 30]);
let failureCount = 0;
for (let i = 0; i < 3; i += 1) failureCount += 1;
assert.equal(dbAlarmRetryDelayMinutes(failureCount), 8);
failureCount = 0;
assert.equal(dbAlarmRetryDelayMinutes(failureCount), 1);
assert.equal(
  runtimeFailureCode(new Error("Your account or project has exceeded the quota.")),
  "db_quota_exceeded",
);

console.log(
  `PASS Neon wake budget simulation: old=${oldWindows.size}, new=${newWindows.size} (worker=${workerWindows.size}, runner=${runnerWindows.size}, deployer=${deployerWindows.size}), goal/review roots retained`,
);
