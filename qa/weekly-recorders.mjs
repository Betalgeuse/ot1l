import assert from "node:assert/strict";
import { maintenanceTaskObjectName } from "../src/community-maintenance-tasks.ts";
import {
  computeWeeklyRecorders,
  refreshWeeklyRecorders,
  serveWeeklyRecorders,
} from "../src/weekly-recorders.ts";

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
const at = (iso) => Date.parse(iso) / 1000;
const lastWeek = async (iso) =>
  (await computeWeeklyRecorders(db, "TQA", at(iso))).value.weeks.at(-1).week_start;

// Friday 11:00 KST
const snap = await computeWeeklyRecorders(db, "TQA", at("2026-11-13T04:00:00Z"));
assert.equal(snap.date, "2026-11-13");
const body = snap.value;
assert.deepEqual(Object.keys(body), ["metric", "timezone", "weeks"]);
assert.equal(body.metric, "weekly_distinct_recorders");
assert.equal(body.timezone, "Asia/Seoul");
assert.equal(body.weeks.length, 12);
assert.equal(body.weeks[0].week_start, "2026-08-24");
assert.equal(body.weeks.at(-1).week_start, "2026-11-09");
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
assert.doesNotMatch(JSON.stringify(body), /user|TQA|U[0-9A-Z]{8}/i);

// 02:00 service-day rollover
assert.equal(await lastWeek("2026-11-15T14:30:00Z"), "2026-11-09"); // Sun 23:30 KST
assert.equal(await lastWeek("2026-11-15T16:30:00Z"), "2026-11-09"); // Mon 01:30 KST
assert.equal(await lastWeek("2026-11-15T17:00:00Z"), "2026-11-16"); // Mon 02:00 KST
assert.equal(await lastWeek("2026-11-16T05:00:00Z"), "2026-11-16"); // Mon 14:00 KST

// The public route reads only the clock object: no DB call, no network.
const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("route touched the network");
};
const names = [];
const clock = (stored) => ({
  getByName(name) {
    names.push(name);
    return {
      async weeklyRecorders() {
        return stored;
      },
    };
  },
});
const req = (method = "GET") => new Request("https://x/metrics/weekly-recorders", { method });
const before = calls.length;
const ok = await serveWeeklyRecorders(req(), {
  SLACK_TEAM_ID: "TQA",
  COMMUNITY_CLOCK: clock(snap),
});
assert.equal(ok.status, 200);
assert.match(ok.headers.get("Cache-Control"), /max-age=\d+/);
assert.deepEqual(await ok.json(), { ...body, as_of: "2026-11-13", status: "ok" });
assert.deepEqual(names, [maintenanceTaskObjectName("TQA", "weekly_recorders")]);
assert.equal(
  maintenanceTaskObjectName("TQA", "weekly_recorders"),
  "maintenance-task:TQA:weekly_recorders:team",
);
const pending = await serveWeeklyRecorders(req(), {
  SLACK_TEAM_ID: "TQA",
  COMMUNITY_CLOCK: clock(undefined),
});
assert.equal(pending.status, 200);
assert.deepEqual(await pending.json(), {
  metric: "weekly_distinct_recorders",
  timezone: "Asia/Seoul",
  weeks: [],
  status: "pending",
});
assert.equal((await serveWeeklyRecorders(req(), { SLACK_TEAM_ID: "TQA" })).status, 200);
assert.equal(
  (await serveWeeklyRecorders(req("POST"), { SLACK_TEAM_ID: "TQA", COMMUNITY_CLOCK: clock(snap) }))
    .status,
  405,
);
assert.equal(calls.length, before);

// refreshWeeklyRecorders: env gates, once per koreaDate, storage write.
const store = new Map();
const storage = {
  async get(k) {
    return store.get(k);
  },
  async put(k, v) {
    store.set(k, v);
  },
};
const on = { COMMUNITY_ENABLED: "true", COMMUNITY_ADMIN_ID: "A", SLACK_TEAM_ID: "TQA" };
const ms = (iso) => Date.parse(iso);
const n = calls.length;
for (const env of [
  { ...on, COMMUNITY_ENABLED: "false" },
  { ...on, DATABASE_MAINTENANCE: "true" },
  { ...on, COMMUNITY_ADMIN_ID: "" },
])
  await refreshWeeklyRecorders(env, storage, db, ms("2026-11-13T04:01:00Z"));
assert.equal(calls.length, n);
assert.equal(store.size, 0);
await refreshWeeklyRecorders(on, storage, db, ms("2026-11-13T04:01:00Z"));
assert.equal(calls.length, n + 1);
assert.equal(store.get("weeklyRecorders").date, "2026-11-13");
await refreshWeeklyRecorders(on, storage, db, ms("2026-11-13T04:31:00Z"));
assert.equal(calls.length, n + 1); // same service day: no query
await refreshWeeklyRecorders(on, storage, db, ms("2026-11-13T17:01:00Z")); // 02:01 KST next day
assert.equal(calls.length, n + 2);
assert.equal(store.get("weeklyRecorders").date, "2026-11-14");
globalThis.fetch = realFetch;
console.log("weekly-recorders ok");
