import assert from "node:assert/strict";
import { runCommunitySchedule } from "../src/community-scheduler.ts";

let dispatch = null;
let claimed = false;
let membershipCalls = 0;
const posts = [];
const store = {
  async getRecord(input) { return input.key === "group-schedule" ? { body: { enabled: true, goalTime: "10:00", reviewTime: "18:00" } } : null; },
  async putRecord(value) { if (value.kind === "dispatch" && !dispatch) dispatch = value; return { ...value, status: "pending" }; },
  async reminderTriggerDue() { return false; },
  async members() { return ["U1", "U2"]; },
  async listDays() { return []; },
  async reviewHighlights() { return []; },
  async claimCommonDelivery(input) {
    if (!dispatch || claimed) return null;
    claimed = true;
    return { leaseToken: input.leaseToken, attempt: 1, firstAttemptAt: input.now, key: dispatch.key, ...dispatch.body };
  },
  async finishCommonDelivery() { return true; },
  async finishReviewRoot() { return true; },
  async claimReviewReminderBatch() { return null; },
  async claimGoalReminderBatch() { return null; },
  async finishReminderBatch() { return true; },
  async finishReviewReminderBatch() { return true; },
};
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options = {}) => {
    const method = new URL(url).pathname.split("/").at(-1);
    if (method === "conversations.members" || method === "users.info") { membershipCalls += 1; throw new Error("membership lookup must not gate schedule delivery"); }
    if (method === "emoji.list") return Response.json({ ok: true, emoji: {} });
    if (method === "chat.postMessage") { posts.push(JSON.parse(options.body)); return Response.json({ ok: true, ts: "1017.1" }); }
    throw new Error(`unexpected ${url}`);
  };
  const result = await runCommunitySchedule({
    SLACK_TEAM_ID: "TQA", SLACK_BOT_TOKEN: "token", COMMUNITY_CHANNEL_ID: "CPUBLIC",
    COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC", COMMUNITY_BOT_USER_ID: "UBOT", COMMUNITY_ADMIN_ID: "UADMIN",
  }, store, new Date("2026-09-29T01:17:00Z"));
  assert.deepEqual(result, { common: 1, personal: 0 });
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /2026-09-29 오늘의 \*ONE THING\*/);
  assert.match(posts[0].text, /<@U1> <@U2>/);
  assert.equal(membershipCalls, 0);
  console.log("PASS missed 10:00 scrum catches up from DB membership without Slack profile dependency");
} finally { globalThis.fetch = originalFetch; }
