import {
  assignLinearIssue,
  cancelLinearGuestInvite,
  configuredLinearTeam,
  createLinearIssue,
  inviteLinearGuest,
  linearTeamMembers,
  suspendLinearGuest,
  unsuspendLinearGuest,
} from "./community-linear-client";
import { MaintainerOpsStore } from "./community-maintainer-store";
import { maintainerButton } from "./community-maintainers";
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
  | "COMMUNITY_FEEDBACK_CHANNEL_ID"
  | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
  | "MAINTAINER_LINEAR_ENABLED"
  | "MAINTAINER_LINEAR_EXPORT_ENABLED"
  | "LINEAR_API_KEY"
  | "LINEAR_ADMIN_API_KEY"
  | "LINEAR_TEAM_ID"
  | "LINEAR_ORGANIZATION_ID"
  | "LINEAR_GUEST_SEAT_LIMIT"
>;

const text = (value: Record<string, unknown>, snake: string, camel = snake): string =>
  string(value[snake] ?? value[camel]);
const nullable = (value: Record<string, unknown>, snake: string, camel = snake): string | null => {
  const field = value[snake] ?? value[camel];
  return field === null || field === undefined ? null : string(field);
};

function linearConfigured(env: WorkEnv): boolean {
  return env.MAINTAINER_LINEAR_ENABLED === "true";
}

function linearExportEnabled(env: WorkEnv): boolean {
  return linearConfigured(env) && env.MAINTAINER_LINEAR_EXPORT_ENABLED === "true";
}

const WORK_STAGE_LABELS = {
  inbox: "제안됨",
  in_progress: "진행 중",
  review: "검토 중",
  blocked: "도움 필요",
  deploying: "반영 중",
  done: "완료",
} as const;

type WorkStage = keyof typeof WORK_STAGE_LABELS;

function workStage(value: unknown): WorkStage {
  return typeof value === "string" && Object.hasOwn(WORK_STAGE_LABELS, value)
    ? (value as WorkStage)
    : "inbox";
}

function issueStage(type: unknown, name: unknown): string {
  if (type === "completed") return "운영 확인 대기";
  if (type === "canceled" || type === "duplicate") return "종료";
  if (name === "In Review") return "검토·승인 중";
  if (name === "In Progress") return "작업 중";
  if (type === "started") return "작업 중";
  if (type === "unstarted") return "담당자 지정됨";
  return "접수됨";
}

function slackUrl(env: WorkEnv, channel: string, thread: string): string {
  return `https://app.slack.com/client/${env.SLACK_TEAM_ID}/${channel}/thread/${channel}-${thread}`;
}

async function activeMaintainers(env: WorkEnv): Promise<readonly Record<string, unknown>[]> {
  return list(await new MaintainerOpsStore(env).execute("members", {})).map(object);
}

