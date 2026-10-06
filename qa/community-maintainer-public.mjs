import assert from "node:assert/strict";
import { handleMaintainerPublicRequest } from "../src/community-maintainer-public.ts";
import { signReferralServiceRequest } from "../src/community-referral-service-auth.ts";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/sql");
  const body = JSON.parse(options.body);
  assert.equal(body.params[0], "public_work_list");
  return Response.json({ rows: [[JSON.stringify([
    {
      key: "BUG-PRIVATE-KEY",
      title: "이벤트 시간 수정",
      stage: "deploying",
      hasDri: true,
      sourceChannel: "CFEEDBACK",
      sourceThread: "1790000000.000001",
      updatedAt: "2026-10-06T08:00:00.000Z",
    },
  ])]] });
};

const secret = "test-secret";
const timestamp = Math.floor(Date.now() / 1000);
const nonce = "maintainer-public-test";
const body = "{}";
const path = "/internal/maintainers/status";
const signature = await signReferralServiceRequest(
  { method: "POST", path, body, timestamp, nonce },
  secret,
);
const env = {
  DATABASE_URL: "postgresql://runtime:secret@test.neon.tech/db?sslmode=require",
  SLACK_TEAM_ID: "TQA",
  COMMUNITY_ADMIN_ID: "UADMIN",
  COMMUNITY_FEEDBACK_CHANNEL_ID: "CFEEDBACK",
  COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAIN",
  SITE_CORE_HMAC_SECRET: secret,
};

try {
  const request = new Request(`https://core.example${path}`, {
    method: "POST",
    headers: {
      "x-otl-timestamp": String(timestamp),
      "x-otl-nonce": nonce,
      "x-otl-signature": signature,
    },
    body,
  });
  const response = await handleMaintainerPublicRequest(request, env);
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.deepEqual(value.items[0], {
    title: "이벤트 시간 수정",
    lane: "review_release",
    statusLabel: "반영 중",
    progressSummary: "승인된 변경을 운영에 반영하고 있어요.",
    nextActionLabel: "운영 확인 기다리기",
    hasDri: true,
    sourceLabel: "회원 피드백",
    slackUrl:
      "https://app.slack.com/client/TQA/CFEEDBACK/thread/CFEEDBACK-1790000000.000001",
    updatedAt: "2026-10-06T08:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(value), /BUG-PRIVATE-KEY|linear|sourceChannel|sourceThread/);
  const unauthorized = await handleMaintainerPublicRequest(
    new Request(`https://core.example${path}`, { method: "POST", body }),
    env,
  );
  assert.equal(unauthorized.status, 401);
  console.log("PASS bounded Maintainer projection authenticates the site and hides internal identifiers");
} finally {
  globalThis.fetch = originalFetch;
}
