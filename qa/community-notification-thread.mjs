import assert from "node:assert/strict";
import { postNotificationReply } from "../src/community-notification-thread.ts";
const original = globalThis.fetch;
const posts = [], deletes = [];
let mode = "missing", reply;
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  const body = options.body ? JSON.parse(options.body) : {};
  if (path.endsWith("conversations.replies")) {
    assert.equal(new URL(url).searchParams.get("include_all_metadata"), "true");
    if (mode === "missing") return Response.json({ok:false,error:"thread_not_found"});
    if (mode === "unavailable") return Response.json({ok:false,error:"internal_error"});
    return Response.json({ok:true,messages:[{ts:"1.1",text:"canonical root"}, ...(reply ? [reply] : [])]});
  }
  if (path.endsWith("chat.postMessage")) {
    posts.push(body);
    reply = {...body,ts:"2.2",bot_id:"BQA"};
    if (mode === "lost-response") throw new Error("accepted but response lost");
    return Response.json({ok:true,ts:"2.2",message: mode === "deleted-race" ? {} : {thread_ts:"1.1"}});
  }
  if (path.endsWith("chat.delete")) { deletes.push(body); return Response.json({ok:true}); }
  throw new Error("unexpected API");
};
const send = () => postNotificationReply("fake", "CQA", "1.1", 42, {text:"done"});
try {
  assert.equal(await send(), false);
  assert.equal(posts.length, 0);
  mode = "unavailable";
  await assert.rejects(send);
  assert.equal(posts.length, 0);
  mode = "lost-response";
  await assert.rejects(send);
  assert.equal(await send(), true);
  assert.equal(posts.length, 1, "uncertain acceptance must not repost");
  reply = undefined;
  mode = "deleted-race";
  await assert.rejects(send, /parent disappeared/);
  assert.deepEqual(deletes, [{channel:"CQA",ts:"2.2"}]);
  console.log("PASS missing/deleted parent, read failure, response-loss reconciliation, orphan cleanup");
} finally { globalThis.fetch = original; }
