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
const names = {
  CMAIN: "maintainers",
  CBUILD: "maintainers-dev",
  CDESIGN: "maintainers-design",
  CCOMMUNITY: "maintainers-retention",
};
const canvases = new Map();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const method = parsed.pathname.split("/").at(-1);
  const body = options.body ? JSON.parse(options.body) : {};
  if (method === "conversations.info") body.channel = parsed.searchParams.get("channel");
  calls.push({ method, body });
  if (method === "conversations.info") {
    const canvas = canvases.get(body.channel);
    return Response.json({ ok: true, channel: {
      name: names[body.channel],
      properties: canvas ? { tabs: [{ type: "canvas", data: { file_id: canvas } }] } : {},
    } });
  }
  if (method === "conversations.setTopic" || method === "conversations.setPurpose")
    return Response.json({ ok: true });
  if (method === "conversations.canvases.create") {
    const canvasId = `F${body.channel_id}`;
    canvases.set(body.channel_id, canvasId);
    return Response.json({ ok: true, canvas_id: canvasId });
  }
  if (method === "canvases.edit") return Response.json({ ok: true });
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
  assert.equal(creates.every((call) => !call.body.document_content.markdown.startsWith("# ")), true);
  const repeated = await publishMaintainerCanvases(env);
  assert.deepEqual(repeated, receipts);
  assert.equal(calls.filter((call) => call.method === "conversations.canvases.create").length, 4);
  assert.equal(calls.filter((call) => call.method === "canvases.edit").length, 4);
  assert.equal(calls.filter((call) => call.method === "conversations.info").length, 16);
  console.log("PASS Maintainer canvases preflight exact channels and update idempotently with readback");
} finally {
  globalThis.fetch = originalFetch;
}
