import assert from "node:assert/strict";
import { runCommunitySchedule } from "../src/community-scheduler.ts";

const records = new Map();
const posts = [];
const errors = [];
let commonClaims = 0;

const store = {
  async getRecord(input) {
    if (input.key === "group-schedule")
      return { body: { enabled: true, goalTime: "10:00", reviewTime: "18:00" } };
    return records.get(input.key) ?? null;
  },
  async putRecord(value) {
    if (!records.has(value.key)) records.set(value.key, { ...value, status: "pending" });
    return records.get(value.key);
  },
  async claimRecord(input) {
    const record = records.get(input.key);
    if (!record || record.status !== "pending") return false;
    record.status = "claimed";
    return true;
  },
  async finishRecord(input, status) {
    const record = records.get(input.key);
    if (record?.status === "claimed") record.status = status;
    return true;
  },
  async introductions() {
    return [];
  },
  async reminderTriggerDue() {
    return false;
  },
  async members() {
    return ["UACTIVE"];
  },
  async listDays() {
    return [];
  },
  async reviewHighlights() {
    return [];
  },
  async claimCommonDelivery(input) {
    const record = records.get("common:2026-10-07:goal");
    if (!record || record.status !== "pending") return null;
    record.status = "claimed";
    commonClaims += 1;
    return {
      leaseToken: input.leaseToken,
      attempt: commonClaims,
      safeToPost: true,
      firstAttemptAt: input.now,
      key: record.key,
      ...record.body,
    };
  },
  async finishCommonRoot(input) {
    const record = records.get("common:2026-10-07:goal");
    if (record?.status !== "claimed") return false;
    record.status = "sent";
    record.body.messageTs = input.messageTs;
    return true;
  },
  async finishCommonDelivery() {
    return true;
  },
  async claimReviewReminderBatch() {
    return null;
  },
  async claimGoalReminderBatch() {
    return null;
  },
  async finishReminderBatch() {
    return true;
  },
  async finishReviewReminderBatch() {
    return true;
  },
};

const env = {
  SLACK_TEAM_ID: "TQA",
  SLACK_BOT_TOKEN: "token",
  COMMUNITY_CHANNEL_ID: "CPUBLIC",
  COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC",
  COMMUNITY_ADMIN_ID: "UADMIN",
  COMMUNITY_BOT_USER_ID: "UBOT",
  COMMUNITY_INTRO_CHANNEL_ID: "CINTRO",
};

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
try {
  console.error = (line) => errors.push(JSON.parse(line));
  globalThis.fetch = async (url, options = {}) => {
    const method = new URL(url).pathname.split("/").at(-1);
    if (method === "emoji.list") return Response.json({ ok: true, emoji: {} });
    if (method === "conversations.members")
      return Response.json({
        ok: true,
        members: ["UMISSING"],
        response_metadata: { next_cursor: "" },
      });
    if (method === "users.info")
      return Response.json({
        ok: true,
        user: { id: "UMISSING", is_bot: false, is_app_user: false, deleted: false },
      });
    if (method === "chat.postMessage") {
      const body = JSON.parse(options.body);
      posts.push(body.channel);
      if (body.channel === "UMISSING")
        return Response.json({ ok: false, error: "channel_not_found" });
      return Response.json({ ok: true, ts: "1791334800.000001" });
    }
    throw new Error("unexpected Slack method " + method);
  };

  assert.deepEqual(await runCommunitySchedule(env, store, new Date("2026-10-07T01:00:12Z")), {
    common: 1,
    personal: 0,
  });
  assert.deepEqual(posts, ["CPUBLIC", "UMISSING"]);
  assert.equal(records.get("common:2026-10-07:goal").status, "sent");
  assert.equal(records.get("introduction-reminder:2026-10-07").status, "failed");
  assert.deepEqual(errors, [
    { event: "community.introduction_reminder.failed", errorType: "SlackError" },
  ]);

  assert.deepEqual(await runCommunitySchedule(env, store, new Date("2026-10-07T01:05:12Z")), {
    common: 0,
    personal: 0,
  });
  assert.equal(
    posts.filter((channel) => channel === "CPUBLIC").length,
    1,
    "the Cron watchdog must not duplicate the alarm-owned daily root",
  );

  console.log(
    "PASS daily scrum posts before auxiliary introduction failures and remains idempotent on recovery",
  );
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
}
