import assert from "node:assert/strict";
import { dbAlarmRetryDelayMinutes } from "../src/community-alarm-backoff.ts";
import { NEON_WAKE_WINDOW_BUDGET } from "../src/community-cron.ts";
import { maintenanceCadenceDue } from "../src/community-maintenance-tasks.ts";
import { runtimeFailureCode } from "../src/runtime-failure.ts";

const dayStart = Date.parse("2026-10-19T00:00:00+09:00");
const windows = new Set();
const oldWindows = new Set();
for (let hour = 0; hour < 24; hour += 1) {
  for (const minute of [1, 31]) {
    const at = dayStart + (hour * 60 + minute) * 60_000;
    windows.add(Math.floor(at / 300_000));
  }
}
for (let i = 0; i < 24 * 60; i += 5) {
  const at = dayStart + i * 60_000;
  const isScrumRoot = ["10:00", "18:00"].includes(
    new Date(at + 9 * 60 * 60_000).toISOString().slice(11, 16),
  );
  const alarmSafetyWake = i % (6 * 60) === 0;
  if (isScrumRoot || alarmSafetyWake) windows.add(Math.floor(at / 300_000));
  oldWindows.add(Math.floor(at / 300_000));
  // Existing 60-second alarms shared every five-minute window on the old path.
  if (i % 5 === 0) oldWindows.add(Math.floor(at / 300_000));
}
const measured = windows.size;
assert.equal(NEON_WAKE_WINDOW_BUDGET, 60);
assert.ok(measured <= NEON_WAKE_WINDOW_BUDGET, `${measured} windows exceeds budget`);
assert.equal(oldWindows.size, 288);
assert.equal(maintenanceCadenceDue("feedback", Date.parse("2026-10-19T00:01:00Z")), true);
assert.equal(maintenanceCadenceDue("feedback", Date.parse("2026-10-19T00:06:00Z")), false);
assert.equal(maintenanceCadenceDue("events", Date.parse("2026-10-19T00:06:00Z")), true);

const roots = [];
const schedule = { enabled: true, goalTime: "10:00", reviewTime: "18:00" };
for (const at of [dayStart + 10 * 60 * 60_000, dayStart + 18 * 60 * 60_000]) {
  const localTime = new Date(at + 9 * 60 * 60_000).toISOString().slice(11, 16);
  if (schedule.enabled && [schedule.goalTime, schedule.reviewTime].includes(localTime))
    roots.push(localTime === schedule.goalTime ? "goal" : "review");
}
assert.deepEqual(roots, ["goal", "review"]);

const retry = Array.from({ length: 8 }, (_, index) => dbAlarmRetryDelayMinutes(index));
assert.deepEqual(retry, [1, 2, 4, 8, 15, 30, 30, 30]);
let failureCount = 0;
for (let i = 0; i < 3; i += 1) failureCount += 1;
assert.equal(dbAlarmRetryDelayMinutes(failureCount), 8);
failureCount = 0; // successful alarm clears the persisted consecutive-failure count
assert.equal(dbAlarmRetryDelayMinutes(failureCount), 1);
assert.equal(
  runtimeFailureCode(new Error("Your account or project has exceeded the quota.")),
  "db_quota_exceeded",
);

console.log(
  `PASS Neon wake budget simulation: old=${oldWindows.size}, new=${measured}, goal/review roots retained`,
);
