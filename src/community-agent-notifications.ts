import { setMaintainerWorkReleaseStage } from "./community-maintainer-work";
import { escapeSlackText } from "./community-messages";
import { notificationThread, postNotificationReply } from "./community-notification-thread";
import type { CommunityEnv } from "./community-runtime";
import { addReactions, CommunitySlackError, callSlack, removeReactions } from "./community-social";
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
  readonly taskUrl: string | null;
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
  const taskUrl = typeof payload.taskUrl === "string" ? payload.taskUrl : null;
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
    (["task_started", "task_ready"].includes(kind) &&
      (!taskUrl ||
        !/^https:\/\/chatgpt[.]com\/codex\/tasks\/task_[a-z]_[a-f0-9]{32}$/.test(taskUrl))) ||
    (taskUrl !== null &&
      !/^https:\/\/chatgpt[.]com\/codex\/tasks\/task_[a-z]_[a-f0-9]{32}$/.test(taskUrl))
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
    return `${mentions}\nmain 병합은 완료됐고, migration·Core·사이트를 안전한 순서로 운영 반영하고 있어요.\n${input.summary ?? input.bugId}`;
  if (input.kind === "merge_ready")
    return `수정안과 검증이 준비됐어요. 변경 내용을 확인한 뒤 병합을 승인해 주세요.\n${input.summary ?? "전체 검사를 통과했습니다."}`;
  return `${input.bugId} ${input.summary ?? "자동 개선을 완료하지 못했어요. 운영자가 확인할게요."}`;
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
        text: `*변경 등급*\n${input.changeClass === "open" ? "Open · 활성 PO 또는 Founder가 승인하면 병합과 배포가 연속 실행됩니다." : "Core · Founder 승인 뒤 병합과 배포가 연속 실행됩니다."}\n\n*As-Is*\n${escapeSlackText(input.asIs)}\n\n*To-Be*\n${escapeSlackText(input.toBe)}\n\n*수정 결과*\n${escapeSlackText(input.summary ?? "전체 검사를 통과했습니다.")}\n\n<${input.prUrl}|변경 내용 보기>`,
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
              input.changeClass === "core"
                ? "Founder 병합·배포 승인"
                : "Product Owner 병합·배포 승인",
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
  if (input.channelId === channelId) return input.threadTs;
  const history = await callSlack(env.SLACK_BOT_TOKEN, "conversations.history", {
    channel: channelId,
    limit: 200,
  });
  for (const value of list(history.messages)) {
    const message = object(value);
    if (
      (message.thread_ts === undefined || message.thread_ts === message.ts) &&
      typeof message.text === "string" &&
      (message.text.includes(`버그 키: ${input.bugId}`) ||
        message.text.includes(`버그 키 ${input.bugId}`))
    )
      return string(message.ts);
  }
  if (!input.asIs || !input.toBe) throw new Error("canonical maintainer feedback unavailable");
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
  roots: Map<string, string>,
): Promise<void> {
  const channelId = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
  if (!channelId) throw new TypeError("maintainer channel missing");
  const threadTs = roots.get(input.bugId) ?? (await maintainerFeedbackThread(env, input));
  roots.set(input.bugId, threadTs);
  if (input.kind !== "merge_ready") {
    if (
      !(await postNotificationReply(
        env.SLACK_BOT_TOKEN,
        channelId,
        threadTs,
        input.notificationId,
        {
          text: notificationText(input),
        },
      ))
    )
      throw new Error("maintainer notification root missing");
    return;
  }
  if (input.changeClass === "open") {
    if (
      !(await postNotificationReply(
        env.SLACK_BOT_TOKEN,
        channelId,
        threadTs,
        input.notificationId,
        {
          ...mergeReadyMessage(input),
        },
      ))
    )
      throw new Error("maintainer notification root missing");
    return;
  }
  const founderId = env.COMMUNITY_ADMIN_ID;
  if (!founderId) throw new TypeError("founder missing");
  if (
    !(await postNotificationReply(env.SLACK_BOT_TOKEN, channelId, threadTs, input.notificationId, {
      ...mergeReadyMessage(input),
      text: `<@${founderId}> ${notificationText(input)}\nCore 변경은 Founder 본인만 승인할 수 있습니다.`,
    }))
  )
    throw new Error("maintainer notification root missing");
}

export async function sendAgentNotifications(
  env: CommunityEnv,
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
  const roots = new Map<string, string>();
  const repository = env.COMMUNITY_CODEX_REPOSITORY;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new TypeError("invalid agent repository");
  for (const raw of claimed) {
    let notificationId: number | null = null;
    try {
      const row = object(raw);
      const parsedId = Number(row.notification_id);
      if (Number.isSafeInteger(parsedId) && parsedId > 0) notificationId = parsedId;
      const item = parseNotification(raw, repository);
      if (item.kind === "change_merged") {
        await setMaintainerWorkReleaseStage(env, item.bugId, "배포 확인 중");
        await db.queryJson("SELECT otl.bug_runner_finish_notification($1::jsonb)", [
          JSON.stringify({
            notificationId: item.notificationId,
            leaseToken,
            status: "sent",
            now: now.toISOString(),
          }),
        ]);
        sent += 1;
        continue;
      }
      if (item.kind === "change_deployed" && item.channelId === env.COMMUNITY_FEEDBACK_CHANNEL_ID)
        await postNotificationReply(
          env.SLACK_BOT_TOKEN,
          item.channelId,
          item.threadTs,
          item.notificationId,
          {
            text: "요청한 개선이 운영에 반영됐어요. ✅",
          },
        );
      if (
        item.kind === "task_failed" ||
        item.kind === "change_deployed" ||
        item.kind === "deployment_manual" ||
        item.kind === "merge_ready"
      )
        await sendMaintainerNotification(env, item, roots);
      const releaseStage =
        item.kind === "merge_ready"
          ? "검토·승인 중"
          : item.kind === "change_deployed"
            ? "운영 반영 완료"
            : item.kind === "deployment_manual"
              ? "순차 배포 중"
              : item.kind === "task_failed"
                ? "확인 필요"
                : null;
      if (releaseStage) await setMaintainerWorkReleaseStage(env, item.bugId, releaseStage);
      try {
        const sourceExists =
          (item.kind === "change_deployed" || item.kind === "task_failed") &&
          (await notificationThread(env.SLACK_BOT_TOKEN, item.channelId, item.threadTs));
        if (item.kind === "change_deployed" && sourceExists) {
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
        } else if (item.kind === "task_failed" && sourceExists) {
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
      } catch (error) {
        if (
          !(error instanceof CommunitySlackError) ||
          !["message_not_found", "thread_not_found"].includes(error.code)
        )
          throw error;
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
    } catch (error) {
      if (notificationId !== null)
        await db.queryJson("SELECT otl.bug_runner_finish_notification($1::jsonb)", [
          JSON.stringify({
            notificationId,
            leaseToken,
            status: "failed",
            now: now.toISOString(),
          }),
        ]);
      console.error(
        JSON.stringify({
          event: "community.agent_notification.failed",
          notificationId,
          errorType: error instanceof Error ? error.name : "Unknown",
        }),
      );
      failed += 1;
    }
  }
  return { claimed: claimed.length, sent, failed };
}
