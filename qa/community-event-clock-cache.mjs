import { mock } from "bun:test";
import assert from "node:assert/strict";

const calls = [];
let nextDue = "2026-10-19T14:12:00.000Z";
mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
mock.module("../src/community-townhall-events", () => ({
  async runTownhallEventDue(_context, now) {
    calls.push(["due", now]);
  },
}));
mock.module("../src/community-store", () => ({
  CommunityStore: class {
    async nextTownhallEventDue() {
      calls.push(["next_due"]);
      return nextDue;
    }
  },
}));
mock.module("../src/store", () => ({ NeonStore: class {} }));

const { CommunityClock } = await import("../src/community-clock.ts");
class Storage {
  values = new Map();
  async get(key) {
    return this.values.get(key);
  }
  async put(key, value) {
    this.values.set(key, value);
  }
  async delete(key) {
    this.values.delete(key);
  }
  async list({ prefix }) {
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)));
  }
}
const storage = new Storage();
const env = {
  SLACK_TEAM_ID: "TQA",
  COMMUNITY_ENABLED: "true",
  COMMUNITY_ADMIN_ID: "UADMIN",
  COMMUNITY_RELEASE_CHANNEL_ID: "CRELEASE",
  DATABASE_URL: "postgresql://test",
};
const clock = new CommunityClock({ storage }, env);
const tick = (minute) => Date.parse(`2026-10-19T14:${String(minute).padStart(2, "0")}:00Z`);
try {
  await clock.runMaintenanceTask("events", tick(1));
  assert.deepEqual(calls, [["due", "2026-10-19T14:01:00.000Z"], ["next_due"]]);
  for (const minute of [6, 11]) await clock.runMaintenanceTask("events", tick(minute));
  assert.equal(calls.length, 2, "no Neon access before cached event due time");
  nextDue = null;
  await clock.runMaintenanceTask("events", tick(16));
  assert.deepEqual(calls.slice(2), [["due", "2026-10-19T14:16:00.000Z"], ["next_due"]]);
  await clock.invalidateTownhallEventDue();
  await clock.runMaintenanceTask("events", tick(21));
  assert.equal(
    calls.filter(([kind]) => kind === "due").length,
    3,
    "RPC invalidation opens the event lane promptly",
  );
  console.log(
    "PASS event cache: due at 14:12 runs on 14:16; prior ticks stay storage-only; RPC invalidation refreshes",
  );
} finally {
  mock.restore();
}
