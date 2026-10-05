import assert from "node:assert/strict";
import { sendAgentNotifications } from "../src/community-agent-notifications.ts";

const calls = [];
let notificationKind = "merge_ready";
let changeClass = "open";
let includeTaskUrl = true;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ url: parsed.toString(), body });
  if (parsed.pathname === "/sql") {
    if (body.query.includes("bug_runner_claim_notifications"))
      return Response.json({
        rows: [
          [
            JSON.stringify([
              {
                notification_id: 7,
                bug_id: "BUG-ABCDEF123456",
                channel_id: "CFEEDBACK",
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
      messages: [{ ts: "1790252999.000001", text: "Maintainer 작업\n버그 키: BUG-ABCDEF123456" }],
    });
  if (parsed.pathname.endsWith("/conversations.open"))
    return Response.json({ ok: true, channel: { id: "DFOUNDER" } });
  if (parsed.pathname.endsWith("/chat.postMessage"))
    return Response.json({ ok: true, ts: "1790253000.000001" });
  if (parsed.pathname.endsWith("/reactions.remove") || parsed.pathname.endsWith("/reactions.add"))
    return Response.json({ ok: true });
  throw new Error(`unexpected request ${parsed.pathname}`);
};
try {
  const env = {
    SLACK_TEAM_ID: "TQA",
    SLACK_BOT_TOKEN: "xoxb-test",
    COMMUNITY_CODEX_REPOSITORY: "Betalgeuse/ot1l",
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
  assert.equal(readyPost.body.blocks[1].elements[0].text.text, "Maintainer 병합·배포 승인");
  assert.equal(readyPost.body.blocks[1].elements[0].action_id, "community_feedback_merge_approve");
  assert.equal(JSON.parse(readyPost.body.blocks[1].elements[0].value).headSha, "a".repeat(40));
  assert.equal(
    calls.some((call) => call.url.includes("reactions.")),
    false,
  );

  calls.length = 0;
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
  assert.match(founderPost.body.text, /Maintainer 작업 스레드에서 Founder 병합·배포 승인하기/);
  assert.equal(founderPost.body.blocks, undefined);

  calls.length = 0;
  changeClass = "open";
  notificationKind = "change_merged";
  includeTaskUrl = false;
  const result = await sendAgentNotifications(env, new Date("2026-09-24T13:00:00Z"));
  assert.deepEqual(result, { claimed: 1, sent: 1, failed: 0 });
  const post = calls.find((call) => call.url.includes("chat.postMessage"));
  assert.equal(post.body.thread_ts, "1790252981.933479");
  assert.match(post.body.text, /<@UADMIN> <@UREPORTER>/);
  assert.match(post.body.text, /운영 배포와 실제 동작 확인을 기다리고 있습니다/);
  assert.doesNotMatch(post.body.text, /github[.]com/);
  assert.doesNotMatch(post.body.text, /chatgpt[.]com/);
  const reactionMethods = calls
    .filter((call) => call.url.includes("reactions."))
    .map((call) => new URL(call.url).pathname.split("/").at(-1));
  assert.deepEqual(reactionMethods, []);
  const finish = calls.find((call) => call.body.query?.includes("bug_runner_finish_notification"));
  assert.match(finish.body.params[0], /"status":"sent"/);
  calls.length = 0;
  notificationKind = "change_deployed";
  const deployed = await sendAgentNotifications(env, new Date("2026-09-24T13:01:00Z"));
  assert.deepEqual(deployed, { claimed: 1, sent: 1, failed: 0 });
  const deployedPost = calls.find((call) => call.url.includes("chat.postMessage"));
  assert.match(deployedPost.body.text, /운영 배포와 실제 동작 확인을 완료했어요/);
  const deployedReactionMethods = calls
    .filter((call) => call.url.includes("reactions."))
    .map((call) => new URL(call.url).pathname.split("/").at(-1));
  assert.deepEqual(deployedReactionMethods, ["reactions.remove", "reactions.add"]);
  calls.length = 0;
  notificationKind = "deployment_manual";
  const manual = await sendAgentNotifications(env, new Date("2026-09-24T13:02:00Z"));
  assert.deepEqual(manual, { claimed: 1, sent: 1, failed: 0 });
  const manualPost = calls.find((call) => call.url.includes("chat.postMessage"));
  assert.match(manualPost.body.text, /운영자 배포가 필요해요/);
  const manualReactionMethods = calls
    .filter((call) => call.url.includes("reactions."))
    .map((call) => new URL(call.url).pathname.split("/").at(-1));
  assert.deepEqual(manualReactionMethods, ["reactions.remove", "reactions.add"]);
  calls.length = 0;
  notificationKind = "invalid_kind";
  const malformed = await sendAgentNotifications(env, new Date("2026-09-24T13:03:00Z"));
  assert.deepEqual(malformed, { claimed: 1, sent: 0, failed: 1 });
  const malformedFinish = calls.find((call) =>
    call.body.query?.includes("bug_runner_finish_notification"),
  );
  assert.match(malformedFinish.body.params[0], /"status":"failed"/);
  console.log(
    "PASS agent notifications: review, merge, deployment, and final check remain distinct",
  );
} finally {
  globalThis.fetch = originalFetch;
}
