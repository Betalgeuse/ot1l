import assert from "node:assert/strict";
import { sendAgentNotifications } from "../src/community-agent-notifications.ts";

const calls = [];
let notificationKind = "merge_ready";
let changeClass = "open";
let includeTaskUrl = true;
let notificationChannel = "CFEEDBACK";
let missingSource = false;
const acceptedReplies = new Map();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ url: parsed.toString(), body });
  if (parsed.pathname === "/sql") {
    if (body.query.includes("maintainer_ops_execute")) return Response.json({rows:[["null"]]});
    if (body.query.includes("bug_runner_claim_notifications"))
      return Response.json({
        rows: [
          [
            JSON.stringify([
              {
                notification_id: 7,
                bug_id: "BUG-ABCDEF123456",
                channel_id: notificationChannel,
                thread_ts: "1790252981.933479",
                kind: notificationKind,
                payload: {
                  ...(includeTaskUrl
                    ? {
                        taskUrl:
                          "https://chatgpt.com/codex/tasks/task_e_0123456789abcdef0123456789abcdef",
                      }
                    : {}),
                  attempt: 1,
                  reporterId: "UREPORTER",
                  adminId: "UADMIN",
                  summary: "입력 경계를 수정하고 회귀 검사를 통과했습니다.",
                  ...(notificationKind === "merge_ready"
                    ? {
                        prNumber: 9,
                        prUrl: "https://github.com/Betalgeuse/ot1l/pull/9",
                        packetRevision: 3,
                        asIs: "기계적인 질문이 반복됩니다.",
                        toBe: "맥락 질문 뒤 관리자가 병합을 승인합니다.",
                        changeClass,
                        headSha: "a".repeat(40),
                        classificationDigest: "b".repeat(64),
                      }
                    : {}),
                },
              },
            ]),
          ],
        ],
      });
    if (body.query.includes("bug_runner_finish_notification"))
      return Response.json({ rows: [[JSON.stringify({ status: "sent" })]] });
  }
  if (parsed.pathname.endsWith("/conversations.history"))
    return Response.json({
      ok: true,
      messages: [{
        bot_id:"BQA",
        ts: "1790252999.000001",
        thread_ts: "1790252999.000001",
        text: "Maintainer 작업\n버그 키: BUG-ABCDEF123456",
      }],
    });
  if (parsed.pathname.endsWith("/conversations.replies")) {
    const channel = parsed.searchParams.get("channel");
    const ts = parsed.searchParams.get("ts");
    if (missingSource && channel === "CFEEDBACK") return Response.json({ ok: false, error: "thread_not_found" });
    return Response.json({ ok: true, messages: [{ ts, text: "버그 키: BUG-ABCDEF123456" }, ...(acceptedReplies.get(`${channel}:${ts}`) ?? [])] });
  }
  if (parsed.pathname.endsWith("/conversations.open"))
    return Response.json({ ok: true, channel: { id: "DFOUNDER" } });
  if (parsed.pathname.endsWith("/chat.postMessage")) {
    const key = `${body.channel}:${body.thread_ts}`;
    acceptedReplies.set(key, [...(acceptedReplies.get(key) ?? []), { ...body, ts: "1790253000.000001", bot_id: "BTEST" }]);
    return Response.json({ ok: true, ts: "1790253000.000001", message: { thread_ts: body.thread_ts } });
  }
  if (parsed.pathname.endsWith("/reactions.remove") || parsed.pathname.endsWith("/reactions.add"))
    return Response.json({ ok: true });
  throw new Error(`unexpected request ${parsed.pathname}`);
};
try {
  const env = {
    SLACK_TEAM_ID: "TQA",
    SLACK_BOT_TOKEN: "xoxb-test",
    COMMUNITY_CODEX_REPOSITORY: "Betalgeuse/ot1l",
    COMMUNITY_FEEDBACK_CHANNEL_ID: "CFEEDBACK",
    COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAINTAIN",
    COMMUNITY_ADMIN_ID: "UADMIN",
    DATABASE_URL:
      "postgresql://runtime:secret@ep-example-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
  };
  const ready = await sendAgentNotifications(env, new Date("2026-09-24T12:59:00Z"));
  assert.deepEqual(ready, { claimed: 1, sent: 1, failed: 0 });
  const readyPost = calls.find(
    (call) => call.url.includes("chat.postMessage") && call.body.channel === "CMAINTAIN",
  );
  assert.match(readyPost.body.blocks[0].text.text, /기계적인 질문이 반복됩니다/);
  assert.match(readyPost.body.blocks[0].text.text, /변경 내용 보기/);
  assert.match(readyPost.body.blocks[0].text.text, /Open/);
  assert.equal(readyPost.body.thread_ts, "1790252999.000001");
  assert.equal(readyPost.body.blocks[1].elements[0].text.text, "Product Owner 병합·배포 승인");
  assert.equal(readyPost.body.blocks[1].elements[0].action_id, "community_feedback_merge_approve");
  assert.equal(JSON.parse(readyPost.body.blocks[1].elements[0].value).headSha, "a".repeat(40));
  assert.equal(
    calls.some(
      (call) => call.url.includes("chat.postMessage") && call.body.channel === "CFEEDBACK",
    ),
    false,
  );
  assert.equal(
    calls.some((call) => call.url.includes("reactions.")),
    false,
  );

  calls.length = 0;
  acceptedReplies.clear();
  changeClass = "core";
  const coreReady = await sendAgentNotifications(env, new Date("2026-09-24T12:59:30Z"));
  assert.deepEqual(coreReady, { claimed: 1, sent: 1, failed: 0 });
  const maintainerCorePost = calls.find(
    (call) =>
      call.url.includes("chat.postMessage") &&
      call.body.channel === "CMAINTAIN" &&
      call.body.thread_ts === "1790252999.000001",
  );
  assert.equal(
    maintainerCorePost.body.blocks.some((block) => block.type === "actions"),
    true,
  );
  assert.match(maintainerCorePost.body.text, /Founder 본인만 승인/);
  assert.equal(maintainerCorePost.body.blocks[1].elements[0].text.text, "Founder 병합·배포 승인");
  const founderPost = calls.find(
    (call) => call.url.includes("chat.postMessage") && call.body.channel === "DFOUNDER",
  );
  assert.equal(founderPost,undefined,"approval stays in the canonical PO thread, without a parallel DM");

  calls.length = 0;
  acceptedReplies.clear();
  changeClass = "open";
  notificationKind = "change_merged";
  includeTaskUrl = false;
  const result = await sendAgentNotifications(env, new Date("2026-09-24T13:00:00Z"));
  assert.deepEqual(result, { claimed: 1, sent: 1, failed: 0 });
  assert.equal(calls.some((call) => call.url.includes("chat.postMessage")), false);
  const reactionMethods = calls
    .filter((call) => call.url.includes("reactions."))
    .map((call) => new URL(call.url).pathname.split("/").at(-1));
  assert.deepEqual(reactionMethods, []);
  assert.equal(calls.some((call) => call.url.includes("chat.postMessage")), false);
  const finish = calls.find((call) => call.body.query?.includes("bug_runner_finish_notification"));
  assert.match(finish.body.params[0], /"status":"sent"/);
  calls.length = 0;
  acceptedReplies.clear();
  notificationKind = "change_deployed";
  const deployed = await sendAgentNotifications(env, new Date("2026-09-24T13:01:00Z"));
  assert.deepEqual(deployed, { claimed: 1, sent: 1, failed: 0 });
  const deployedPost = calls.find((call) => call.url.includes("chat.postMessage"));
  assert.equal(
    calls.filter(
      (call) => call.url.includes("chat.postMessage") && call.body.channel === "CFEEDBACK",
    ).length,
    1,
  );
  assert.equal(deployedPost.body.text, "요청한 개선이 운영에 반영됐어요. ✅");
  const deployedReactionMethods = calls
    .filter((call) => call.url.includes("reactions."))
    .map((call) => new URL(call.url).pathname.split("/").at(-1));
  assert.deepEqual(deployedReactionMethods, ["reactions.remove", "reactions.add"]);
  calls.length = 0;
  assert.deepEqual(await sendAgentNotifications(env), { claimed: 1, sent: 1, failed: 0 });
  assert.equal(calls.some(call => call.url.includes("chat.postMessage")), false, "retry reconciles both public and PO receipts");
  calls.length = 0;
  acceptedReplies.clear();
  missingSource = true;
  assert.deepEqual(await sendAgentNotifications(env), { claimed: 1, sent: 1, failed: 0 });
  assert.equal(calls.some(call => call.url.includes("chat.postMessage") && call.body.channel === "CFEEDBACK"), false);
  assert.equal(calls.some(call => call.url.includes("reactions.")), false);
  assert.equal(calls.filter(call => call.url.includes("chat.postMessage") && call.body.channel === "CMAINTAIN").length, 1);
  missingSource = false;
  calls.length = 0;
  acceptedReplies.clear();
  notificationChannel = "CMAINTAIN";
  const directMaintainerDeployment = await sendAgentNotifications(
    env,
    new Date("2026-09-24T13:01:30Z"),
  );
  assert.deepEqual(directMaintainerDeployment, { claimed: 1, sent: 1, failed: 0 });
  assert.equal(calls.some((call) => call.url.includes("conversations.history")), true);
  const directMaintainerPost = calls.find((call) => call.url.includes("chat.postMessage"));
  assert.equal(directMaintainerPost.body.channel, "CMAINTAIN");
  assert.equal(directMaintainerPost.body.thread_ts, "1790252999.000001","same-channel daily prompt must not receive a work notification");
  assert(calls.filter(call=>call.url.includes("reactions.")).every(call=>call.body.timestamp==="1790252999.000001"));
  assert.match(directMaintainerPost.body.text, /운영 배포와 실제 동작 확인을 완료했어요/);
  calls.length = 0;
  acceptedReplies.clear();
  notificationChannel = "CFEEDBACK";
  notificationKind = "deployment_manual";
  const manual = await sendAgentNotifications(env, new Date("2026-09-24T13:02:00Z"));
  assert.deepEqual(manual, { claimed: 1, sent: 1, failed: 0 });
  assert.equal(
    calls.some(
      (call) => call.url.includes("chat.postMessage") && call.body.channel === "CFEEDBACK",
    ),
    false,
  );
  const manualPost = calls.find((call) => call.url.includes("chat.postMessage"));
  assert.equal(manualPost.body.channel, "CMAINTAIN");
  assert.match(manualPost.body.text, /안전한 순서로 운영 반영하고 있어요/);
  const manualReactionMethods = calls
    .filter((call) => call.url.includes("reactions."))
    .map((call) => new URL(call.url).pathname.split("/").at(-1));
  assert.deepEqual(manualReactionMethods, []);
  for (const quietKind of ["task_started", "task_ready"]) {
    calls.length = 0;
    notificationKind = quietKind;
    includeTaskUrl = true;
    const quiet = await sendAgentNotifications(env, new Date("2026-09-24T13:02:30Z"));
    assert.deepEqual(quiet, { claimed: 1, sent: 1, failed: 0 });
    assert.equal(calls.some((call) => call.url.includes("chat.postMessage")), false);
  }
  calls.length = 0;
  notificationKind = "invalid_kind";
  const malformed = await sendAgentNotifications(env, new Date("2026-09-24T13:03:00Z"));
  assert.deepEqual(malformed, { claimed: 1, sent: 0, failed: 1 });
  const malformedFinish = calls.find((call) =>
    call.body.query?.includes("bug_runner_finish_notification"),
  );
  assert.match(malformedFinish.body.params[0], /"status":"failed"/);
  console.log(
    "PASS agent notifications: approval card carries progress and only terminal deployment posts",
  );
} finally {
  globalThis.fetch = originalFetch;
}
