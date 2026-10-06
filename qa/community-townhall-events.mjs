import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("cloudflare:workers", () => ({ DurableObject: class {} }));
const events = new Map();
const votes = new Map();
const followups = new Map();
const participants = new Map();
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
  minConfirmed: event.minConfirmed ?? 2,
  capacity: event.capacity ?? null,
  recruitmentDeadline: null,
  graceHours: 24,
  autoCancel: true,
  graceUntil: null,
  finalStartAt: event.finalStartAt ?? null,
  finalEndAt: event.finalStartAt
    ? new Date(Date.parse(event.finalStartAt) + (event.durationMinutes ?? 60) * 60_000).toISOString()
    : null,
  durationMinutes: event.durationMinutes ?? 60,
  cancelledAt: null,
  cancellationReason: null,
  interestCount: 0,
  goingCount:
    1 +
    [...participants.values()].filter(
      (participant) => participant.eventId === event.eventId && participant.state === "going",
    ).length,
  waitlistCount: 0,
  viewerState:
    actorId === event.hostUserId
      ? "going"
      : (participants.get(`${event.eventId}:${actorId}`)?.state ?? null),
  participants: [
    { userId: event.hostUserId, state: "going" },
    ...[...participants.values()]
      .filter(
        (participant) =>
          participant.eventId === event.eventId &&
          ["going", "waitlist"].includes(participant.state),
      )
      .map(({ userId, state }) => ({ userId, state })),
  ],
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
    async townhallEventLifecycle(operation, input) {
      const event = events.get(input.eventId);
      if (operation === "configure") {
        event.minConfirmed = input.minConfirmed;
        event.capacity = input.capacity;
      }
      if (operation === "finalize") event.finalStartAt = input.startsAt;
      if (operation === "rsvp")
        participants.set(`${input.eventId}:${input.actorId}`, {
          eventId: input.eventId,
          userId: input.actorId,
          state: input.state,
        });
      return eventView(event, input.actorId);
    }
    async townhallEventSeries(operation, input) {
      const event = events.get(input.eventId);
      if (operation === "configure") event.durationMinutes = input.durationMinutes;
      return eventView(event, input.actorId);
    }
    async townhallEventFollowup(operation, input) {
      if (operation === "get") return followups.get(input.eventId) ?? null;
      followups.set(input.eventId, {
        scheduledMessageId: input.scheduledMessageId,
        postAt: input.postAt,
      });
      return true;
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
  if (method === "chat.scheduleMessage")
    return Response.json({ ok: true, scheduled_message_id: "Q123" });
  if (method === "chat.deleteScheduledMessage") return Response.json({ ok: true });
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
  assert.match(launcher.text, /날짜가 정해졌다면/);
  assert.deepEqual(launcher.blocks[1].elements.map((item) => item.action_id), [
    "community_event_open_fixed",
    "community_event_open_poll",
    "community_event_demand_open",
    "community_event_host_request_open",
  ]);
  const open = action("community_event_open_poll", "UMEMBER", {
    ownerId: "actor",
    key: "new-townhall-event",
  });
  assert.equal((await communityInteraction(open, env, () => {})).status, 200);
  const createModal = calls.find((call) => call.method === "views.open").body.view;
  assert.deepEqual(
    createModal.blocks.filter((block) => block.type === "input").map((block) => block.block_id),
    ["activity", "location", "minimum", "capacity"],
  );
  assert.doesNotMatch(JSON.stringify(createModal), /가능한 시간 후보|최대 8개|2026-10-10/);
  assert.match(JSON.stringify(createModal), /자동 참가/);

  const invalid = submission("VINVALID", "community_event_submit", createModal.private_metadata, {
    activity: { value: { value: "" } },
    location: { value: { value: "" } },
    minimum: { value: { value: "0" } },
    capacity: { value: { value: "" } },
  });
  const invalidResponse = await communityInteraction(invalid, env, () => {});
  assert.deepEqual(Object.keys((await invalidResponse.json()).errors).sort(), ["activity", "location", "minimum"]);
  const invalidCapacity = submission("VINVALID-CAPACITY", "community_event_submit", createModal.private_metadata, {
    activity: { value: { value: "정원 검사" } },
    location: { value: { value: "서울" } },
    minimum: { value: { value: "3" } },
    capacity: { value: { value: "2" } },
  });
  assert.deepEqual(await (await communityInteraction(invalidCapacity, env, () => {})).json(), {
    response_action: "errors",
    errors: { capacity: "최대 인원은 최소 성사 인원보다 작을 수 없어요." },
  });

  const pending = [];
  const valid = submission("VEVENT-1", "community_event_submit", createModal.private_metadata, {
    activity: { value: { value: "산책 모임\n초보 환영 https://example.com/watch" } },
    location: { value: { value: "성수역 1번 출구" } },
    minimum: { value: { value: "3" } },
    capacity: { value: { value: "" } },
  });
  const response = await communityInteraction(valid, env, (promise) => pending.push(promise));
  assert.deepEqual(await response.json(), { response_action: "clear" });
  await Promise.all(pending.splice(0));
  const post = calls.find((call) => call.method === "chat.postMessage");
  assert.match(post.body.text, /^<!channel> <@UMEMBER>님이 이벤트를 열었어요/);
  assert.match(post.body.text, /\*산책 모임\*\n초보 환영 https:\/\/example[.]com\/watch/);
  assert.doesNotMatch(post.body.text, /example[.]com\/watch\*/);
  assert.doesNotMatch(post.body.text, /리액션은 관심 신호|다음 활동 수요/);
  assert.match(post.body.text, /장소: 성수역 1번 출구/);
  assert.match(post.body.text, /아직 정하지 않았어요/);
  assert.deepEqual(
    post.body.blocks[1].elements.map((item) => item.action_id),
    [
      "community_event_availability",
      "community_event_edit",
      "community_event_open_fixed",
      "community_event_open_poll",
    ],
  );
  assert.deepEqual(
    post.body.blocks[1].elements.slice(-2).map((item) => item.text.text),
    ["나도 일정 정해서 열기", "나도 시간 같이 정하기"],
  );
  assert.doesNotMatch(post.body.text, /관심 \d+명/);

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
  assert.deepEqual(
    editModal.blocks.filter((block) => block.type === "input").map((block) => block.block_id),
    ["activity", "location", "minimum", "capacity"],
  );
  const editValues = {
    activity: { value: { value: "저녁 산책" } },
    location: { value: { value: "서울숲" } },
    minimum: { value: { value: "3" } },
    capacity: { value: { value: "6" } },
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

  calls.length = 0;
  await communityInteraction(
    action("community_event_open_fixed", "UMEMBER", {
      ownerId: "actor",
      key: "new-townhall-event",
    }),
    env,
    () => {},
  );
  const fixedModal = calls.find((call) => call.method === "views.open").body.view;
  assert.deepEqual(
    fixedModal.blocks.filter((block) => block.type === "input").map((block) => block.block_id),
    ["activity", "location", "event_date", "event_hour", "event_minute", "duration", "minimum", "capacity"],
  );
  assert.deepEqual(
    fixedModal.blocks.find((block) => block.block_id === "event_minute").element.options.map((option) => option.value),
    ["00", "15", "30", "45"],
  );
  const fixedPending = [];
  const fixedSubmit = submission("VFIXED", "community_event_submit", fixedModal.private_metadata, {
    activity: { value: { value: "정해진 저녁 모임" } },
    location: { value: { value: "서울숲" } },
    event_date: { value: { selected_date: "2026-10-10" } },
    event_hour: { value: { selected_option: { value: "19" } } },
    event_minute: { value: { selected_option: { value: "15" } } },
    duration: { value: { selected_option: { value: "120" } } },
    minimum: { value: { value: "3" } },
    capacity: { value: { value: "6" } },
  });
  await communityInteraction(fixedSubmit, env, (promise) => fixedPending.push(promise));
  await Promise.all(fixedPending);
  const fixedUpdate = calls.filter((call) => call.method === "chat.update").at(-1).body;
  assert.match(fixedUpdate.text, /최종 일정:/);
  assert.match(fixedUpdate.text, /2026-10-10 19:15 KST/);
  assert.match(fixedUpdate.text, /참가 확정 1명 · 성사 기준 3명 · 최대 인원 6명/);
  assert.deepEqual(
    fixedUpdate.blocks[1].elements.map((item) => item.action_id),
    [
      "community_event_rsvp",
      "community_event_edit",
      "community_event_open_fixed",
      "community_event_open_poll",
    ],
  );
  const fixedThread = calls.find(
    (call) => call.method === "chat.postMessage" && call.body.thread_ts === "200.000001",
  );
  assert.match(fixedThread.body.text, /현재 참가자 1명.*<@UMEMBER>/s);
  assert.doesNotMatch(fixedThread.body.text, /인증|후기/);
  const scheduledReview = calls.find((call) => call.method === "chat.scheduleMessage");
  assert.equal(scheduledReview.body.thread_ts, "200.000001");
  assert.match(scheduledReview.body.text, /<@UMEMBER>님.*짧은 후기/);
  assert.doesNotMatch(scheduledReview.body.text, /인증/);

  calls.length = 0;
  for (const expected of [
    { notice: /참가를 확정했어요/, thread: /<@UATTENDEE>님이 참가해요/, count: /참가 확정 2명/ },
    {
      notice: /참가를 취소했어요/,
      thread: /<@UATTENDEE>님이 참가를 취소했어요/,
      count: /참가 확정 1명/,
    },
  ]) {
    const rsvpPending = [];
    await communityInteraction(
      action("community_event_rsvp", "UATTENDEE", {
        ownerId: "actor",
        key: "VFIXED",
        eventId: "VFIXED",
      }),
      env,
      (promise) => rsvpPending.push(promise),
    );
    await Promise.all(rsvpPending);
    assert.match(
      calls.filter((call) => call.method === "chat.update").at(-1).body.text,
      expected.count,
    );
    assert.match(
      calls.filter((call) => call.method === "chat.postMessage").at(-1).body.text,
      expected.thread,
    );
    assert.match(
      calls.filter((call) => call.method === "chat.postEphemeral").at(-1).body.text,
      expected.notice,
    );
  }

  calls.length = 0;
  await communityInteraction(
    action("community_event_edit", "UMEMBER", {
      ownerId: "UMEMBER",
      key: "VFIXED",
      eventId: "VFIXED",
    }),
    env,
    () => {},
  );
  const fixedEditModal = calls.find((call) => call.method === "views.open").body.view;
  assert.deepEqual(
    fixedEditModal.blocks.filter((block) => block.type === "input").map((block) => block.block_id),
    ["activity", "location", "event_date", "event_hour", "event_minute", "duration", "minimum", "capacity"],
  );
  assert.equal(fixedEditModal.blocks.find((block) => block.block_id === "event_date").element.initial_date, "2026-10-10");
  assert.equal(fixedEditModal.blocks.find((block) => block.block_id === "event_hour").element.initial_option.value, "19");
  assert.equal(fixedEditModal.blocks.find((block) => block.block_id === "event_minute").element.initial_option.value, "15");
  assert.equal(fixedEditModal.blocks.find((block) => block.block_id === "capacity").element.initial_value, "6");
  const fixedEditPending = [];
  const fixedEditSubmit = submission("VFIXED-EDIT", "community_event_submit", fixedEditModal.private_metadata, {
    activity: { value: { value: "정해진 저녁 모임" } },
    location: { value: { value: "서울숲" } },
    event_date: { value: { selected_date: "2026-10-11" } },
    event_hour: { value: { selected_option: { value: "18" } } },
    event_minute: { value: { selected_option: { value: "45" } } },
    duration: { value: { selected_option: { value: "90" } } },
    minimum: { value: { value: "4" } },
    capacity: { value: { value: "" } },
  });
  await communityInteraction(fixedEditSubmit, env, (promise) => fixedEditPending.push(promise));
  await Promise.all(fixedEditPending);
  const changedFixed = calls.filter((call) => call.method === "chat.update").at(-1).body.text;
  assert.match(changedFixed, /참가 확정 1명 · 성사 기준 4명 · 최대 인원 무제한/);
  assert.match(changedFixed, /2026-10-11 18:45 KST/);

  console.log(
    "PASS townhall event: fixed events stay in Slack, polls use one web commitment, and edits preserve state",
  );
} finally {
  globalThis.fetch = originalFetch;
}
