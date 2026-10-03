import { escapeSlackText } from "./community-messages";
import type { CommunityEnv } from "./community-runtime";
import { addReactions, callSlack, removeReactions } from "./community-social";
import { type Json, list, object, string } from "./input";
import { NeonStore } from "./store";

type Notification = {
  readonly notificationId: number;
  readonly bugId: string;
  readonly channelId: string;
  readonly threadTs: string;
  readonly kind:
    | "task_started"
    | "task_ready"
    | "task_failed"
    | "merge_ready"
    | "change_merged"
    | "change_deployed"
    | "deployment_manual";
  readonly taskUrl: string;
  readonly attempt: number;
  readonly reporterId: string | null;
  readonly adminId: string | null;
  readonly summary: string | null;
  readonly prNumber: number | null;
  readonly prUrl: string | null;
  readonly packetRevision: number | null;
  readonly asIs: string | null;
  readonly toBe: string | null;
  readonly changeClass: "open" | "core" | null;
  readonly headSha: string | null;
  readonly classificationDigest: string | null;
};

function parseNotification(value: unknown, repository: string): Notification {
  const row = object(value);
  const payload = object(row.payload);
  const notificationId = Number(row.notification_id);
  const attempt = Number(payload.attempt);
  const kind = string(row.kind);
  const taskUrl = string(payload.taskUrl);
  if (
    !Number.isSafeInteger(notificationId) ||
    notificationId < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    ![
      "task_started",
      "task_ready",
      "task_failed",
      "merge_ready",
      "change_merged",
      "change_deployed",
      "deployment_manual",
    ].includes(kind) ||
    !/^https:\/\/chatgpt[.]com\/codex\/tasks\/task_[a-z]_[a-f0-9]{32}$/.test(taskUrl)
  )
    throw new TypeError("invalid agent notification");
  return {
    notificationId,
    bugId: string(row.bug_id),
    channelId: string(row.channel_id),
    threadTs: string(row.thread_ts),
    kind: kind as Notification["kind"],
    taskUrl,
    attempt,
    reporterId: typeof payload.reporterId === "string" ? payload.reporterId : null,
    adminId: typeof payload.adminId === "string" ? payload.adminId : null,
    summary: typeof payload.summary === "string" ? payload.summary.slice(0, 1200) : null,
    prNumber: Number.isSafeInteger(Number(payload.prNumber)) ? Number(payload.prNumber) : null,
    prUrl:
      typeof payload.prUrl === "string" &&
      payload.prUrl.startsWith(`https://github.com/${repository}/pull/`) &&
      /^https:\/\/github[.]com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(payload.prUrl)
        ? payload.prUrl
        : null,
    packetRevision: Number.isSafeInteger(Number(payload.packetRevision))
      ? Number(payload.packetRevision)
      : null,
    asIs: typeof payload.asIs === "string" ? payload.asIs.slice(0, 1000) : null,
    toBe: typeof payload.toBe === "string" ? payload.toBe.slice(0, 1000) : null,
    changeClass:
      payload.changeClass === "open" || payload.changeClass === "core" ? payload.changeClass : null,
    headSha:
      typeof payload.headSha === "string" && /^[0-9a-f]{40,64}$/.test(payload.headSha)
        ? payload.headSha
        : null,
    classificationDigest:
      typeof payload.classificationDigest === "string" &&
      /^[0-9a-f]{64}$/.test(payload.classificationDigest)
        ? payload.classificationDigest
        : null,
  };
}

function notificationText(input: Notification): string {
  const mentions = [...new Set([input.adminId, input.reporterId].filter(Boolean))]
    .map((id) => `<@${id}>`)
    .join(" ");
  if (input.kind === "change_deployed") {
    return `${mentions}\n운영 배포와 실제 동작 확인을 완료했어요! ✅\n${input.summary ?? "승인한 To-Be가 운영 환경에서 확인됐습니다."}`;
  }
  if (input.kind === "change_merged")
    return `${mentions}\n수정안을 main에 병합했어요. 운영 배포와 실제 동작 확인을 기다리고 있습니다.\n${input.bugId}`;
  if (input.kind === "deployment_manual")
    return `${mentions}\n자동 배포 범위를 벗어난 변경이 있어 운영자 배포가 필요해요.\n${input.summary ?? input.bugId}`;
  if (input.kind === "merge_ready")
    return `수정안과 검증이 준비됐어요. 변경 내용을 확인한 뒤 병합을 승인해 주세요.\n${input.summary ?? "전체 검사를 통과했습니다."}`;
  return `${input.bugId} 자동 개선을 완료하지 못했어요. 운영자가 확인할게요.`;
}