function workCard(
  env: WorkEnv,
  work: Record<string, unknown>,
  maintainers: readonly Record<string, unknown>[],
  surface: "member" | "maintainer",
): { readonly text: string; readonly blocks: readonly Json[] } {
  const key = text(work, "work_key", "workKey");
  const title = text(work, "title");
  const reporterId = text(work, "reporter_id", "reporterId");
  const driId =
    nullable(work, "dri_user_id", "driUserId") ?? nullable(work, "desired_dri", "desiredDri");
  const stage = workStage(work.stage);
  const stageLabel = WORK_STAGE_LABELS[stage];
  const identifier = nullable(work, "linear_identifier", "linearIdentifier");
  const url = nullable(work, "linear_url", "linearUrl");
  const actual = text(work, "actual");
  const expected = text(work, "expected");
  const dri = driId ? `<@${driId}>` : "아직 정해지지 않음";
  const summary = `*${escapeSlackText(title)}*\n\n*As-Is*\n${escapeSlackText(actual)}\n\n*To-Be*\n${escapeSlackText(expected)}\n\n현재 단계  *${escapeSlackText(stageLabel)}*\nDRI  ${dri}\n제안  <@${reporterId}>${identifier ? `\n외부 미러  ${identifier}` : ""}\n버그 키  ${escapeSlackText(key)}`;
  const blocks: Json[] = [{ type: "section", text: { type: "mrkdwn", text: summary } }];
  if (surface === "maintainer") {
    const options = maintainers.slice(0, 100).map((member) => {
      const userId = string(member.userId);
      return {
        text: {
          type: "plain_text",
          text: string(member.displayName).slice(0, 75),
        },
        value: JSON.stringify({ ownerId: "actor", key, driUserId: userId }),
      };
    });
    const elements: Json[] = [];
    if (options.length)
      elements.push({
        type: "static_select",
        action_id: "community_feedback_dri_select",
        placeholder: { type: "plain_text", text: "DRI 변경" },
        options,
      });
    elements.push({
      type: "static_select",
      action_id: "community_feedback_stage_select",
      placeholder: { type: "plain_text", text: "상태 변경" },
      options: (["inbox", "in_progress", "review", "blocked"] as const).map((value) => ({
        text: { type: "plain_text", text: WORK_STAGE_LABELS[value] },
        value: JSON.stringify({ ownerId: "actor", key, stage: value }),
      })),
    });
    if (linearExportEnabled(env) && !url)
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Linear로 내보내기" },
        action_id: "community_work_linear_export",
        value: JSON.stringify({ ownerId: "actor", key }),
      });
    if (url)
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Linear 미러 보기" },
        action_id: "community_linear_open",
        value: JSON.stringify({ ownerId: "actor", key }),
        url,
      });
    blocks.push({ type: "actions", elements });
  } else {
    blocks.push({
      type: "actions",
      elements: [maintainerButton("Product Owner가 되어 직접 고치기")],
    });
  }
  return { text: `${title} · ${stageLabel} · DRI ${dri} · 버그 키 ${key}`, blocks };
}

