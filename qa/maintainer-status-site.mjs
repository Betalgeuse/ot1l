import assert from "node:assert/strict";
import worker from "../site/src/index.ts";

const env = {
  SITE_CORE_HMAC_SECRET: "test-secret",
  CORE: {
    async fetch(request) {
      assert.equal(new URL(request.url).pathname, "/internal/maintainers/status");
      assert.equal(request.method, "POST");
      assert.match(request.headers.get("x-otl-signature") ?? "", /^[0-9a-f]{64}$/);
      return Response.json({ items: [
        { key: "BUG-QA", title: "이벤트 시간 수정", stage: "작업 중", identifier: "OT1-12",
          sourceChannel: "CFEEDBACK", sourceThread: "1790000000.000001",
          slackUrl: "https://app.slack.com/client/TQA/CFEEDBACK/thread/CFEEDBACK-1790000000.000001",
          updatedAt: "2026-10-05T08:00:00.000Z" },
      ] });
    },
  },
  ASSETS: { async fetch() { return new Response("not found", { status: 404 }); } },
  RATE_LIMITER: { async limit() { return { success: true }; } },
};
const legacy = await worker.fetch(new Request("https://ot1l.hyuk.me/maintainers"), env);
assert.equal(legacy.status, 308);
assert.equal(legacy.headers.get("location"), "/po");
const response = await worker.fetch(new Request("https://ot1l.hyuk.me/po"), env);
assert.equal(response.status, 200);
const html = await response.text();
assert.match(html, /회원의 의견이/);
assert.match(html, /Product Owner\(PO\)는 코딩 여부와 관계없이/);
assert.match(html, /이벤트 시간 수정/);
assert.match(html, /작업 중/);
assert.match(html, /OT1-12/);
assert.match(html, /Slack에서 보기/);
assert.doesNotMatch(html, /As-Is|To-Be|linear[.]app/);
console.log("PASS optional Plane-inspired status page reads only the bounded public projection");
