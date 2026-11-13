import assert from "node:assert/strict";
import { mock } from "bun:test";

mock.module("cloudflare:workers", () => ({ DurableObject: class {} }));
const dispatched = [];
mock.module("../src/community-guide.ts", () => ({ deliverWelcomeGuide: async () => false }));
mock.module("../src/community-introduction-channel.ts", () => ({
  handleIntroductionChannelMessage: async () => false,
  welcomeIntroductionMember: async () => false,
  sendDailyIntroductionReminders: async () => 0,
  showIntroductionDirectory: async () => {},
}));
mock.module("../src/community-enrollment.ts", () => ({ enrollReminderMember: async () => false }));
mock.module("../src/community-message-router.ts", () => ({
  dispatchCommunityMessage: async (...args) => dispatched.push(args),
}));

const { handleCommunityEvent } = await import("../src/community-events.ts");
const env = {
  COMMUNITY_ENABLED: "true",
  SLACK_TEAM_ID: "TQA",
  DATABASE_URL: "postgresql://test:test@test.neon.tech/db",
  COMMUNITY_BOT_USER_ID: "UBOT",
  COMMUNITY_CHANNEL_ID: "CADMIN",
  COMMUNITY_PUBLIC_CHANNEL_ID: "CDAILY",
  COMMUNITY_FEEDBACK_CHANNEL_ID: "CFEEDBACK",
};
const ts = String(Date.now() / 1000);
const event = (channel, type) => ({
  type: "event_callback",
  team_id: "TQA",
  event: { type, channel, user: "UMEMBER", ts, text: "<@UBOT> 안녕" },
});

for (const type of ["app_mention", "message"])
  assert.equal(
    await handleCommunityEvent(event("CFEEDBACK", type), env),
    true,
    `${type} in the retired feedback channel is handled by silently ignoring it`,
  );
assert.equal(dispatched.length, 0, "no ONE THING draft or reply is offered in the feedback channel");
assert.equal(
  await handleCommunityEvent(event("COTHER", "app_mention"), env),
  false,
  "other channels stay unhandled",
);
console.log("PASS retired feedback channel mentions are silently ignored");
