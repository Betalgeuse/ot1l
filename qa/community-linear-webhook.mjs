import assert from "node:assert/strict";
import { handleLinearWebhook } from "../src/community-linear-webhook.ts";
import { sign } from "../src/signing.ts";

const teamId = "b2e0bc66-7bea-466c-b65e-2495e8d3edb9";
const organizationId = "8c031438-a94b-4edd-838e-98d4bd616ed1";
const issueId = "11111111-1111-4111-8111-111111111111";
const linearUserId = "22222222-2222-4222-8222-222222222222";
const secret = "linear-webhook-test-secret";
const work = {
  work_key: "BUG-QA", title: "테스트", actual: "현재", expected: "원하는 상태", reporter_id: "UREPORT", desired_dri: "UMAIN",
  dri_user_id: "UMAIN", sync_state: "synced", issue_state: "작업 중", release_stage: null,
  linear_identifier: "OT1-1", linear_url: "https://linear.app/betalgeuse/issue/OT1-1/test",
  linear_issue_id: issueId, source_channel: "CFEEDBACK", source_thread: "1.000001",
};
const calls = [];
let firstReceipt = true;
const original = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ pathname: parsed.pathname, body });
  if (parsed.pathname === "/sql") {
    const op = body.params?.[0];
    let value;
    if (op === "receipt_claim") { value = firstReceipt; firstReceipt = false; }
    else if (op === "work_by_issue" || op === "work_sync" || op === "work_get") value = work;
    else if (op === "members") value = [{ userId: "UMAIN", displayName: "Main", linearUserId, linearState: "linked" }];
    else if (op === "surface_get") value = "2.000002";
    else if (op === "surface_put") value = "1.000001";
    else throw new Error(`unexpected op ${op}`);
    return Response.json({ rows: [[JSON.stringify(value)]] });
  }
  if (parsed.pathname.endsWith("/chat.update")) return Response.json({ ok: true, ts: body.ts });
  throw new Error(`unexpected ${parsed.pathname}`);
};
const env = {
  DATABASE_URL: "postgresql://runtime:secret@test.neon.tech/db?sslmode=require",
  SLACK_TEAM_ID: "TQA", SLACK_BOT_TOKEN: "fake", COMMUNITY_ADMIN_ID: "UADMIN",
  COMMUNITY_FEEDBACK_CHANNEL_ID: "CFEEDBACK", COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAIN",
  MAINTAINER_LINEAR_ENABLED: "true", LINEAR_API_KEY: "lin_api_issue",
  LINEAR_ADMIN_API_KEY: "lin_api_admin", LINEAR_WEBHOOK_SECRET: secret,
  LINEAR_TEAM_ID: teamId, LINEAR_ORGANIZATION_ID: organizationId, LINEAR_GUEST_SEAT_LIMIT: "1",
};
const payload = {
  type: "Issue", action: "update", organizationId,
  webhookTimestamp: Date.now(), webhookId: "33333333-3333-4333-8333-333333333333",
  data: { id: issueId, identifier: "OT1-1", url: work.linear_url,
    updatedAt: "2026-10-05T08:00:00.000Z", team: { id: teamId },
    assignee: { id: linearUserId }, state: { name: "In Review", type: "started" } },
};
const request = async (value, signature = null) => {
  const raw = JSON.stringify(value);
  const headers = {
    "content-type": "application/json",
    "linear-delivery": "44444444-4444-4444-8444-444444444444",
    "linear-signature": signature ?? await sign(raw, secret),
  };
  const pending = [];
  const response = await handleLinearWebhook(new Request("https://worker.example/linear/webhook", { method: "POST", headers, body: raw }), env, (promise) => pending.push(promise));
  await Promise.all(pending);
  return response;
};
try {
  assert.equal((await request(payload, "0".repeat(64))).status, 401);
  assert.equal((await request({ ...payload, data: { ...payload.data, team: { id: "55555555-5555-4555-8555-555555555555" } } })).status, 200);
  assert.equal((await request(payload)).status, 200);
  const sync = calls.find((call) => call.pathname === "/sql" && call.body.params?.[0] === "work_sync");
  assert.match(sync.body.params[1], /"issueState":"검토·승인 중"/);
  assert.match(sync.body.params[1], /"driUserId":"UMAIN"/);
  const updates = calls.filter((call) => call.pathname.endsWith("/chat.update"));
  assert.equal(updates.length, 1);
  assert.equal(updates.some((call) => call.body.channel === "CFEEDBACK"), false);
  const maintainerUpdate = updates.find((call) => call.body.channel === "CMAIN");
  assert.match(maintainerUpdate.body.blocks[0].text.text, /DRI  <@UMAIN>/);
  assert.match(maintainerUpdate.body.blocks[0].text.text, /버그 키  BUG-QA/);
  assert.deepEqual(
    maintainerUpdate.body.blocks.at(-1).elements.map((element) => element.action_id),
    ["community_feedback_dri_select", "community_maintainer_linear_connect", "community_linear_open"],
  );
  assert.equal(
    maintainerUpdate.body.blocks.at(-1).elements[0].options[0].text.text,
    "Main",
  );
  const before = calls.length;
  assert.equal((await request(payload)).status, 200);
  assert.equal(calls.slice(before).some((call) => call.pathname.endsWith("/chat.update")), false);
  console.log("PASS signed Linear webhook: team boundary, deduplication, DRI mapping and Maintainer-only work surface");
} finally {
  globalThis.fetch = original;
}
