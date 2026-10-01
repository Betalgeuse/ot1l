import assert from "node:assert/strict";
import { reminderPlan, reminderText } from "../scripts/schedule-private-house-reminders.mjs";

const link = "https://example.slack.com/archives/C1/p1";
const plan = reminderPlan(link, Date.parse("2026-10-01T00:00:00+09:00"));
assert.deepEqual(plan.map((item) => item.date), [
  "2026-10-07",
  "2026-10-14",
  "2026-10-21",
  "2026-10-28",
]);
assert.ok(plan.every((item) => new Date(item.postAt * 1000).getUTCDay() === 3));
assert.ok(plan.every((item) => new Date(item.postAt * 1000).getUTCHours() === 3));
assert.ok(plan.every((item) => item.postAt < Date.parse("2026-10-31T23:59:59+09:00") / 1000));
assert.match(reminderText(link), /10월 31일까지/);
assert.match(reminderText(link), /같이 해보고 싶은 활동 보기/);
assert.deepEqual(reminderPlan(link, Date.parse("2026-10-29T00:00:00+09:00")), []);
console.log("PASS private house reminders run Wednesdays at noon and stop before October 31");
