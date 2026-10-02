import assert from "node:assert/strict";
import { runCommunitySchedule } from "../src/community-scheduler.ts";

let dispatch = null;
let claimed = false;
const posts = [];
const store = {
  async getRecord(input) {
    return input.key === "group-schedule"
      ? { body: { enabled: true, goalTime: "10:00", reviewTime: "18:00" } }
      : null;
  },
  async putRecord(value) { if (value.kind === "dispatch") dispatch = value; return { ...value, status: "pending" }; },
  async reminderTriggerDue() { return false; },
  async reconcileChannelMembers() { return true; },
  async members() { return ["UEARLY", "UWAIT", "UNOGOAL"]; },
  async listDays() {
    return [
      { teamId: "TQA", channelId: "CPUBLIC", userId: "UEARLY", date: "2026-09-28", goal: "끝낸 일", outcome: "complete", reflection: "미리 회고", resting: false, revision: 2 },
      { teamId: "TQA", channelId: "CPUBLIC", userId: "UWAIT", date: "2026-09-28", goal: "진행 중", outcome: "pending", reflection: "", resting: false, revision: 1 },
    ];
  },
  async reviewHighlights() { return [{ userId: "UEARLY", outcome: "complete", reviewedAt: "16:30" }]; },
  async claimCommonDelivery(input) {
    if (!dispatch || claimed) return null;
    claimed = true;
    return { leaseToken: input.leaseToken, attempt: 1, safeToPost: true, firstAttemptAt: input.now, key: dispatch.key, ...dispatch.body };
  },
  async finishCommonDelivery() { return true; },
  async finishCommonRoot() { return true; },
  async claimReviewReminderBatch() { return null; },
  async claimGoalReminderBatch() { return null; },
  async finishReminderBatch() { return true; },
  async finishReviewReminderBatch() { return true; },
};
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options = {}) => {
    const method = new URL(url).pathname.split("/").at(-1);
    if (method === "conversations.members") return Response.json({ ok: true, members: ["UEARLY", "UWAIT", "UNOGOAL", "UBOT"], response_metadata: { next_cursor: "" } });
    if (method === "users.info") {
      const id = new URL(url).searchParams.get("user");
      return Response.json({ ok: true, user: { id, deleted: false, is_bot: id === "UBOT", is_app_user: false } });
    }
    if (method === "emoji.list") return Response.json({ ok: true, emoji: {} });
    if (method === "chat.postMessage") { posts.push(JSON.parse(options.body)); return Response.json({ ok: true, ts: "1800.1" }); }
    throw new Error(`unexpected ${url}`);
  };
  const result = await runCommunitySchedule({
    SLACK_TEAM_ID: "TQA", SLACK_BOT_TOKEN: "token", COMMUNITY_CHANNEL_ID: "CPUBLIC",
    COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC", COMMUNITY_BOT_USER_ID: "UBOT", COMMUNITY_ADMIN_ID: "UADMIN",
    REVIEW_THREAD_V2: "true",
  }, store, new Date("2026-09-28T09:00:00Z"));
  assert.deepEqual(result, { common: 1, personal: 0 });
  assert.equal(posts.length, 1);
  const text = posts[0].text;
  assert.match(text, /오늘 후기를 기다리는 분: <@UWAIT>/);
  assert.doesNotMatch(text, /오늘 후기를 기다리는 분:[^\n]*<@UEARLY>/);
  assert.doesNotMatch(text, /<@UNOGOAL>/);
  assert.match(text, /<@UEARLY>님은 16시 30분에 미리 다 했네요!!!/);
  assert.equal((text.match(/<@UEARLY>/g) ?? []).length, 1);
  console.log("PASS early review prompt asks only pending reviewers and praises early completion by time");
} finally { globalThis.fetch = originalFetch; }
