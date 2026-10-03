import assert from "node:assert/strict";
import {
  closeEventDemand,
  eventDemandMessage,
  openDemandHostingModal,
  openEventDemandModal,
  parseEventDemand,
  submitEventDemand,
} from "../src/community-event-demands.ts";

let demand = null;
const calls = [];
const store = {
  async townhallEventDemand(op, input) {
    if (op === "create" && !demand)
      demand = {
        teamId: input.teamId,
        channelId: input.channelId,
        demandId: input.demandId,
        requesterUserId: input.actorId,
        mode: input.mode,
        activity: input.activity,
        description: input.description,
        locationHint: input.locationHint,
        timingHint: input.timingHint,
        status: "draft",
        messageTs: null,
        revision: 1,
        events: [],
      };
    if (op === "bind") demand = { ...demand, status: "active", messageTs: input.messageTs };
    if (op === "edit")
      demand = { ...demand, ...input, status: "active", revision: demand.revision + 1 };
    if (op === "close") demand = { ...demand, status: "closed", revision: demand.revision + 1 };
    return demand;
  },
};
const context = {
  env: { SLACK_BOT_TOKEN: "token", COMMUNITY_RELEASE_CHANNEL_ID: "CTOWN" },
  store,
  scope: { teamId: "TQA", channelId: "CTOWN", userId: "UREQUEST" },
  thread: "100.1",
  source: "100.1",
  date: "2026-10-03",
  key: "qa",
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = new URL(String(url)).pathname.split("/").at(-1);
  const body = options.body ? JSON.parse(String(options.body)) : {};
  calls.push({ method, body });
  if (method === "views.open") return Response.json({ ok: true });
  if (method === "conversations.history") return Response.json({ ok: true, messages: [] });
  if (method === "chat.postMessage") return Response.json({ ok: true, ts: "200.000001" });
  if (method === "chat.update") return Response.json({ ok: true, ts: body.ts });
  if (method === "chat.postEphemeral") return Response.json({ ok: true, message_ts: "201.000001" });
  throw new Error(`unexpected ${method}`);
};
try {
  await openEventDemandModal(context, "TRIGGER", "host_request");
  const modal = calls.find((c) => c.method === "views.open").body.view;
  assert.equal(modal.callback_id, "community_event_demand_submit");
  assert.deepEqual(
    modal.blocks.filter((b) => b.type === "input").map((b) => b.block_id),
    ["activity", "description", "location", "timing"],
  );
  const parsed = parseEventDemand(
    {
      state: {
        values: {
          activity: { value: { value: "고전 읽기" } },
          description: { value: { value: "한 달 동안 함께 읽어요" } },
          location: { value: { value: "온라인" } },
          timing: { value: { value: "10월" } },
        },
      },
    },
    "host_request",
  );
  assert.equal(parsed.activity, "고전 읽기");
  await submitEventDemand(context, "VDEMAND01", parsed, { mode: "host_request" });
  assert.equal(demand.status, "active");
  assert.equal(demand.messageTs, "200.000001");
  assert.match(eventDemandMessage(demand).text, /주최자 찾는 중/);
  assert.equal(eventDemandMessage(demand).blocks[1].elements[0].text.text, "내가 주최할래요!");
  calls.length = 0;
  await openDemandHostingModal(
    { ...context, scope: { ...context.scope, userId: "UHOST" } },
    "HOST",
    demand,
  );
  const eventModal = calls.find((c) => c.method === "views.open").body.view;
  assert.equal(JSON.parse(eventModal.private_metadata).demandId, demand.demandId);
  assert.match(
    eventModal.blocks.find((b) => b.block_id === "activity").element.initial_value,
    /고전 읽기/,
  );
  demand = {
    ...demand,
    events: [{ eventId: "VEVENT", hostUserId: "UHOST", messageTs: "300.000001" }],
  };
  assert.equal(eventDemandMessage(demand).blocks[1].elements[0].text.text, "나도 주최하기");
  assert.match(eventDemandMessage(demand).text, /UHOST/);
  await closeEventDemand(context, demand.demandId);
  assert.equal(demand.status, "closed");
  assert.equal(eventDemandMessage(demand).blocks.length, 1);
  console.log("PASS event demand: request modal, card, host prefill, multiple hosts, and close");
} finally {
  globalThis.fetch = originalFetch;
}
