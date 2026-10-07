import assert from "node:assert/strict";
import {
  currentProductOwnerSpecialties,
  openProductOwnerMention,
  openProductOwnerSpecialties,
  setProductOwnerSpecialties,
  submitProductOwnerMention,
  submitProductOwnerSpecialties,
} from "../src/community-product-owner-groups.ts";

const calls = [];
const specialties = new Map([["UPO", ["designer"]]]);
const members = [
  { userId: "UPO", specialties: ["designer", "dev"] },
  { userId: "UDEV", specialties: ["dev"] },
  { userId: "UDESIGN", specialties: ["designer"] },
];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const body = options.body ? JSON.parse(options.body) : {};
  if (parsed.hostname.endsWith(".neon.tech")) {
    const op = body.params[0];
    const payload = JSON.parse(body.params[1]);
    calls.push({ method: `db:${op}`, body: payload });
    let result;
    if (op === "get") result = specialties.get(payload.actorId) ?? [];
    else if (op === "set") {
      result = [...new Set(payload.specialties)].sort();
      specialties.set(payload.actorId, result);
    } else if (op === "members") {
      result = members
        .filter(
          (member) =>
            payload.audience === "po" ||
            (payload.audience === "po-designer" && member.specialties.includes("designer")) ||
            (payload.audience === "po-dev" && member.specialties.includes("dev")),
        )
        .map((member) => member.userId);
    } else throw new Error(`unexpected DB op ${op}`);
    return Response.json({ rows: [[JSON.stringify(result)]] });
  }
  const method = parsed.pathname.split("/").at(-1);
  calls.push({ method, body });
  if (
    method === "views.open" ||
    method === "chat.postEphemeral" ||
    method === "chat.postMessage"
  )
    return Response.json({ ok: true, ts: "1.000002", message_ts: "1.000002" });
  throw new Error(`unexpected ${method}`);
};

const context = {
  env: {
    SLACK_BOT_TOKEN: "fake",
    SLACK_TEAM_ID: "TQA",
    COMMUNITY_ADMIN_ID: "UADMIN",
    DATABASE_URL: "postgresql://test:test@test.neon.tech/db",
  },
  scope: { teamId: "TQA", channelId: "CPO", userId: "UPO" },
  source: "1.000001",
  thread: "1.000001",
  date: "2026-10-07",
  store: {
    async maintainerStatus() {
      return { state: "active" };
    },
  },
};

try {
  assert.deepEqual(await currentProductOwnerSpecialties(context), ["designer"]);

  await openProductOwnerSpecialties(context, "trigger");
  const specialtyModal = calls.find((call) => call.method === "views.open").body.view;
  assert.equal(specialtyModal.callback_id, "community_po_specialties_submit");
  assert.deepEqual(JSON.parse(specialtyModal.private_metadata), {
    userId: "UPO",
    channelId: "CPO",
    date: "2026-10-07",
    source: "1.000001",
    thread: "1.000001",
  });
  assert.deepEqual(
    specialtyModal.blocks[0].element.initial_options.map((option) => option.value),
    ["designer"],
  );

  await submitProductOwnerSpecialties(context, {
    state: {
      values: {
        specialties: { value: { selected_options: [{ value: "dev" }] } },
      },
    },
  });
  assert.deepEqual(await currentProductOwnerSpecialties(context), ["dev"]);
  assert.match(
    calls.filter((call) => call.method === "chat.postEphemeral").at(-1).body.text,
    /@po-dev/,
  );

  await setProductOwnerSpecialties(context, ["designer", "dev"]);
  assert.deepEqual(await currentProductOwnerSpecialties(context), ["designer", "dev"]);

  await openProductOwnerMention(context, "trigger-mention");
  const mentionModal = calls.filter((call) => call.method === "views.open").at(-1).body.view;
  assert.equal(mentionModal.callback_id, "community_po_mention_submit");
  assert.deepEqual(
    mentionModal.blocks[0].element.options.map((option) => option.value),
    ["po", "po-designer", "po-dev"],
  );
  await submitProductOwnerMention(context, {
    state: {
      values: {
        audience: { value: { selected_option: { value: "po-dev" } } },
        message: { value: { value: "이벤트 신청 흐름을 같이 봐주세요." } },
      },
    },
  });
  const mention = calls.filter((call) => call.method === "chat.postMessage").at(-1).body;
  assert.equal(mention.channel, "CPO");
  assert.equal(mention.thread_ts, "1.000001");
  assert.match(mention.text, /<@UPO> <@UDEV>/);
  assert.doesNotMatch(mention.text, /<@UDESIGN>/);
  assert.match(mention.text, /@po-dev/);
  console.log("PASS Product Owner audiences persist, specialize and send bounded Slack mentions");
} finally {
  globalThis.fetch = originalFetch;
}