async function upsertSurface(
  env: WorkEnv,
  work: Record<string, unknown>,
  channelId: string,
  preferredTs: string | null,
  surface: "member" | "maintainer",
  maintainers: readonly Record<string, unknown>[],
): Promise<string> {
  const store = new MaintainerOpsStore(env);
  const workKey = text(work, "work_key", "workKey");
  const stored = await store.execute("surface_get", { workKey, channelId });
  const messageTs = typeof stored === "string" ? stored : preferredTs;
  const payload = { channel: channelId, ...workCard(env, work, maintainers, surface) };
  if (messageTs) {
    await callSlack(env.SLACK_BOT_TOKEN, "chat.update", { ...payload, ts: messageTs });
    await store.execute("surface_put", { workKey, channelId, messageTs });
    return messageTs;
  }
  const created = string((await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", payload)).ts);
  await store.execute("surface_put", { workKey, channelId, messageTs: created });
  return created;
}

export async function refreshMaintainerWorkSurfaces(
  env: WorkEnv,
  workKey: string,
  preferredSurface: { readonly channelId: string; readonly messageTs: string } | null = null,
): Promise<void> {
  const store = new MaintainerOpsStore(env);
  const work = await store.getWork(workKey);
  if (!work) return;
  const maintainers = await activeMaintainers(env);
  const feedback = env.COMMUNITY_FEEDBACK_CHANNEL_ID;
  const maintainer = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
  if (feedback)
    await upsertSurface(
      env,
      work,
      feedback,
      preferredSurface?.channelId === feedback ? preferredSurface.messageTs : null,
      "member",
      maintainers,
    );
  if (maintainer)
    await upsertSurface(
      env,
      work,
      maintainer,
      preferredSurface?.channelId === maintainer ? preferredSurface.messageTs : null,
      "maintainer",
      maintainers,
    );
}

export async function syncFeedbackToMaintainerWork(
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
  const env = context.env;
  const maintainer = await context.store.maintainerStatus(context.scope.teamId, input.reporterId);
  const desiredDri = maintainer?.state === "active" ? input.reporterId : null;
  const title =
    (input.expected || input.actual).split(/\r?\n/, 1)[0]?.trim().slice(0, 120) || "OT1L 피드백";
  const store = new MaintainerOpsStore(env);
  await store.execute("work_put", {
    workKey: input.feedbackId,
    reporterId: input.reporterId,
    desiredDri,
    title,
    actual: input.actual.slice(0, 2000),
    expected: input.expected.slice(0, 2000),
    workKind: "feedback",
    sourceChannel: input.sourceChannel,
    sourceThread: input.sourceThread,
  });
  await refreshMaintainerWorkSurfaces(env, input.feedbackId, {
    channelId: input.sourceChannel,
    messageTs: input.sourceThread,
  });
}

export async function exportMaintainerWorkToLinear(
  context: CommunityContext,
  workKey: string,
): Promise<void> {
  const env = context.env;
  if (!linearExportEnabled(env)) throw new InputError("Linear 미러는 현재 사용하지 않아요.");
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
      "active" &&
    context.scope.userId !== env.COMMUNITY_ADMIN_ID
  )
    throw new InputError("활성 Product Owner만 외부 도구로 내보낼 수 있어요.");
  const store = new MaintainerOpsStore(env);
  const linearTeamId = configuredLinearTeam(env);
  const prepared = object(await store.execute("work_linear_prepare", { workKey, linearTeamId }));
  const driId = nullable(prepared, "dri_user_id", "driUserId");
  const member = driId ? await store.execute("member_get", { userId: driId }) : null;
  const linearAssignee =
    member && typeof member === "object" && !Array.isArray(member)
      ? nullable(object(member), "linear_user_id", "linearUserId")
      : null;
  try {
    const issue = await createLinearIssue(env, {
      id: text(prepared, "linear_issue_id", "linearIssueId"),
      title: text(prepared, "title"),
      description: `## As-Is\n${text(prepared, "actual")}\n\n## To-Be\n${text(prepared, "expected")}\n\n[Slack에서 처음 남긴 위치](${slackUrl(env, text(prepared, "source_channel", "sourceChannel"), text(prepared, "source_thread", "sourceThread"))})\n\n${workKey}`,
      assigneeId: linearAssignee,
    });
    await store.execute("work_sync", {
      workKey,
      linearTeamId,
      identifier: string(issue.identifier),
      url: string(issue.url),
      issueState: issueStage(object(issue.state).type, object(issue.state).name),
      linearUpdatedAt: string(issue.updatedAt),
    });
    await refreshMaintainerWorkSurfaces(env, workKey);
    await ephemeral(context, { text: "이 작업을 Linear에 선택적으로 연결했어요." });
  } catch (error) {
    await store.execute("work_failed", { workKey });
    await refreshMaintainerWorkSurfaces(env, workKey);
    throw error;
  }
}

export async function connectMaintainerToLinear(context: CommunityContext): Promise<void> {
  const env = context.env;
  if (!linearConfigured(env)) throw new InputError("Linear 미러는 현재 사용하지 않아요.");
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
    "active"
  )
    throw new InputError("Product Owner를 먼저 활성화해 주세요.");
  const profile = object(
    (await callSlack(env.SLACK_BOT_TOKEN, "users.info", { user: context.scope.userId })).user,
  );
  const email = string(object(profile.profile).email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new InputError("Slack 이메일을 확인할 수 없어요.");
  const store = new MaintainerOpsStore(env);
  const teamMembers = await linearTeamMembers(env);
  const matched = teamMembers.find(
    (member) => typeof member.email === "string" && member.email.toLowerCase() === email,
  );
  if (matched) {
    if (matched.active !== true) await unsuspendLinearGuest(env, string(matched.id));
    await store.execute(
      "member_link",
      {
        userId: context.scope.userId,
        linearTeamId: configuredLinearTeam(env),
        linearUserId: string(matched.id),
      },
      context.scope.userId,
    );
    await ephemeral(context, {
      text: "Linear ot1l 팀 연결을 확인했어요. 이제 DRI를 맡거나 넘겨받을 수 있어요.",
    });
    return;
  }
  const seatLimit = Number(env.LINEAR_GUEST_SEAT_LIMIT ?? "0");
  if (!Number.isSafeInteger(seatLimit) || seatLimit < 1 || seatLimit > 100)
    throw new InputError("Linear 초대 한도를 확인해 주세요.");
  const reservation = object(
    await store.execute(
      "member_reserve",
      {
        userId: context.scope.userId,
        linearTeamId: configuredLinearTeam(env),
        linearUserId: null,
        seatLimit,
      },
      context.scope.userId,
    ),
  );
  await inviteLinearGuest(env, text(reservation, "invite_id", "inviteId"), email);
  await store.execute(
    "member_invited",
    {
      userId: context.scope.userId,
      linearTeamId: configuredLinearTeam(env),
    },
    context.scope.userId,
  );
  await ephemeral(context, {
    text: "Linear ot1l 전용 Guest 초대를 보냈어요. 이메일에서 수락하면 DRI 연결을 자동으로 확인할게요.",
  });
}

export async function pauseMaintainerLinear(context: CommunityContext): Promise<void> {
  const env = context.env;
  if (!linearConfigured(env)) return;
  const store = new MaintainerOpsStore(env);
  const value = await store.execute("member_get", { userId: context.scope.userId });
  if (value === null) return;
  const member = object(value);
  if (text(member, "seat_source", "seatSource") === "invited") {
    const linearUserId = nullable(member, "linear_user_id", "linearUserId");
    if (linearUserId) await suspendLinearGuest(env, linearUserId);
    else await cancelLinearGuestInvite(env, text(member, "invite_id", "inviteId"));
  }
  await store.execute(
    "member_pause",
    { userId: context.scope.userId, linearTeamId: configuredLinearTeam(env) },
    context.scope.userId,
  );
}

export async function showMaintainerLinearMembers(context: CommunityContext): Promise<void> {
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
      "active" &&
    context.scope.userId !== context.env.COMMUNITY_ADMIN_ID
  )
    throw new InputError("활성 Product Owner만 ot1l 팀 현황을 볼 수 있어요.");
  const members = await activeMaintainers(context.env);
  const labels: Record<string, string> = {
    linked: "연결됨",
    invited: "초대 수락 대기",
    reserved: "초대 준비 중",
    paused: "연결 중지",
    not_connected: "연결 안 됨",
  };
  const rows = members.map(
    (member) =>
      `<@${string(member.userId)}> · ${labels[string(member.linearState)] ?? "확인 필요"}`,
  );
  await ephemeral(context, {
    text: `*Linear ot1l 팀 연결 현황*\n${rows.join("\n") || "활성 Product Owner가 없습니다."}\n\nLinear 연결은 본인이 버튼을 눌러 시작하며 DEV 팀과 워크스페이스 역할은 변경하지 않습니다.`,
  });
}

