import assert from "node:assert/strict";
import {
  assignMaintainerWork,
  setMaintainerWorkStage,
  syncFeedbackToMaintainerWork,
} from "../src/community-maintainer-work.ts";

const calls = [];
const surfaces = new Map();
let work = null;
let nextTs = 20;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ pathname: parsed.pathname, body });
  if (parsed.pathname === "/sql") {
    const op = body.params[0];
    const payload = JSON.parse(body.params[1]);
    let value;
    if (op === "work_put") {
      work = {
        work_key: payload.workKey,
        reporter_id: payload.reporterId,
        desired_dri: payload.desiredDri,
        dri_user_id: payload.desiredDri,
        title: payload.title,
        actual: payload.actual,
        expected: payload.expected,
        source_channel: payload.sourceChannel,
        source_thread: payload.sourceThread,
        stage: "inbox",
        linear_issue_id: null,
        linear_url: null,
        linear_identifier: null,
      };
      value = work;
    } else if (op === "work_get") value = work;
    else if (op === "members") value = [
      { userId: "UMAIN", displayName: "Main", linearUserId: null, linearState: "not_connected" },
      { userId: "UOTHER", displayName: "Other", linearUserId: null, linearState: "not_connected" },
    ];
    else if (op === "surface_get") value = surfaces.get(`${payload.workKey}:${payload.channelId}`) ?? null;
    else if (op === "surface_put") {
      surfaces.set(`${payload.workKey}:${payload.channelId}`, payload.messageTs);
      value = payload.messageTs;
    } else if (op === "work_assignment") {
      work = { ...work, desired_dri: payload.driUserId, dri_user_id: payload.driUserId };
      value = work;
    } else if (op === "work_stage") {
      work = { ...work, stage: payload.stage };
      value = work;
    } else throw new Error(`unexpected op ${op}`);
    return Response.json({ rows: [[JSON.stringify(value)]] });
  }
  const method = parsed.pathname.split("/").at(-1);
  if (method === "chat.postMessage")
    return Response.json({ ok: true, ts: `${nextTs++}.000001` });
  if (method === "chat.update") return Response.json({ ok: true, ts: body.ts });
  if (method === "chat.postEphemeral") return Response.json({ ok: true, message_ts: "99.000001" });
  throw new Error(`unexpected external request ${url}`);
};

const env = {
  DATABASE_URL: "postgresql://runtime:secret@test.neon.tech/db?sslmode=require",
  SLACK_TEAM_ID: "TQA",
  SLACK_BOT_TOKEN: "fake",
  COMMUNITY_ADMIN_ID: "UADMIN",
  COMMUNITY_FEEDBACK_CHANNEL_ID: "CFEEDBACK",
  COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAIN",
  MAINTAINER_LINEAR_ENABLED: "false",
};
const store = {
  async maintainerStatus(_teamId, userId) {
    return ["UMAIN", "UOTHER"].includes(userId) ? { state: "active" } : null;
  },
};
const context = {
  env,
  store,
  scope: { teamId: "TQA", channelId: "CMAIN", userId: "UMAIN" },
  date: "2026-10-06",
  thread: "1.000001",
  source: "1.000001",
  key: "native-test",
};

try {
  await syncFeedbackToMaintainerWork(context, {
    feedbackId: "BUG-NATIVE",
    reporterId: "UMAIN",
    actual: "현재 상태",
    expected: "원하는 상태",
    sourceChannel: "CFEEDBACK",
    sourceThread: "1.000001",
  });
  assert.equal(work.dri_user_id, "UMAIN", "Maintainer author must immediately become DRI");
  assert.equal(work.linear_issue_id, null);
  assert.equal(calls.some((call) => call.pathname === "/graphql"), false);
  const maintainerCard = calls.find(
    (call) => call.pathname.endsWith("/chat.postMessage") && call.body.channel === "CMAIN",
  );
  assert.deepEqual(
    maintainerCard.body.blocks.at(-1).elements.map((element) => element.action_id),
    ["community_feedback_dri_select", "community_feedback_stage_select"],
  );

  await assignMaintainerWork(context, "BUG-NATIVE", "UOTHER");
  assert.equal(work.dri_user_id, "UOTHER");
  assert.match(
    calls.filter((call) => call.pathname.endsWith("/chat.postEphemeral")).at(-1).body.text,
    /DRI로 지정했어요/,
  );
  assert.equal(calls.some((call) => call.pathname === "/graphql"), false);

  await setMaintainerWorkStage(context, "BUG-NATIVE", "in_progress");
  assert.equal(work.stage, "in_progress");
  const updatedCards = calls.filter((call) => call.pathname.endsWith("/chat.update"));
  assert.equal(updatedCards.some((call) => /진행 중/.test(call.body.text)), true);

  const crossChannelCallStart = calls.length;
  await syncFeedbackToMaintainerWork(context, {
    feedbackId: "BUG-MAINTAINER-SOURCE",
    reporterId: "UMAIN",
    actual: "Maintainer 채널 현재 상태",
    expected: "교차 채널 갱신 안전",
    sourceChannel: "CMAIN",
    sourceThread: "2.000001",
  });
  const crossChannelCalls = calls.slice(crossChannelCallStart);
  assert.equal(
    crossChannelCalls.some(
      (call) =>
        call.pathname.endsWith("/chat.update") &&
        call.body.channel === "CFEEDBACK" &&
        call.body.ts === "2.000001",
    ),
    false,
    "a Maintainer-channel timestamp must never be reused in the feedback channel",
  );
  console.log("PASS Slack-native Maintainer work creates DRI, reassigns and changes stage without Linear");
} finally {
  globalThis.fetch = originalFetch;
}
