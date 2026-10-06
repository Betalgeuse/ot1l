import { mock } from "bun:test";
import assert from "node:assert/strict";

let guideAttempts = 0;
const deliveries = [];
mock.module("../src/community-guide.ts", () => ({
  async deliverWelcomeGuide() {
    guideAttempts += 1;
    if (guideAttempts === 1) throw new Error("temporary guide failure");
    deliveries.push("guide");
    return true;
  },
}));
mock.module("../src/community-introduction-channel.ts", () => ({
  async welcomeIntroductionMember() {
    deliveries.push("introduction");
    return true;
  },
}));
mock.module("../src/community-welcome.ts", () => ({
  async welcomeTownhallMember() {
    deliveries.push("townhall");
    return true;
  },
}));
mock.module("../src/community-membership.ts", () => ({
  parseChannelMember(value, expectedUserId) {
    const user = value.user;
    assert.equal(user.id, expectedUserId);
    return {
      userId: user.id,
      displayName: user.real_name,
      isBot: user.is_bot,
      isAppUser: user.is_app_user,
      deleted: user.deleted,
    };
  },
  async collectCurrentChannelMembers() {
    const member = {
      userId: "UNEW",
      displayName: "New Member",
      isBot: false,
      isAppUser: false,
      deleted: false,
    };
    return { observedAt: "2026-10-06T11:00:00.000Z", members: [member], eligibleHumanIds: ["UNEW"] };
  },
}));

const {
  enqueueTeamJoinOnboarding,
  reconcileMemberOnboarding,
  runMemberOnboardingDeliveries,
} = await import("../src/community-onboarding.ts");

const env = {
  SLACK_TEAM_ID: "TQA",
  SLACK_BOT_TOKEN: "fake",
  DATABASE_URL: "postgresql://test:test@test.neon.tech/db",
  COMMUNITY_BOT_USER_ID: "UBOT",
  COMMUNITY_WELCOME_CHANNEL_ID: "CWELCOME",
  COMMUNITY_INTRO_CHANNEL_ID: "CINTRO",
  COMMUNITY_PUBLIC_CHANNEL_ID: "CDAILY",
  COMMUNITY_RELEASE_CHANNEL_ID: "CTOWN",
  GUIDE_DATABASE_URL: "postgresql://guide:guide@test.neon.tech/db",
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const parsed = new URL(url);
  assert.equal(parsed.pathname.endsWith("/users.info"), true);
  return Response.json({
    ok: true,
    user: {
      id: parsed.searchParams.get("user"),
      real_name: "New Member",
      is_bot: false,
      is_app_user: false,
      deleted: false,
    },
  });
};

try {
  const enqueues = [];
  const enqueueStore = {
    async enqueue(candidate, input) {
      enqueues.push({ candidate, input });
      return 4;
    },
  };
  assert.equal(
    await enqueueTeamJoinOnboarding(
      {
        event_id: "Ev-join",
        event_time: 1791283742,
        event: { type: "team_join", user: { id: "UNEW" } },
      },
      env,
      enqueueStore,
    ),
    4,
  );
  assert.equal(enqueues[0].input.sourceKind, "team_join");
  assert.equal(enqueues[0].candidate.displayName, "New Member");

  const reconcileStore = {
    async enqueue(candidate, input) {
      enqueues.push({ candidate, input });
      return 4;
    },
  };
  assert.equal(await reconcileMemberOnboarding(env, reconcileStore, 1791284400000), 4);
  assert.equal(enqueues.at(-1).input.sourceKind, "reconcile");

  const claims = [
    { userId: "UNEW", kind: "guide", eventTs: "1791283742", attempt: 1 },
    { userId: "UNEW", kind: "introduction", eventTs: "1791283742", attempt: 1 },
    { userId: "UNEW", kind: "reminder", eventTs: "1791283742", attempt: 1 },
    { userId: "UNEW", kind: "townhall", eventTs: "1791283742", attempt: 1 },
  ];
  const finishes = [];
  const deliveryStore = {
    async claim() {
      return claims.shift() ?? null;
    },
    async finish(input) {
      finishes.push(input);
    },
  };
  assert.deepEqual(await runMemberOnboardingDeliveries(env, deliveryStore, 1791284400000), {
    processed: 3,
    failed: 1,
    possiblyMore: false,
  });
  assert.deepEqual(deliveries, ["introduction", "townhall"]);
  assert.deepEqual(finishes.map((item) => [item.kind, item.status]), [
    ["guide", "failed"],
    ["introduction", "sent"],
    ["reminder", "sent"],
    ["townhall", "sent"],
  ]);

  claims.push({ userId: "UNEW", kind: "guide", eventTs: "1791283742", attempt: 2 });
  assert.deepEqual(await runMemberOnboardingDeliveries(env, deliveryStore, 1791284460000), {
    processed: 1,
    failed: 0,
    possiblyMore: false,
  });
  assert.deepEqual(deliveries, ["introduction", "townhall", "guide"]);
  console.log("PASS durable onboarding isolates consumers, reconciles missing joins and retries failures");
} finally {
  globalThis.fetch = originalFetch;
}
