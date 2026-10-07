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

function configured(env: WorkEnv): boolean {
  return env.MAINTAINER_LINEAR_ENABLED === "true";
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
  work: Record<string, unknown>,
  maintainers: readonly Record<string, unknown>[],
  surface: "member" | "maintainer",
): { readonly text: string; readonly blocks: readonly Json[] } {
  const key = text(work, "work_key", "workKey");
  const title = text(work, "title");
  const reporterId = text(work, "reporter_id", "reporterId");
  const driId =
    nullable(work, "dri_user_id", "driUserId") ?? nullable(work, "desired_dri", "desiredDri");
  const syncState = text(work, "sync_state", "syncState");
  const stage =
    syncState === "failed"
      ? "Linear 동기화 확인 필요"
      : (nullable(work, "release_stage", "releaseStage") ??
        text(work, "issue_state", "issueState"));
  const identifier = nullable(work, "linear_identifier", "linearIdentifier");
  const url = nullable(work, "linear_url", "linearUrl");
  const actual = text(work, "actual");
  const expected = text(work, "expected");
  const dri = driId
    ? `<@${driId}>${nullable(work, "dri_user_id", "driUserId") ? "" : " · Linear 연결 대기"}`
    : "아직 정해지지 않음";
  const summary = `*${escapeSlackText(title)}*\n\n*As-Is*\n${escapeSlackText(actual)}\n\n*To-Be*\n${escapeSlackText(expected)}\n\n현재 단계  *${escapeSlackText(stage)}*\nDRI  ${dri}\n제안  <@${reporterId}>${identifier ? `\n작업  ${identifier}` : ""}\n버그 키  ${escapeSlackText(key)}`;
  const blocks: Json[] = [{ type: "section", text: { type: "mrkdwn", text: summary } }];
  if (surface === "maintainer") {
    const options = maintainers.slice(0, 100).map((member) => {
      const userId = string(member.userId);
      const connected = member.linearState === "linked";
      return {
        text: {
          type: "plain_text",
          text: `${string(member.displayName).slice(0, 55)}${connected ? "" : " · 연결 필요"}`,
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
      type: "button",
      text: { type: "plain_text", text: "Linear 연결" },
      action_id: "community_maintainer_linear_connect",
      value: JSON.stringify({ ownerId: "actor", key: "linear-connect" }),
    });
    if (url)
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Linear에서 보기" },
        action_id: "community_linear_open",
        value: JSON.stringify({ ownerId: "actor", key }),
        url,
      });
    blocks.push({ type: "actions", elements });
  } else {
    blocks.push({
      type: "actions",
      elements: [maintainerButton("Product Owner로 직접 개선하기")],
    });
  }
  return { text: `${title} · ${stage} · DRI ${dri} · 버그 키 ${key}`, blocks };
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
  const payload = { channel: channelId, ...workCard(work, maintainers, surface) };
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
  preferredMemberTs: string | null = null,
): Promise<void> {
  if (!configured(env)) return;
  const store = new MaintainerOpsStore(env);
  const work = await store.getWork(workKey);
  if (!work) return;
  const maintainers = await activeMaintainers(env);
  const feedback = env.COMMUNITY_FEEDBACK_CHANNEL_ID;
  const maintainer = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
  if (feedback) await upsertSurface(env, work, feedback, preferredMemberTs, "member", maintainers);
  if (maintainer) await upsertSurface(env, work, maintainer, null, "maintainer", maintainers);
}

