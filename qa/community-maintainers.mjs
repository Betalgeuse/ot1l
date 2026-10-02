import assert from "node:assert/strict";
import { activateMaintainer, deactivateMaintainer, maintainerButton } from "../src/community-maintainers.ts";

const calls = [];
const transitions = [];
const context = {
  env: {
    SLACK_BOT_TOKEN: "token",
    COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAINTAIN",
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
  assert.equal(calls[0].method, "chat.postEphemeral");
  assert.equal(calls[0].body.user, "UMEMBER");
  assert.match(calls[0].body.text, /Open 변경.*승인·병합·배포/);
  assert.equal(calls[1].method, "chat.postMessage");
  assert.equal(calls[1].body.channel, "CMAINTAIN");
  await deactivateMaintainer(context);
  assert.deepEqual(transitions[1], ["deactivate", "TQA", "UMEMBER"]);
  assert.equal(calls[2].method, "chat.postEphemeral");
  console.log("PASS maintainer self-activation, public channel notice, and self-deactivation");
} finally {
  globalThis.fetch = originalFetch;
}