function mergeReadyMessage(input: Notification, includeButton = true) {
  if (
    input.kind !== "merge_ready" ||
    !input.prNumber ||
    !input.prUrl ||
    !input.packetRevision ||
    !input.asIs ||
    !input.toBe ||
    !input.changeClass ||
    !input.headSha ||
    !input.classificationDigest
  )
    throw new TypeError("invalid merge ready notification");
  const blocks: Json[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*변경 등급*\n${input.changeClass === "open" ? "Open · 활성 Maintainer 또는 Founder가 승인하면 병합과 배포가 연속 실행됩니다." : "Core · Founder 승인 뒤 병합과 배포가 연속 실행됩니다."}\n\n*As-Is*\n${escapeSlackText(input.asIs)}\n\n*To-Be*\n${escapeSlackText(input.toBe)}\n\n*수정 결과*\n${escapeSlackText(input.summary ?? "전체 검사를 통과했습니다.")}\n\n<${input.prUrl}|변경 내용 보기>`,
      },
    },
  ];
  if (includeButton)
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text:
              input.changeClass === "core" ? "Founder 병합·배포 승인" : "Maintainer 병합·배포 승인",
          },
          style: "primary",
          action_id: "community_feedback_merge_approve",
          value: JSON.stringify({
            ownerId: "actor",
            key: input.bugId,
            feedbackId: input.bugId,
            packetRevision: input.packetRevision,
            prNumber: input.prNumber,
            changeClass: input.changeClass,
            headSha: input.headSha,
            classificationDigest: input.classificationDigest,
          }),
        },
      ],
    });
  return {
    text: notificationText(input),
    blocks,
  };
}

async function maintainerFeedbackThread(
  env: Pick<CommunityEnv, "SLACK_TEAM_ID" | "SLACK_BOT_TOKEN" | "COMMUNITY_MAINTAINERS_CHANNEL_ID">,
  input: Notification,
): Promise<string> {
  const channelId = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
  if (!channelId) throw new TypeError("maintainer channel missing");
  const history = await callSlack(env.SLACK_BOT_TOKEN, "conversations.history", {
    channel: channelId,
    limit: 200,
  });
  for (const value of list(history.messages)) {
    const message = object(value);
    if (
      message.thread_ts === undefined &&
      typeof message.text === "string" &&
      message.text.includes(`버그 키: ${input.bugId}`)
    )
      return string(message.ts);
  }
  const sourceUrl = `https://app.slack.com/client/${env.SLACK_TEAM_ID}/${input.channelId}/thread/${input.channelId}-${input.threadTs}`;
  const text = `${input.reporterId ? `<@${input.reporterId}>님의 피드백\n\n` : ""}*As-Is*\n${escapeSlackText(input.asIs ?? "현재 상태 확인 필요")}\n\n*To-Be*\n${escapeSlackText(input.toBe ?? "원하는 상태 확인 필요")}\n\n<${sourceUrl}|원본 피드백 보기>\n버그 키: ${input.bugId}`;
  return string(
    (
      await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
        channel: channelId,
        text,
      })
    ).ts,
  );
}

