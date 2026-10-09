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
  PO_DEVELOPMENT_DIAGRAM_URL: "https://example.test/po-workflow.png",
};
const definitions = maintainerCanvasDefinitions(env);
assert.equal(definitions.length, 4);
assert.doesNotMatch(JSON.stringify(definitions),/maintainer/i,"no retired role name in user-facing Canvas content");
assert.match(definitions[1].markdown,/!\[\]\(https:\/\/example.test\/po-workflow.png\)/);
for(const phrase of ["GenQuant", "직접 만든 PR 검토 요청", "bun run check", "QA 체크리스트", "최신 SHA", "어느 폴더", "운영 키", "DRI"])
  assert(definitions[1].markdown.includes(phrase),`developer guide must explain ${phrase}`);
assert.match(definitions[0].markdown, /여기서 얻는 것/);
assert.match(definitions[0].markdown, /코딩은 필수가 아닙니다/);
assert.match(definitions[1].markdown, /봇 작업 보관함이 아니라/);
assert.match(definitions[2].markdown, /포트폴리오/);
assert.match(definitions[3].markdown, /retention 숫자를 관리하는 곳이 아니라/);

const calls = [];
let existingShape="none";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = new URL(url).pathname.split("/").at(-1);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ method, body });
  if (method === "conversations.info")
    return Response.json({ ok: true, channel: { properties: existingShape==="tabs" ? {tabs:[{type:"bookmarks"},{type:"canvas",data:{file_id:"FEXISTING"}}]} : existingShape==="legacy" ? {canvas:{file_id:"FLEGACY"}} : {} } });
  if (method === "canvases.edit") return Response.json({ok:true});
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
  assert.equal(calls.filter(c=>c.method==="canvases.edit"&&c.body.changes[0].operation==="rename").length,4);
  assert(calls.filter(c=>c.method==="canvases.edit").every(c=>c.body.changes.length===1));
  for(const shape of ["tabs","legacy"]){
    existingShape=shape;calls.length=0;
    const updated=await publishMaintainerCanvases(env);
    assert.equal(calls.filter(c=>c.method==="conversations.canvases.create").length,0,"reuse existing tab instead of duplicating Canvas");
    assert.equal(calls.filter(c=>c.method==="canvases.edit").length,8);
    assert.deepEqual(calls.filter(c=>c.method==="canvases.edit"&&c.body.changes[0].operation==="rename").map(c=>c.body.changes[0].title_content.markdown),definitions.map(d=>d.title));
    assert(updated.every(r=>r.canvasId===(shape==="tabs"?"FEXISTING":"FLEGACY")));
  }
  calls.length=0;
  await assert.rejects(()=>publishMaintainerCanvases({...env,PO_DEVELOPMENT_DIAGRAM_URL:undefined}),/이미지 URL/);
  assert.equal(calls.length,0,"missing image must fail before mutating any channel or Canvas");
  console.log("PASS Maintainer canvases lead with member value and publish one channel canvas each");
} finally {
  globalThis.fetch = originalFetch;
}
