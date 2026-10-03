import assert from "node:assert/strict";
import { activateMaintainer, deactivateMaintainer, maintainerButton } from "../src/community-maintainers.ts";

const calls = [];
const transitions = [];
let activationChanged = true;
const context = {
  env: {
    SLACK_BOT_TOKEN: "token",
    COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAINTAIN",
    COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS: "CMAINEVENT,CMAINWEB,CMAINWELCOME",
    COMMUNITY_SYS_ALERT_CHANNEL_ID: "CSYSALERT",
  },
  scope: { teamId: "TQA", channelId: "CWELCOME", userId: "UMEMBER" },
  store: {
    async activateMaintainer(teamId, actorId) {
      transitions.push(["activate", teamId, actorId]);
      const changed = activationChanged;
      activationChanged = false;
      return { teamId, userId: actorId, state: "active", revision: 1, changed };
    },
    async deactivateMaintainer(teamId, actorId) {
      transitions.push(["deactivate", teamId, actorId]);
      return true;
    },
  },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  calls.push({ method: new URL(url).pathname.split("/").at(-1), body: JSON.parse(options.body) });
  return Response.json({ ok: true, message_ts: "100.1", ts: "100.2" });
};
try {
  const button = maintainerButton();
  assert.equal(button.action_id, "community_maintainer_activate");
  assert.equal(JSON.parse(button.value).ownerId, "actor");
  await activateMaintainer(context);
  assert.deepEqual(transitions[0], ["activate", "TQA", "UMEMBER"]);
  assert.deepEqual(calls.slice(0, 5).map((call) => call.method), Array(5).fill("conversations.invite"));
  assert.ok(calls.slice(0, 5).every((call) => call.body.users === "UMEMBER"));
  assert.equal(calls[4].body.channel, "CSYSALERT");
  assert.equal(calls[5].method, "chat.postEphemeral");
  assert.equal(calls[5].body.user, "UMEMBER");
  assert.match(calls[5].body.text, /공개 GitHub 저장소.*fork/);
  assert.match(calls[5].body.text, /정확한 SHA.*Deployment Broker/);
  assert.match(calls[5].body.text, /CONTRIBUTING[.]md/);
  assert.match(calls[5].body.text, /운영 알림 <#CSYSALERT>/);
  assert.equal(calls[6].method, "chat.postMessage");
  assert.equal(calls[6].body.channel, "CMAINTAIN");
  await activateMaintainer(context);
  assert.deepEqual(calls.slice(7, 12).map((call) => call.method), Array(5).fill("conversations.invite"));
  assert.equal(calls[12].method, "chat.postEphemeral");
  assert.match(calls[12].body.text, /이미 Maintainer/);
  assert.equal(calls.filter((call) => call.method === "chat.postMessage").length, 1);
  await deactivateMaintainer(context);
  assert.deepEqual(transitions[2], ["deactivate", "TQA", "UMEMBER"]);
  assert.equal(calls[13].method, "conversations.kick");
  assert.equal(calls[13].body.channel, "CSYSALERT");
  assert.equal(calls[13].body.user, "UMEMBER");
  assert.equal(calls[14].method, "chat.postEphemeral");
  assert.match(calls[14].body.text, /승인 권한/);
  assert.match(calls[14].body.text, /운영 알림 접근도 해제/);

  const failedTransitions = [];
  const failedContext = {
    ...context,
    store: {
      ...context.store,
      async activateMaintainer() {
        failedTransitions.push("activate");
        return { teamId: "TQA", userId: "UMEMBER", state: "active", revision: 1, changed: true };
      },
    },
  };
  globalThis.fetch = async () => Response.json({ ok: false, error: "missing_scope" });
  await assert.rejects(activateMaintainer(failedContext), /missing_scope/);
  assert.deepEqual(failedTransitions, [], "Slack enrollment failure must not grant approval authority");
  console.log("PASS maintainer self-activation, public channel notice, and self-deactivation");
} finally {
  globalThis.fetch = originalFetch;
}
