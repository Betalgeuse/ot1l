import assert from "node:assert/strict";
import { mock } from "bun:test";

mock.module("cloudflare:workers", () => ({ DurableObject: class {} }));
const calls = [];
mock.module("../src/community-guide.ts", () => ({
  async deliverWelcomeGuide(event) {
    calls.push(["guide", event]);
    return true;
  },
}));
mock.module("../src/community-introduction-channel.ts", () => ({
  async handleIntroductionChannelMessage() {
    return false;
  },
  async welcomeIntroductionMember(event) {
    calls.push(["introduction", event]);
    return true;
  },
  async sendDailyIntroductionReminders() {
    return 0;
  },
  async showIntroductionDirectory() {},
}));
mock.module("../src/community-enrollment.ts", () => ({
  async enrollReminderMember(event) {
    calls.push(["reminder", event]);
    return true;
  },
}));
mock.module("../src/community-welcome.ts", () => ({
  async welcomeTownhallMember(event) {
    calls.push(["townhall", event]);
    return true;
  },
}));

const { handleCommunityEvent } = await import("../src/community-events.ts");
const env = {
  COMMUNITY_ENABLED: "true",
  REFERRALS_ENABLED: "false",
  SLACK_TEAM_ID: "TQA",
  SLACK_BOT_TOKEN: "fake",
  DATABASE_URL: "postgresql://test:test@test.neon.tech/db",
  COMMUNITY_BOT_USER_ID: "UBOT",
  GUIDE_DATABASE_URL: "postgresql://guide:guide@test.neon.tech/db",
  COMMUNITY_WELCOME_CHANNEL_ID: "CWELCOME",
  COMMUNITY_INTRO_CHANNEL_ID: "CINTRO",
  COMMUNITY_PUBLIC_CHANNEL_ID: "CDAILY",
  COMMUNITY_RELEASE_CHANNEL_ID: "CTOWN",
};

await handleCommunityEvent(
  {
    type: "event_callback",
    team_id: "TQA",
    event_id: "Ev-join",
    event_time: 1791030000,
    event: { type: "team_join", user: { id: "UNEW" } },
  },
  env,
);
assert.deepEqual(
  calls.map(([kind, event]) => [kind, event.channel, event.user]),
  [
    ["guide", "CWELCOME", "UNEW"],
    ["introduction", "CINTRO", "UNEW"],
    ["reminder", "CDAILY", "UNEW"],
    ["townhall", "CTOWN", "UNEW"],
  ],
  "team_join must fan out to every new-member consumer even when channel_join events are absent",
);
console.log("PASS team_join fans out welcome, introduction, reminder, and townhall surfaces");