async function sendMaintainerNotification(
  env: Pick<
    CommunityEnv,
    "SLACK_TEAM_ID" | "SLACK_BOT_TOKEN" | "COMMUNITY_MAINTAINERS_CHANNEL_ID" | "COMMUNITY_ADMIN_ID"
  >,
  input: Notification,
): Promise<void> {
  const channelId = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
  if (!channelId) throw new TypeError("maintainer channel missing");
  const threadTs = await maintainerFeedbackThread(env, input);
  if (input.kind !== "merge_ready") {
    await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel: channelId,
      thread_ts: threadTs,
      text: notificationText(input),
    });
    return;
  }
  if (input.changeClass === "open") {
    await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel: channelId,
      thread_ts: threadTs,
      ...mergeReadyMessage(input),
    });
    return;
  }
  const founderId = env.COMMUNITY_ADMIN_ID;
  if (!founderId) throw new TypeError("founder missing");
  await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
    channel: channelId,
    thread_ts: threadTs,
    ...mergeReadyMessage(input, false),
    text: `${notificationText(input)}\nFounder에게 개인 승인 버튼을 보냈습니다.`,
  });
  const direct = await callSlack(env.SLACK_BOT_TOKEN, "conversations.open", {
    users: founderId,
  });
  const directChannelId = string(object(direct.channel).id);
  await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
    channel: directChannelId,
    ...mergeReadyMessage(input),
  });
}

export async function sendAgentNotifications(
  env: Pick<
    CommunityEnv,
    | "SLACK_TEAM_ID"
    | "SLACK_BOT_TOKEN"
    | "DATABASE_URL"
    | "COMMUNITY_CODEX_REPOSITORY"
    | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
    | "COMMUNITY_ADMIN_ID"
  >,
  now = new Date(),
): Promise<{ readonly claimed: number; readonly sent: number; readonly failed: number }> {
  const db = new NeonStore(env.DATABASE_URL);
  const leaseToken = crypto.randomUUID();
  const claimed = await db.queryJson("SELECT otl.bug_runner_claim_notifications($1::jsonb)", [
    JSON.stringify({ teamId: env.SLACK_TEAM_ID, leaseToken, limit: 10, now: now.toISOString() }),
  ]);
  if (!Array.isArray(claimed)) throw new TypeError("invalid agent notification batch");
  let sent = 0;
  let failed = 0;
  const repository = env.COMMUNITY_CODEX_REPOSITORY;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new TypeError("invalid agent repository");
  for (const raw of claimed) {
    const item = parseNotification(raw, repository);
    try {
      if (
        item.kind === "task_failed" ||
        item.kind === "change_merged" ||
        item.kind === "change_deployed" ||
        item.kind === "deployment_manual" ||
        item.kind === "merge_ready"
      )
        await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
          channel: item.channelId,
          thread_ts: item.threadTs,
          text:
            item.kind === "merge_ready"
              ? `수정안과 검증이 준비되어 <#${env.COMMUNITY_MAINTAINERS_CHANNEL_ID}>에 승인을 요청했어요. · ${item.bugId}`
              : notificationText(item),
        });
      if (
        item.kind === "task_failed" ||
        item.kind === "change_merged" ||
        item.kind === "change_deployed" ||
        item.kind === "deployment_manual" ||
        item.kind === "merge_ready"
      )
        await sendMaintainerNotification(env, item);
      if (item.kind === "change_deployed") {
        await removeReactions(env.SLACK_BOT_TOKEN, {
          channel: item.channelId,
          ts: item.threadTs,
          names: ["loading"],
        });
        await addReactions(env.SLACK_BOT_TOKEN, {
          channel: item.channelId,
          ts: item.threadTs,
          names: ["white_check_mark"],
        });
      } else if (item.kind === "task_failed" || item.kind === "deployment_manual") {
        await removeReactions(env.SLACK_BOT_TOKEN, {
          channel: item.channelId,
          ts: item.threadTs,
          names: ["loading"],
        });
        await addReactions(env.SLACK_BOT_TOKEN, {
          channel: item.channelId,
          ts: item.threadTs,
          names: ["warning"],
        });
      }
      await db.queryJson("SELECT otl.bug_runner_finish_notification($1::jsonb)", [
        JSON.stringify({
          notificationId: item.notificationId,
          leaseToken,
          status: "sent",
          now: now.toISOString(),
        }),
      ]);
      sent += 1;
    } catch {
      await db.queryJson("SELECT otl.bug_runner_finish_notification($1::jsonb)", [
        JSON.stringify({
          notificationId: item.notificationId,
          leaseToken,
          status: "failed",
          now: now.toISOString(),
        }),
      ]);
      failed += 1;
    }
  }
  return { claimed: claimed.length, sent, failed };
}
