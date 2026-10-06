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
        { title: "이벤트 시간 수정", lane: "doing", statusLabel: "진행 중", hasDri: true,
          sourceLabel: "회원 피드백", progressSummary: "담당자가 해결안을 만들고 있어요.",
          nextActionLabel: "해결안 검증하기",
          slackUrl: "https://app.slack.com/client/TQA/CFEEDBACK/thread/CFEEDBACK-1790000000.000001",
          updatedAt: "2026-10-05T08:00:00.000Z" },
        { title: "배포 확인", lane: "review_release", statusLabel: "반영 중", hasDri: false,
          sourceLabel: "Maintainer 제안", progressSummary: "운영에 반영하고 있어요.",
          nextActionLabel: "운영 확인 기다리기",
          slackUrl: "https://app.slack.com/client/TQA/CMAIN/thread/CMAIN-1790000000.000002",
          updatedAt: "2026-10-05T09:00:00.000Z" },
      ] });
    },
  },
  ASSETS: { async fetch() { return new Response("not found", { status: 404 }); } },
  RATE_LIMITER: { async limit() { return { success: true }; } },
};
const response = await worker.fetch(new Request("https://ot1l.hyuk.me/maintainers"), env);
assert.equal(response.status, 200);
const html = await response.text();
assert.match(html, /회원의 의견이/);
assert.match(html, /이벤트 시간 수정/);
assert.match(html, /진행 중/);
assert.match(html, /회원 피드백/);
assert.match(html, /DRI/);
assert.match(html, /해결안 검증하기/);
assert.match(html, /검토·반영/);
assert.match(html, /Slack에서 보기/);
assert.doesNotMatch(html, /BUG-QA|OT1-12|As-Is|To-Be|linear[.]app/);

const unavailable = await worker.fetch(new Request("https://ot1l.hyuk.me/maintainers"), {
  ...env,
  CORE: { async fetch() { return new Response("unavailable", { status: 503 }); } },
});
assert.equal(unavailable.status, 503);
assert.match(await unavailable.text(), /진행 중인 작업이 없다는 뜻은 아닙니다/);
console.log("PASS status board groups bounded cards and distinguishes unavailable from empty");
