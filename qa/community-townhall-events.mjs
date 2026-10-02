import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("cloudflare:workers", () => ({ DurableObject: class {} }));
const events = new Map();
const votes = new Map();
const eventView = (event, actorId) => ({
  ...event,
  options: event.options.map((option, position) => ({
    startsAt: option,
    position: position + 1,
    votes: [...votes.values()].filter((selected) => selected.includes(option)).length,
  })),
  selected: votes.get(actorId) ?? [],
  poll: event.poll ?? null,
  eventKind: "gathering",
  phase: "recruiting",
  minConfirmed: 2,
  capacity: null,
  recruitmentDeadline: null,
  graceHours: 24,
  autoCancel: true,
  graceUntil: null,
  finalStartAt: null,
  cancelledAt: null,
  cancellationReason: null,
  interestCount: 0,
  goingCount: 0,
  waitlistCount: 0,
  viewerState: null,
});
mock.module("../src/community-store.ts", () => ({
  CommunityStore: class {
    async createTownhallEvent(input) {
      const existing = events.get(input.eventId);
      if (existing) return { created: false, event: eventView(existing, input.actorId) };
      const event = {
        eventId: input.eventId,
        teamId: input.teamId,
        channelId: input.channelId,
        hostUserId: input.actorId,
        activity: input.activity,
        location: input.location,
        options: [...input.options],
        revision: 1,
        status: "draft",
        messageTs: null,
      };
      events.set(input.eventId, event);
      return { created: true, event: eventView(event, input.actorId) };
    }
    async bindTownhallEvent(input) {
      const event = events.get(input.eventId);
      if (!event || event.hostUserId !== input.actorId) return false;
      event.status = "active";
      event.messageTs = input.messageTs;
      return true;
    }
    async abortTownhallEvent(input) {
      return events.delete(input.eventId);
    }
    async getTownhallEvent(input) {
      const event = events.get(input.eventId);
      return event ? eventView(event, input.actorId) : null;
    }
    async voteTownhallEvent(input) {
      votes.set(input.actorId, [...input.selected]);
      return eventView(events.get(input.eventId), input.actorId);
    }
    async editTownhallEvent(input) {
      const event = events.get(input.eventId);
      if (event.hostUserId !== input.actorId || event.revision !== input.expectedRevision)
        throw new Error("event edit conflict");
      event.activity = input.activity;
      event.location = input.location;
      event.options = [...input.options];
      event.revision += 1;
      for (const [actor, selected] of votes)
        votes.set(
          actor,
          selected.filter((option) => event.options.includes(option)),
        );
      return eventView(event, input.actorId);
    }
  },
}));
mock.module("../src/store.ts", () => ({
  NeonStore: class {},
  StoreError: class StoreError extends Error {},
}));

const { communityInteraction } = await import("../src/community-interactions.ts");
const { townhallEventLauncher } = await import("../src/community-townhall-events.ts");
const env = {
  COMMUNITY_ENABLED: "true",
  SLACK_TEAM_ID: "TQA",
  SLACK_BOT_TOKEN: "token",
  DATABASE_URL: "unused",
  COMMUNITY_CHANNEL_ID: "CADMIN",
  COMMUNITY_ADMIN_ID: "UADMIN",
  COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC",
  COMMUNITY_RELEASE_CHANNEL_ID: "CTOWN",
  EVENT_PUBLIC_BASE_URL: "https://events.example.com",
  EVENT_SIGNING_SECRET: "event-secret",
};
const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = new URL(url).pathname.split("/").at(-1);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ method, body });
  if (method === "views.open") return Response.json({ ok: true, view: { id: "VEVENT" } });
  if (method === "chat.postMessage") return Response.json({ ok: true, ts: "200.000001" });
  if (method === "chat.update") return Response.json({ ok: true, ts: body.ts });
  if (method === "chat.postEphemeral") return Response.json({ ok: true, message_ts: "201.000001" });
  throw new Error(`unexpected ${method}`);
};

const action = (actionId, userId, value, triggerId = `trigger-${actionId}`) => ({
  type: "block_actions",
  team: { id: "TQA" },
  user: { id: userId },
  container: { channel_id: "CTOWN", message_ts: "100.000001" },
  message: { ts: "100.000001" },
  actions: [{ action_id: actionId, action_ts: "101.000001", value: JSON.stringify(value) }],
  trigger_id: triggerId,
});
const submission = (id, callbackId, privateMetadata, values, userId = "UMEMBER") => ({
  type: "view_submission",
  team: { id: "TQA" },
  user: { id: userId },
  view: { id, callback_id: callbackId, private_metadata: privateMetadata, state: { values } },
});

