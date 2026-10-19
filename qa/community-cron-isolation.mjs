import assert from "node:assert/strict";
import { mock } from "bun:test";
import { readFileSync } from "node:fs";

const calls = [];
let privateFails = false;
mock.module("../src/community-scheduler", () => ({
  async runCommunitySchedule(env, _store, date) {
    calls.push(["scrum", env.COMMUNITY_CHANNEL_ID, date.toISOString()]);
    if (privateFails && env.COMMUNITY_CHANNEL_ID === "CPRIVATE") throw new Error("private failure");
    return { common: 1, personal: 0 };
  },
  async runCommunityPrompts() { throw new Error("maintenance prompts reached scrum"); },
}));
const { communityCron, SCRUM_CRONS, MAINTENANCE_CRON, CLOCK_RECOVERY_CRON } = await import("../src/community-cron.ts");
const { createWorkerHandler } = await import("../src/worker-entry.ts");
const configured = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
assert.deepEqual(configured.triggers.crons, [...SCRUM_CRONS, MAINTENANCE_CRON, CLOCK_RECOVERY_CRON]);
const env = {
  DATABASE_URL: "postgresql://qa:qa@example.neon.tech/test",
  COMMUNITY_ENABLED: "true", COMMUNITY_ADMIN_ID: "UADMIN", SLACK_TEAM_ID: "TQA",
  SLACK_BOT_TOKEN: "test-token", COMMUNITY_CHANNEL_ID: "CPRIVATE",
  COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC", COMMUNITY_MAINTAINERS_CHANNEL_ID: "CPO",
  BUG_RUNNER_ENABLED: "true", COMMUNITY_CLOCK: { getByName(name) {
    assert.match(name, /^scrum:TQA:C(?:PUBLIC|PRIVATE)$/);
    return { async runScrum(channel, scheduledTime) {
      assert.equal(name, `scrum:TQA:${channel}`);
      calls.push(["scrum", channel, new Date(scheduledTime).toISOString()]);
      if (privateFails && channel === "CPRIVATE") throw new Error("private failure");
      return { common: 1, personal: 0 };
    } };
  } },
};
const originalFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error("maintenance reached network"); };
try {
  const worker = createWorkerHandler(async () => new Response("unused"));
  for (const cron of SCRUM_CRONS) {
    calls.length = 0;
    await worker.scheduled({ cron, scheduledTime: Date.parse("2026-10-12T01:00:00Z") }, env);
    assert.deepEqual(calls.map(c => c.slice(0, 2)), [["scrum", "CPUBLIC"], ["scrum", "CPRIVATE"]]);
  }
  assert.equal(externalCalls, 0, "scrum must not start any PO/backfill/clock/chapter/event work");
  calls.length = 0;
  privateFails = true;
  await assert.rejects(communityCron(env, Date.parse("2026-10-12T01:05:00Z")), /Daily scrum dispatch failed/);
  assert.equal(calls[0][1], "CPUBLIC", "private failure cannot consume the public root budget first");
  calls.length = 0;
  await communityCron({ ...env, DATABASE_MAINTENANCE: "true" }, Date.now());
  await communityCron({ ...env, COMMUNITY_ENABLED: "false" }, Date.now());
  assert.equal(calls.length, 0);
  await assert.rejects(communityCron(env, Date.now(), "unknown"), /Unknown community cron/);
  console.log("PASS Worker scheduled entry routes exact and recovery crons to scrum only; no maintenance access");
} finally { globalThis.fetch = originalFetch; mock.restore(); }
