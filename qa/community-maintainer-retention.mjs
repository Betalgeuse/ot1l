import assert from "node:assert/strict";
import {
  claimMaintainerHelp,
  maintainerRetentionGuide,
  openMaintainerHelpModal,
  publishMaintainerRetentionGuide,
  submitMaintainerHelp,
} from "../src/community-maintainer-retention.ts";

const calls = [];
const original = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = new URL(url).pathname.split("/").at(-1);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ method, body });
  if (method === "conversations.history") return Response.json({ ok: true, messages: [] });
  if (method === "chat.postMessage") return Response.json({ ok: true, ts: "1.000001" });
  if (method === "views.open") return Response.json({ ok: true });
  if (method === "pins.add") return Response.json({ ok: true });
  throw new Error(`unexpected ${method}`);
};
const context = {
  env: { SLACK_BOT_TOKEN: "fake", COMMUNITY_RETENTION_CHANNEL_ID: "CRETENTION" },
  scope: { teamId: "TQA", channelId: "CRETENTION", userId: "UREQUEST" },
  source: "1.000001", thread: "1.000001", date: "2026-10-05", key: "qa",
  store: { async maintainerStatus(_team, user) { return user === "UHELPER" ? { state: "active" } : null; } },
};
try {
  const guide = maintainerRetentionGuide("CMAIN");
  assert.match(JSON.stringify(guide.blocks), /Q&A 허들/);
  assert.match(guide.text, /<#CMAIN>/);
  assert.deepEqual(guide.blocks[1].elements.map((item) => item.text.text), ["질문 남기기", "Q&A 허들 요청", "첫 기여 OT 요청", "작업 제안하기"]);
  assert.equal(new Set(guide.blocks[1].elements.map((item) => item.action_id)).size, 4);
  await publishMaintainerRetentionGuide({ SLACK_BOT_TOKEN: "fake", COMMUNITY_RETENTION_CHANNEL_ID: "CRETENTION", COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAIN" });
  assert.equal(calls.filter((call) => call.method === "pins.add").length, 2);
  assert.equal(calls.some((call) => call.method === "chat.postMessage" && call.body.channel === "CMAIN" && call.body.text.includes("Maintainer 작업 시작")), true);
  await openMaintainerHelpModal(context, "trigger", "qna");
  const modal = calls.find((call) => call.method === "views.open").body.view;
  assert.equal(modal.callback_id, "community_maintainer_help_submit");
  assert.equal(JSON.parse(modal.private_metadata).mode, "qna");
  await submitMaintainerHelp(context, { id: "VIEW1", state: { values: {
    topic: { value: { value: "Linear DRI 변경을 같이 보고 싶어요" } },
    times: { value: { value: "월요일 19시" } },
  } } }, "qna");
  const request = calls.filter((call) => call.method === "chat.postMessage").at(-1);
  assert.equal(request.body.channel, "CRETENTION");
  assert.match(request.body.text, /허들을 시작/);
  await claimMaintainerHelp({ ...context, scope: { ...context.scope, userId: "UHELPER" } }, "UREQUEST");
  const claim = calls.filter((call) => call.method === "chat.postMessage").at(-1);
  assert.match(claim.body.text, /<@UHELPER>님이 도와드릴게요/);
  console.log("PASS Maintainer retention guide, Q&A/OT request modal and active-helper claim");
} finally {
  globalThis.fetch = original;
}
