import assert from "node:assert/strict";
import { activateMaintainer, deactivateMaintainer, maintainerButton } from "../src/community-maintainers.ts";

const calls = [];
const transitions = [];
const context = {
  env: {
    SLACK_BOT_TOKEN: "token",
    COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAINTAIN",
    COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS: "CMAINEVENT,CMAINWEB,CMAINWELCOME",
  },
  scope: { teamId: "TQA", channelId: "CWELCOME", userId: "UMEMBER" },
  store: {
    async activateMaintainer(teamId, actorId) {
      transitions.push(["activate", teamId, actorId]);
      return { teamId, userId: actorId, state: "active", revision: 1 };
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
  assert.deepEqual(calls.slice(0, 4).map((call) => call.method), Array(4).fill("conversations.invite"));
  assert.ok(calls.slice(0, 4).every((call) => call.body.users === "UMEMBER"));
  assert.equal(calls[4].method, "chat.postEphemeral");
  assert.equal(calls[4].body.user, "UMEMBER");
  assert.match(calls[4].body.text, /공개 GitHub 저장소.*fork/);
  assert.match(calls[4].body.text, /정확한 SHA.*Deployment Broker/);
  assert.match(calls[4].body.text, /CONTRIBUTING[.]md/);
  assert.equal(calls[5].method, "chat.postMessage");
  assert.equal(calls[5].body.channel, "CMAINTAIN");
  await deactivateMaintainer(context);
  assert.deepEqual(transitions[1], ["deactivate", "TQA", "UMEMBER"]);
  assert.equal(calls[6].method, "chat.postEphemeral");
  assert.match(calls[6].body.text, /승인 권한/);
  console.log("PASS maintainer self-activation, public channel notice, and self-deactivation");
} finally {
  globalThis.fetch = originalFetch;
}
