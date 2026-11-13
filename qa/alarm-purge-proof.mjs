import assert from "node:assert/strict";
import { mock } from "bun:test";

const calls = [];
const impl = { NeonStore: class { async queryJson(sql, params) { calls.push({ sql, params }); return false; } } };
mock.module("../src/store.ts", () => impl);
mock.module("../src/store", () => impl);
const { alarmWorkIsClear, COMMUNITY_ALARM_CLEAR } = await import("../src/community-alarm-proof.ts");

const env = { SLACK_TEAM_ID: "TQA", DATABASE_URL: "postgres://x", COMMUNITY_CHANNEL_ID: "CPRIV", COMMUNITY_PUBLIC_CHANNEL_ID: "CPUB" };
assert.equal(await alarmWorkIsClear(env, "community_schedule", "CPUB"), false, "pending purge keeps the alarm open");
assert.equal(calls[0].params[7], "true", "applicant purge queue gates the public-channel alarm even with all flags unset");
assert.deepEqual(calls[0].params.slice(3, 6), ["false", "false", "false"], "retired delivery queues do not gate");
await alarmWorkIsClear(env, "community_schedule", "CPRIV");
assert.equal(calls[1].params[7], "false");
assert.ok(COMMUNITY_ALARM_CLEAR.includes("referral_private_payloads") && COMMUNITY_ALARM_CLEAR.includes("interest_private_payloads"));
console.log("PASS alarm proof stays open while applicant payload purge is pending");
