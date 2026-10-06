import assert from "node:assert/strict";
import {
  maintainerCanvasDefinitions,
  publishMaintainerCanvases,
} from "../src/community-maintainer-canvases.ts";

const env = {
  SLACK_BOT_TOKEN: "fake",
  COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAIN",
  COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS: "CBUILD,CDESIGN,CCOMMUNITY",
  COMMUNITY_FEEDBACK_CHANNEL_ID: "CFEEDBACK",
  COMMUNITY_RELEASE_CHANNEL_ID: "CEVENTS",
  COMMUNITY_SYS_ALERT_CHANNEL_ID: "CALERT",
};
const definitions = maintainerCanvasDefinitions(env);
assert.equal(definitions.length, 4);
assert.match(definitions[0].markdown, /여기서 얻는 것/);
assert.match(definitions[0].markdown, /코딩은 필수가 아닙니다/);
assert.match(definitions[1].markdown, /봇 작업 보관함이 아니라/);
assert.match(definitions[2].markdown, /포트폴리오/);
assert.match(definitions[3].markdown, /retention 숫자를 관리하는 곳이 아니라/);

const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = new URL(url).pathname.split("/").at(-1);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ method, body });
  if (method === "conversations.info")
    return Response.json({ ok: true, channel: { properties: {} } });
  if (method === "conversations.setTopic" || method === "conversations.setPurpose")
    return Response.json({ ok: true });
  if (method === "conversations.canvases.create")
    return Response.json({ ok: true, canvas_id: `F${body.channel_id}` });
  throw new Error(`unexpected ${method}`);
};
try {
  const receipts = await publishMaintainerCanvases(env);
  assert.equal(receipts.length, 4);
  assert.equal(calls.filter((call) => call.method === "conversations.setTopic").length, 4);
  assert.equal(calls.filter((call) => call.method === "conversations.setPurpose").length, 4);
  const creates = calls.filter((call) => call.method === "conversations.canvases.create");
  assert.deepEqual(
    creates.map((call) => call.body.channel_id),
    ["CMAIN", "CBUILD", "CDESIGN", "CCOMMUNITY"],
  );
  assert.equal(creates.every((call) => call.body.document_content.type === "markdown"), true);
  assert.equal(creates.every((call) => call.body.document_content.markdown.length > 300), true);
  console.log("PASS Maintainer canvases lead with member value and publish one channel canvas each");
} finally {
  globalThis.fetch = originalFetch;
}