export async function syncFeedbackToLinear(
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
  if (!configured(env)) return;
  const linearTeamId = configuredLinearTeam(env);
  const maintainer = await context.store.maintainerStatus(context.scope.teamId, input.reporterId);
  const desiredDri = maintainer?.state === "active" ? input.reporterId : null;
  const title =
    (input.expected || input.actual).split(/\r?\n/, 1)[0]?.trim().slice(0, 120) || "OT1L 피드백";
  const store = new MaintainerOpsStore(env);
  let work = object(
    await store.execute("work_put", {
      workKey: input.feedbackId,
      reporterId: input.reporterId,
      desiredDri,
      linearTeamId,
      title,
      actual: input.actual.slice(0, 2000),
      expected: input.expected.slice(0, 2000),
      workKind: "feedback",
      sourceChannel: input.sourceChannel,
      sourceThread: input.sourceThread,
    }),
  );
  const member = desiredDri ? await store.execute("member_get", { userId: desiredDri }) : null;
  const linearAssignee =
    member && typeof member === "object" && !Array.isArray(member)
      ? nullable(object(member), "linear_user_id", "linearUserId")
      : null;
  try {
    const issue = await createLinearIssue(env, {
      id: text(work, "linear_issue_id", "linearIssueId"),
      title,
      description: `## As-Is\n${input.actual}\n\n## To-Be\n${input.expected}\n\n[Slack에서 처음 남긴 위치](${slackUrl(env, input.sourceChannel, input.sourceThread)})\n\n${input.feedbackId}`,
      assigneeId: linearAssignee,
    });
    const assignee = issue.assignee ? object(issue.assignee) : null;
    const linkedDri = assignee
      ? activeMaintainers(env).then((members) => {
          const value = members.find((candidate) => candidate.linearUserId === assignee.id)?.userId;
          return typeof value === "string" ? value : null;
        })
      : Promise.resolve(null);
    work = object(
      await store.execute("work_sync", {
        workKey: input.feedbackId,
        linearTeamId,
        identifier: string(issue.identifier),
        url: string(issue.url),
        issueState: issueStage(object(issue.state).type, object(issue.state).name),
        driUserId: (await linkedDri) ?? null,
        linearUpdatedAt: string(issue.updatedAt),
      }),
    );
  } catch (error) {
    await store.execute("work_failed", { workKey: input.feedbackId });
    console.error(
      JSON.stringify({
        event: "community.linear.feedback_sync_failed",
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
  }
  await refreshMaintainerWorkSurfaces(env, input.feedbackId, context.thread);
  void work;
}

export async function connectMaintainerToLinear(context: CommunityContext): Promise<void> {
  const env = context.env;
  if (!configured(env)) throw new InputError("Linear 연결은 아직 준비 중이에요.");
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
    "active"
  )
    throw new InputError("Maintainer를 먼저 활성화해 주세요.");
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
  if (!configured(env)) return;
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
    throw new InputError("활성 Maintainer만 ot1l 팀 현황을 볼 수 있어요.");
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
    text: `*Linear ot1l 팀 연결 현황*\n${rows.join("\n") || "활성 Maintainer가 없습니다."}\n\nLinear 연결은 본인이 버튼을 눌러 시작하며 DEV 팀과 워크스페이스 역할은 변경하지 않습니다.`,
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
    throw new InputError("활성 Maintainer만 DRI를 변경할 수 있어요.");
  const store = new MaintainerOpsStore(env);
  const candidates = await activeMaintainers(env);
  const target = candidates.find((candidate) => candidate.userId === targetUserId);
  if (!target) throw new InputError("활성 Maintainer를 골라 주세요.");
  await store.execute(
    "work_assignment",
    { workKey, driUserId: targetUserId },
    context.scope.userId,
  );
  if (target.linearState !== "linked" || typeof target.linearUserId !== "string") {
    await refreshMaintainerWorkSurfaces(env, workKey);
    await ephemeral(context, {
      text: `<@${targetUserId}>님이 Linear를 연결하면 DRI 배정을 마무리할게요.`,
    });
    return;
  }
  const work = await store.getWork(workKey);
  if (!work) throw new InputError("작업을 찾을 수 없어요.");
  const issue = await assignLinearIssue(
    env,
    text(work, "linear_issue_id", "linearIssueId"),
    target.linearUserId,
  );
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
    text: `<@${targetUserId}>님에게 DRI를 넘겼어요. Linear와 Slack에 반영했습니다.`,
  });
}

export async function reconcileMaintainerLinear(
  env: WorkEnv,
): Promise<{ readonly linked: number; readonly assigned: number }> {
  if (!configured(env)) return { linked: 0, assigned: 0 };
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
    if (!desiredDri || desiredDri === currentDri) continue;
    const target = refreshedMaintainers.find(
      (candidate) => candidate.userId === desiredDri && candidate.linearState === "linked",
    );
    if (!target || typeof target.linearUserId !== "string") continue;
    const issue = await assignLinearIssue(
      env,
      text(work, "linear_issue_id", "linearIssueId"),
      target.linearUserId,
    );
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
  if (!configured(env)) return;
  await new MaintainerOpsStore(env).execute("work_release", { workKey, releaseStage });
  await refreshMaintainerWorkSurfaces(env, workKey);
}
