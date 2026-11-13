import assert from "node:assert/strict";
import { handleWeeklyRecorders } from "../src/weekly-recorders.ts";

const calls = [];
const db = {
  async queryJson(sql, params) {
    calls.push({ sql, params });
    return [
      { w: "2026-11-09", n: 3 },
      { w: "2026-10-26", n: 1 },
    ];
  },
};
// 2026-11-13 is Friday in KST (04:00Z = 11:00 KST)
const now = Date.parse("2026-11-13T04:00:00Z") / 1000;
const get = (method = "GET") =>
  handleWeeklyRecorders(
    new Request("https://x/metrics/weekly-recorders", { method }),
    "TQA",
    db,
    now,
  );

const res = await get();
assert.equal(res.status, 200);
assert.match(res.headers.get("Cache-Control"), /max-age=\d+/);
const body = await res.json();
assert.deepEqual(Object.keys(body), ["metric", "timezone", "weeks"]);
assert.equal(body.metric, "weekly_distinct_recorders");
assert.equal(body.timezone, "Asia/Seoul");
assert.equal(body.weeks.length, 12);
assert.equal(body.weeks.at(-1).week_start, "2026-11-09");
assert.equal(body.weeks[0].week_start, "2026-08-24");
for (const w of body.weeks) {
  assert.deepEqual(Object.keys(w), ["week_start", "recorders"]);
  assert.equal(new Date(`${w.week_start}T00:00:00Z`).getUTCDay(), 1);
}
assert.deepEqual(
  body.weeks.map((w) => w.recorders),
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 3],
);
assert.equal(calls.length, 1);
assert.deepEqual(calls[0].params, ["TQA", "2026-08-24", "2026-11-13"]);

// Sunday 23:30 KST (14:30Z) still belongs to the week that started 11-09 ... Monday 00:30 KST is before the 02:00 day rollover
const sunday = Date.parse("2026-11-15T14:30:00Z") / 1000;
const sundayBody = await (
  await handleWeeklyRecorders(new Request("https://x/"), "TQA", db, sunday)
).json();
assert.equal(sundayBody.weeks.at(-1).week_start, "2026-11-09");
const monday = Date.parse("2026-11-16T03:00:00Z") / 1000; // 12:00 KST Monday
const mondayBody = await (
  await handleWeeklyRecorders(new Request("https://x/"), "TQA", db, monday)
).json();
assert.equal(mondayBody.weeks.at(-1).week_start, "2026-11-16");
assert.equal(mondayBody.weeks.at(-1).recorders, 0);

assert.equal((await get("POST")).status, 405);
assert.equal(calls.length, 3);
assert.doesNotMatch(JSON.stringify(body), /user|TQA|U[0-9A-Z]{8}/i);
console.log("weekly-recorders ok");
