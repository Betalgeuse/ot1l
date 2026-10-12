import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runCommunitySchedule } from "../src/community-scheduler.ts";

const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
assert.deepEqual(wrangler.triggers.crons, ["0 1 * * *", "0 9 * * *", "*/5 * * * *", "1-59/5 * * * *"]);

let dispatch = null;
let claimed = false;
let membershipCalls = 0;
let emojiCalls = 0;
let dispatchWrites = 0;
const posts = [];
const store = {
  async getRecord(input) {
    if (input.key === "group-schedule") return { body: { enabled: true, goalTime: "10:00", reviewTime: "18:00" } };
    return input.key === "common:2026-09-29:goal" ? dispatch : null;
  },
  async putRecord(value) {
    if (value.kind === "dispatch") {
      dispatchWrites += 1;
      if (!dispatch) dispatch = { ...value, status: "pending" };
    }
    return { ...value, status: "pending" };
  },
  async reminderTriggerDue() { return false; },
  async members() { return ["U1", "U2"]; },
  async listDays() { return []; },
  async reviewHighlights() { return []; },
  async claimCommonDelivery(input) {
    if (!dispatch || claimed) return null;
    claimed = true;
    return { leaseToken: input.leaseToken, attempt: 1, safeToPost: true, firstAttemptAt: input.now, key: dispatch.key, ...dispatch.body };
  },
  async finishCommonDelivery() { return true; },
  async finishCommonRoot() { dispatch.status = "sent"; return true; },
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
    if (method === "emoji.list") { emojiCalls += 1; return Response.json({ ok: true, emoji: {} }); }
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
  assert.match(posts[0].text, /함께할 분: <!channel>/);
  assert.doesNotMatch(posts[0].text, /<@U1>|<@U2>/);
  assert.equal(membershipCalls, 0);
  assert.deepEqual(await runCommunitySchedule({
    SLACK_TEAM_ID: "TQA", SLACK_BOT_TOKEN: "token", COMMUNITY_CHANNEL_ID: "CPUBLIC",
    COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC", COMMUNITY_BOT_USER_ID: "UBOT", COMMUNITY_ADMIN_ID: "UADMIN",
  }, store, new Date("2026-09-29T01:22:00Z")), { common: 0, personal: 0 });
  assert.equal(posts.length, 1);
  assert.equal(emojiCalls, 1, "an existing dispatch skips message recomposition and Slack emoji lookup");
  assert.equal(dispatchWrites, 1);
  const actions = posts[0].blocks.flatMap(b => b.elements ?? []);
  for (const id of ["community_quick_goal", "community_quick_review", "community_maintainer_activate", "community_bug_open"])
    assert.ok(actions.some(a => a.action_id === id), `missing daily control: ${id}`);
  assert.ok(actions.filter(a => a.value).every(a => JSON.parse(a.value).ownerId === "actor"));

  // A failure after common delivery must not stop the common root from landing.
  dispatch = null; claimed = false;
  await assert.rejects(runCommunitySchedule({
    SLACK_TEAM_ID: "TQA", SLACK_BOT_TOKEN: "token", COMMUNITY_CHANNEL_ID: "CPUBLIC",
    COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC", COMMUNITY_ADMIN_ID: "UADMIN",
    COMMUNITY_INTRO_CHANNEL_ID: "CINTRO", COMMUNITY_FEEDBACK_CHANNEL_ID: "CFEEDBACK",
    COMMUNITY_MAINTAINERS_CHANNEL_ID: "CPO",
  }, { ...store, async reminderTriggerDue() { throw new Error("personal queue unavailable"); } }, new Date("2026-09-29T01:00:00Z")), /personal queue unavailable/);
  assert.equal(posts.length, 2);
  assert.equal(dispatch.status, "sent");
  console.log("PASS missed 10:00 scrum catches up from DB membership without Slack profile dependency");
} finally { globalThis.fetch = originalFetch; }