try {
  const launcher = townhallEventLauncher();
  assert.match(launcher.text, /웹 시간표/);
  const open = action("community_event_open", "UMEMBER", {
    ownerId: "actor",
    key: "new-townhall-event",
  });
  assert.equal((await communityInteraction(open, env, () => {})).status, 200);
  const createModal = calls.find((call) => call.method === "views.open").body.view;
  assert.deepEqual(
    createModal.blocks.filter((block) => block.type === "input").map((block) => block.block_id),
    ["activity", "location"],
  );
  assert.doesNotMatch(JSON.stringify(createModal), /가능한 시간 후보|최대 8개|2026-10-10/);
  assert.match(JSON.stringify(createModal), /게시한 뒤.*시간 맞추기/);

  const invalid = submission("VINVALID", "community_event_submit", createModal.private_metadata, {
    activity: { value: { value: "" } },
    location: { value: { value: "" } },
  });
  const invalidResponse = await communityInteraction(invalid, env, () => {});
  assert.deepEqual(Object.keys((await invalidResponse.json()).errors).sort(), ["activity", "location"]);

  const pending = [];
  const valid = submission("VEVENT-1", "community_event_submit", createModal.private_metadata, {
    activity: { value: { value: "산책 모임\n초보 환영 https://example.com/watch" } },
    location: { value: { value: "성수역 1번 출구" } },
  });
  const response = await communityInteraction(valid, env, (promise) => pending.push(promise));
  assert.deepEqual(await response.json(), { response_action: "clear" });
  await Promise.all(pending.splice(0));
  const post = calls.find((call) => call.method === "chat.postMessage");
  assert.match(post.body.text, /<@UMEMBER>님이 이벤트를 열었어요/);
  assert.match(post.body.text, /\*산책 모임\*\n초보 환영 https:\/\/example[.]com\/watch/);
  assert.doesNotMatch(post.body.text, /example[.]com\/watch\*/);
  assert.doesNotMatch(post.body.text, /리액션은 관심 신호|다음 활동 수요/);
  assert.match(post.body.text, /장소: 성수역 1번 출구/);
  assert.match(post.body.text, /아직 정하지 않았어요/);
  assert.deepEqual(
    post.body.blocks[1].elements.map((item) => item.action_id),
    [
      "community_event_interest",
      "community_event_availability",
      "community_event_edit",
      "community_event_open",
    ],
  );

  calls.length = 0;
  const availability = action("community_event_availability", "UOTHER", {
    ownerId: "actor",
    key: "VEVENT-1",
    eventId: "VEVENT-1",
  });
  await communityInteraction(availability, env, (promise) => pending.push(promise));
  await Promise.all(pending.splice(0));
  const scheduleLink = calls.find((call) => call.method === "chat.postEphemeral");
  assert.match(scheduleLink.body.blocks[0].accessory.url, /^https:\/\/events[.]example[.]com\/events\/schedule\//);

  calls.length = 0;
  await assert.rejects(
    communityInteraction(
      action("community_event_edit", "UOTHER", {
        ownerId: "UMEMBER",
        key: "VEVENT-1",
        eventId: "VEVENT-1",
      }),
      env,
      () => {},
    ),
    /본인 기록만/,
  );
  await communityInteraction(
    action("community_event_edit", "UMEMBER", {
      ownerId: "UMEMBER",
      key: "VEVENT-1",
      eventId: "VEVENT-1",
    }),
    env,
    () => {},
  );
  const editModal = calls.find((call) => call.method === "views.open").body.view;
  assert.equal(editModal.title.text, "이벤트 수정");
  assert.doesNotMatch(JSON.stringify(editModal), /가능한 시간 후보|최대 8개/);
  const editValues = {
    activity: { value: { value: "저녁 산책" } },
    location: { value: { value: "서울숲" } },
  };
  const editSubmit = submission(
    "VEDIT",
    "community_event_submit",
    editModal.private_metadata,
    editValues,
  );
  await communityInteraction(editSubmit, env, (promise) => pending.push(promise));
  await Promise.all(pending.splice(0));
  assert.match(
    calls.filter((call) => call.method === "chat.update").at(-1).body.text,
    /장소: 서울숲/,
  );

  console.log(
    "PASS townhall event: simple Slack start, always-visible web scheduler, and host edit without legacy time fields",
  );
} finally {
  globalThis.fetch = originalFetch;
}