export async function assignMaintainerWork(
  context: CommunityContext,
  workKey: string,
  targetUserId: string,
): Promise<void> {
  const env = context.env;
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
      "active" &&
    context.scope.userId !== env.COMMUNITY_ADMIN_ID
  )
    throw new InputError("활성 Product Owner만 DRI를 변경할 수 있어요.");
  const store = new MaintainerOpsStore(env);
  const candidates = await activeMaintainers(env);
  const target = candidates.find((candidate) => candidate.userId === targetUserId);
  if (!target) throw new InputError("활성 Product Owner를 골라 주세요.");
  await store.execute(
    "work_assignment",
    { workKey, driUserId: targetUserId },
    context.scope.userId,
  );
  await refreshMaintainerWorkSurfaces(env, workKey);
  const work = await store.getWork(workKey);
  if (!work) throw new InputError("작업을 찾을 수 없어요.");
  const issueId = nullable(work, "linear_issue_id", "linearIssueId");
  const canMirror =
    linearConfigured(env) &&
    issueId !== null &&
    target.linearState === "linked" &&
    typeof target.linearUserId === "string";
  if (!canMirror) {
    await ephemeral(context, { text: `<@${targetUserId}>님을 DRI로 지정했어요.` });
    return;
  }
  try {
    const issue = await assignLinearIssue(env, issueId, target.linearUserId as string);
    await store.execute("work_sync", {
      workKey,
      linearTeamId: configuredLinearTeam(env),
      identifier: string(issue.identifier),
      url: string(issue.url),
      issueState: issueStage(object(issue.state).type, object(issue.state).name),
      driUserId: targetUserId,
      linearUpdatedAt: string(issue.updatedAt),
    });
    await refreshMaintainerWorkSurfaces(env, workKey);
    await ephemeral(context, {
      text: `<@${targetUserId}>님을 DRI로 지정하고 Linear 미러에도 반영했어요.`,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "community.maintainer.linear_assignment_mirror_failed",
        workKey,
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
    await ephemeral(context, {
      text: `<@${targetUserId}>님을 DRI로 지정했어요. Linear 미러 반영은 실패했지만 Slack 작업에는 영향이 없습니다.`,
    });
  }
}

export async function setMaintainerWorkStage(
  context: CommunityContext,
  workKey: string,
  stage: string,
): Promise<void> {
  if (!Object.hasOwn(WORK_STAGE_LABELS, stage) || stage === "deploying" || stage === "done")
    throw new InputError("선택할 수 없는 상태예요.");
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
      "active" &&
    context.scope.userId !== context.env.COMMUNITY_ADMIN_ID
  )
    throw new InputError("활성 Product Owner만 상태를 변경할 수 있어요.");
  await new MaintainerOpsStore(context.env).execute(
    "work_stage",
    { workKey, stage },
    context.scope.userId,
  );
  await refreshMaintainerWorkSurfaces(context.env, workKey);
  await ephemeral(context, {
    text: `상태를 '${WORK_STAGE_LABELS[stage as WorkStage]}'으로 바꿨어요.`,
  });
}

