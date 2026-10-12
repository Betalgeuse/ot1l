import assert from "node:assert/strict";
import { mock } from "bun:test";

const now = Date.parse("2026-10-12T04:30:00Z");
let activeStorage;
let assertArmedBeforeWork = false;
let failMembership = true;
mock.module("cloudflare:workers", () => ({ DurableObject: class {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
} }));
mock.module("../src/community-garden-delivery", () => ({
  deliverGardenByKey: async () => null,
  async runDueGardenDeliveries() {
    if (assertArmedBeforeWork) {
      assert.equal(activeStorage.alarm, now + 60_000, "a retry must survive termination during external I/O");
      assert.equal(activeStorage.values.get("lastRun").status, "running");
    }
    return { processed: 0, nextDue: null };
  },
}));
mock.module("../src/community-membership-schedule", () => ({
  async runMembershipDue() { return { possiblyMore: false, nextDue: failMembership ? now + 60_000 : null, nextCursor: null, interestNextCursor: null }; },
}));
mock.module("../src/community-membership-due", () => ({
  async nextGardenDue() { return null; },
  async nextMembershipDue() { return now + 300_000; },
}));
const { CommunityClock } = await import("../src/community-clock.ts");
const { communityMaintenanceCron } = await import("../src/community-cron.ts");
const { runtimeFailureCode } = await import("../src/runtime-failure.ts");
class Storage {
  values = new Map([["role", "community_schedule"], ["channel", "CPUBLIC"]]);
  alarm = null;
  async get(k) { return this.values.get(k); }
  async put(k,v) { this.values.set(k,v); }
  async delete(k) { return this.values.delete(k); }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
}
const env = { SLACK_TEAM_ID:"TQA", DATABASE_URL:"postgresql://qa:qa@example.neon.tech/test",
  COMMUNITY_ENABLED:"true", COMMUNITY_ADMIN_ID:"UADMIN", COMMUNITY_PUBLIC_CHANNEL_ID:"CPUBLIC" };
const originalNow=Date.now;
Date.now=()=>now;
try {
  activeStorage=new Storage();
  await new CommunityClock({storage:activeStorage},env).alarm();
  assert.equal(activeStorage.alarm, now+60_000, "membership-only failure retry must not be replaced with the five-minute idle deadline");
  assertArmedBeforeWork=true; failMembership=false; activeStorage=new Storage();
  await new CommunityClock({storage:activeStorage},env).alarm();
  assert.equal(activeStorage.alarm, now+300_000, "successful completion must retire the provisional one-minute retry");
  assert.equal(activeStorage.values.get("lastRun").status,"finished");
  activeStorage.alarm=now-5_000;
  await new CommunityClock({storage:activeStorage},env).refresh("CPUBLIC");
  assert.equal(activeStorage.alarm,now+1_000,"backup must not postpone an overdue alarm for another five minutes");

  const originalFetch=globalThis.fetch;
  const originalLog=console.log, originalError=console.error;
  const order=[];
  console.log=()=>{}; console.error=()=>{};
  globalThis.fetch=async()=>{order.push("network");throw new Error("offline test");};
  try {
    await communityMaintenanceCron({...env, COMMUNITY_CHANNEL_ID:"CPUBLIC", COMMUNITY_CLOCK:{getByName(name){
      return { async armBugDelivery(){order.push("bug");return{};},async refresh(channel){order.push(`${name}:${channel}`);return{next:now+300_000};} };
    }}},now);
    assert.equal(order[1],"TQA:CPUBLIC:CPUBLIC","repair queue alarm before optional DB/Slack work, with deduplicated channels");
    assert.equal(order.filter(x=>x==="TQA:CPUBLIC:CPUBLIC").length,1);
  } finally {globalThis.fetch=originalFetch;console.log=originalLog;console.error=originalError;}
  assert.equal(runtimeFailureCode(new Error("Too many subrequests. token=private")),"subrequest_limit");
  assert.equal(runtimeFailureCode(new Error("postgresql://private.example")),"unclassified");
  console.log("PASS alarm pre-armed recovery, membership-only deadline and successful idle cadence");
} finally { Date.now=originalNow; mock.restore(); }
