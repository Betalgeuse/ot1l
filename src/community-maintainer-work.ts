import { MaintainerOpsStore } from "./community-maintainer-store";
import { escapeSlackText } from "./community-messages";
import { type CommunityContext, type CommunityEnv, ephemeral } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, type Json, list, object, string } from "./input";

type WorkEnv = Pick<
  CommunityEnv,
  | "SLACK_TEAM_ID"
  | "SLACK_BOT_TOKEN"
  | "DATABASE_URL"
  | "COMMUNITY_ADMIN_ID"
  | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
>;
const value = (row: Record<string, unknown>, key: string): string =>
  typeof row[key] === "string" ? String(row[key]) : "";

export function nativeWorkCard(
  _env: WorkEnv,
  work: Record<string, unknown>,
  members: readonly Record<string, unknown>[],
) {
  const key = string(work.work_key),
    title = string(work.title);
  const dri = value(work, "dri_user_id") || value(work, "desired_dri");
  const stage = value(work, "release_stage") || value(work, "issue_state") || "의견 모으는 중";
  const options = members.slice(0, 100).map((member) => ({
    text: { type: "plain_text", text: String(member.displayName || member.userId).slice(0, 75) },
    value: JSON.stringify({ ownerId: "actor", key, driUserId: string(member.userId) }),
  }));
  const selected = options.find((option) => JSON.parse(option.value).driUserId === dri);
  const elements: Json[] = [];
  if (options.length)
    elements.push({
      type: "static_select",
      action_id: "community_feedback_dri_select",
      placeholder: { type: "plain_text", text: "담당 PO 선택" },
      options,
      ...(selected ? { initial_option: selected } : {}),
    });
  elements.push({
    type: "button",
    text: { type: "plain_text", text: "PR 연결하기" },
    action_id: "community_pull_request_open",
    value: JSON.stringify({ ownerId: "actor", key }),
  });
  if (value(work, "pr_url"))
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "변경 내용 보기" },
      action_id: "community_linear_open",
      value: JSON.stringify({ ownerId: "actor", key }),
      url: value(work, "pr_url"),
    });
  return {
    text: `${title} · ${stage} · 담당 ${dri ? `<@${dri}>` : "모집 중"} · 버그 키: ${key}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*" +
            escapeSlackText(title) +
            "*\n\n*의견·요청*\n" +
            escapeSlackText(string(work.actual)) +
            (value(work, "expected")
              ? `\n\n*원하는 변화*\n${escapeSlackText(value(work, "expected"))}`
              : "") +
            "\n\n진행  *" +
            escapeSlackText(stage) +
            "*\n담당 PO  " +
            (dri ? `<@${dri}>` : "아직 정해지지 않음") +
            "\n제안  <@" +
            string(work.reporter_id) +
            ">\n버그 키: " +
            key,
        },
      },
      { type: "actions", elements },
    ] as Json[],
  };
}

export async function refreshMaintainerWorkSurfaces(env: WorkEnv, workKey: string): Promise<void> {
  const channel = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
  if (!channel) return;
  const store = new MaintainerOpsStore(env);
  const work = await store.getWork(workKey);
  if (!work) return;
  const members = list(await store.execute("members", {})).map(object);
  const stored = await store.execute("surface_get", { workKey, channelId: channel });
  let ts =
    typeof stored === "string"
      ? stored
      : work.source_channel === channel && work.source_is_work_root === true
        ? value(work, "source_thread")
        : "";
  if (!ts) {
    const history = await callSlack(env.SLACK_BOT_TOKEN, "conversations.history", {
      channel,
      limit: 200,
    });
    const previous = list(history.messages)
      .map(object)
      .find(
        (m) =>
          (m.bot_id || m.app_id) &&
          (!m.thread_ts || m.thread_ts === m.ts) &&
          typeof m.text === "string" &&
          m.text.includes(`버그 키: ${workKey}`),
      );
    if (previous) ts = string(previous.ts);
  }
  const payload = { channel, ...nativeWorkCard(env, work, members) };
  const result = ts
    ? await callSlack(env.SLACK_BOT_TOKEN, "chat.update", { ...payload, ts })
    : await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", payload);
  await store.execute("surface_put", { workKey, channelId: channel, messageTs: string(result.ts) });
}

export async function syncFeedbackWork(
  context: CommunityContext,
  input: {
    readonly feedbackId: string;
    readonly reporterId: string;
    readonly actual: string;
    readonly expected: string;
    readonly sourceChannel: string;
    readonly sourceThread: string;
  },
): Promise<void> {
  if (!context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID)
    throw new InputError("PO 작업 채널을 확인해 주세요.");
  const role = await context.store.maintainerStatus(context.scope.teamId, input.reporterId);
  const desiredDri =
    role?.state === "active" || input.reporterId === context.env.COMMUNITY_ADMIN_ID
      ? input.reporterId
      : null;
  await new MaintainerOpsStore(context.env).execute("work_put", {
    workKey: input.feedbackId,
    reporterId: input.reporterId,
    desiredDri,
    title: ((input.expected || input.actual).split(/\r?\n/, 1)[0] ?? "의견").slice(0, 120),
    actual: input.actual.slice(0, 2000),
    expected: input.expected.slice(0, 2000),
    workKind: "feedback",
    sourceChannel: input.sourceChannel,
    sourceThread: input.sourceThread,
    sourceIsWorkRoot: context.sourceIsWorkRoot === true,
  });
  await refreshMaintainerWorkSurfaces(context.env, input.feedbackId);
}

export async function assignMaintainerWork(
  context: CommunityContext,
  workKey: string,
  targetUserId: string,
): Promise<void> {
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
      "active" &&
    context.scope.userId !== context.env.COMMUNITY_ADMIN_ID
  )
    throw new InputError("활성 PO만 담당자를 변경할 수 있어요.");
  const store = new MaintainerOpsStore(context.env);
  const members = list(await store.execute("members", {}, context.scope.userId)).map(object);
  if (!members.some((m) => m.userId === targetUserId))
    throw new InputError("활성 PO를 골라 주세요.");
  const assigned = object(
    await store.execute(
      "work_assignment",
      { workKey, driUserId: targetUserId },
      context.scope.userId,
    ),
  );
  if (assigned.dri_user_id !== targetUserId)
    throw new InputError("담당자 변경을 확인하지 못했어요.");
  await refreshMaintainerWorkSurfaces(context.env, workKey);
  await ephemeral(context, { text: `<@${targetUserId}>님에게 담당을 넘겼어요.` });
}

export async function setMaintainerWorkReleaseStage(
  env: WorkEnv,
  workKey: string,
  releaseStage: string,
): Promise<void> {
  if (!env.COMMUNITY_MAINTAINERS_CHANNEL_ID) return;
  await new MaintainerOpsStore(env).execute("work_release", { workKey, releaseStage });
  await refreshMaintainerWorkSurfaces(env, workKey);
}

// Old Slack buttons may still be clicked. They explain the new entry point;
// they cannot invite users, reassign work, or resume an external control plane.
export async function connectMaintainerToLinear(context: CommunityContext): Promise<void> {
  await ephemeral(context, {
    text: "작업과 담당자는 이제 Slack에서 관리해요. PO 작업 카드의 담당자 선택이나 PR 연결하기를 이용해 주세요.",
  });
}
export const showMaintainerLinearMembers = connectMaintainerToLinear;
export async function pauseMaintainerLinear(_context: CommunityContext): Promise<void> {}