export async function reconcileMaintainerLinear(
  env: WorkEnv,
): Promise<{ readonly linked: number; readonly assigned: number }> {
  if (!linearConfigured(env)) return { linked: 0, assigned: 0 };
  const store = new MaintainerOpsStore(env);
  const maintainers = await activeMaintainers(env);
  const linearMembers = await linearTeamMembers(env);
  let linked = 0;
  for (const maintainer of maintainers) {
    if (maintainer.linearState === "linked") continue;
    const slackUser = object(
      (await callSlack(env.SLACK_BOT_TOKEN, "users.info", { user: string(maintainer.userId) }))
        .user,
    );
    const email = object(slackUser.profile).email;
    if (typeof email !== "string" || !email.includes("@")) continue;
    const match = linearMembers.find(
      (member) =>
        member.active === true &&
        typeof member.email === "string" &&
        member.email.toLowerCase() === email.toLowerCase(),
    );
    if (!match) continue;
    await store.execute("member_link", {
      userId: string(maintainer.userId),
      linearTeamId: configuredLinearTeam(env),
      linearUserId: string(match.id),
    });
    linked += 1;
  }
  const refreshedMaintainers = await activeMaintainers(env);
  const workItems = list(await store.execute("work_list", {})).map(object);
  let assigned = 0;
  for (const work of workItems) {
    const desiredDri = nullable(work, "desired_dri", "desiredDri");
    const currentDri = nullable(work, "dri_user_id", "driUserId");
    const issueId = nullable(work, "linear_issue_id", "linearIssueId");
    if (!desiredDri || desiredDri === currentDri || !issueId) continue;
    const target = refreshedMaintainers.find(
      (candidate) => candidate.userId === desiredDri && candidate.linearState === "linked",
    );
    if (!target || typeof target.linearUserId !== "string") continue;
    const issue = await assignLinearIssue(env, issueId, target.linearUserId);
    await store.execute("work_sync", {
      workKey: text(work, "work_key", "workKey"),
      linearTeamId: configuredLinearTeam(env),
      identifier: string(issue.identifier),
      url: string(issue.url),
      issueState: issueStage(object(issue.state).type, object(issue.state).name),
      driUserId: desiredDri,
      linearUpdatedAt: string(issue.updatedAt),
    });
    await refreshMaintainerWorkSurfaces(env, text(work, "work_key", "workKey"));
    assigned += 1;
  }
  return { linked, assigned };
}

export async function setMaintainerWorkReleaseStage(
  env: WorkEnv,
  workKey: string,
  releaseStage: string,
): Promise<void> {
  await new MaintainerOpsStore(env).execute("work_release", { workKey, releaseStage });
  await refreshMaintainerWorkSurfaces(env, workKey);
}
