import { mock } from "bun:test";
import assert from "node:assert/strict";

const order = [];

mock.module("../src/community-bug-clock-client.ts", () => ({
  armBugDeliveryClock: async () => {
    order.push("bug-clock");
    return { role: "bug_delivery", armed: true, next: null };
  },
}));
mock.module("../src/community-clock-client.ts", () => ({
  armCommunityClock: async () => {
    order.push("arm-schedule-clock");
    return { next: null };
  },
}));
mock.module("../src/community-scheduler.ts", () => ({
  runCommunitySchedule: async () => {
    order.push("daily-scrum");
    return { common: 0, personal: 0 };
  },
}));
mock.module("../src/community-townhall-events.ts", () => ({
  runTownhallEventDue: async () => {
    order.push("events");
    return 0;
  },
}));
mock.module("../src/community-chapters.ts", () => ({
  reconcileCommunityChapters: async () => {
    order.push("chapters");
    return 0;
  },
}));
mock.module("../src/community-share-info-reconcile.ts", () => ({
  reconcileShareInfoChannels: async () => {
    order.push("share-info");
    return 0;
  },
}));
mock.module("../src/community-garden-delivery.ts", () => ({
  runDueGardenDeliveries: async () => {
    order.push("garden");
    return { processed: 0, nextDue: null };
  },
}));
mock.module("../src/community-membership-schedule.ts", () => ({
  runMembershipDue: async () => {
    order.push("membership");
    return {
      possiblyMore: false,
      nextDue: null,
      nextCursor: null,
      interestNextCursor: null,
    };
  },
}));
mock.module("../src/community-maintainer-work.ts", () => ({
  reconcileMaintainerLinear: async () => ({ linked: 0, assigned: 0 }),
}));
mock.module("../src/community-agent-notifications.ts", () => ({
  sendAgentNotifications: async () => ({ claimed: 0, sent: 0, failed: 0 }),
}));
mock.module("../src/community-membership.ts", () => ({
  collectCurrentChannelMembers: async () => [],
}));

const { communityCron } = await import("../src/community-cron.ts");

await communityCron(
  {
    SLACK_TEAM_ID: "TQA",
    SLACK_BOT_TOKEN: "token",
    DATABASE_URL: "postgresql://u:p@example.neon.tech/db",
    BOARD_SIGNING_SECRET: "test",
    PUBLIC_BASE_URL: "https://example.com",
    COMMUNITY_ENABLED: "true",
    COMMUNITY_ADMIN_ID: "UADMIN",
    COMMUNITY_CHANNEL_ID: "CPUBLIC",
    COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC",
  },
  Date.parse("2026-10-07T01:00:12Z"),
);

assert.equal(order[0], "daily-scrum");
for (const auxiliary of ["bug-clock", "events", "chapters", "share-info", "garden", "membership"])
  assert.ok(
    order.indexOf("daily-scrum") < order.indexOf(auxiliary),
    "daily scrum must precede " + auxiliary,
  );

console.log("PASS Cron runs the daily scrum before every auxiliary queue");
