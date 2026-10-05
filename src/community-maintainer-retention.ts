import { feedbackButton } from "./community-feedback-button";
import { escapeSlackText } from "./community-messages";
import type { CommunityContext, CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, type Json, object, string } from "./input";

export const MAINTAINER_RETENTION_VERSION = "v0.1.0";

function requestButton(label: string, mode: "question" | "qna" | "ot"): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    action_id: "community_maintainer_help_open",
    value: JSON.stringify({ ownerId: "actor", key: `retention-${mode}`, mode }),
  };
}

export function maintainerRetentionGuide(maintainersChannelId?: string) {
  const workChannel = maintainersChannelId ? `<#${maintainersChannelId}>` : "#maintainers";
  const text = `*OT1L Maintainer 시작 안내* · ${MAINTAINER_RETENTION_VERSION}\n\n1. 피드백이나 작업 제안은 ${workChannel}에서 시작하고, 작성한 Maintainer가 기본 DRI가 됩니다.\n2. DRI는 Slack 작업 카드에서 서로 넘길 수 있고 Linear Assignee와 동기화됩니다.\n3. AI는 Delegate로 구현을 돕고 사람 DRI가 결과를 확인합니다.\n4. Open 변경은 Maintainer 또는 Founder, Core 변경은 Founder만 승인합니다.\n5. 질문이나 첫 기여가 막히면 아래에서 도움을 요청하세요. 허들은 담당자가 정해진 뒤 이 채널에서 시작합니다.\n\n<https://github.com/Betalgeuse/ot1l/blob/main/CONTRIBUTING.md|개발 시작 안내> · <https://github.com/Betalgeuse/ot1l/blob/main/docs/MAINTAINER_LINEAR.md|작업 흐름>`;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          requestButton("질문 남기기", "question"),
          requestButton("Q&A 허들 요청", "qna"),
          requestButton("첫 기여 OT 요청", "ot"),
          feedbackButton("작업 제안하기"),
        ],
      },
    ],
  } as const;
}

export function maintainerWorkGuide() {
  const text = `*OT1L Maintainer 작업 시작* · ${MAINTAINER_RETENTION_VERSION}\n\n피드백이나 개선 제안을 남기면 같은 내용을 일반 피드백 채널에도 공유하고 Linear ot1l 이슈 하나로 연결합니다. Maintainer가 작성한 제안은 본인이 기본 DRI가 되며 카드에서 다른 Maintainer에게 넘길 수 있습니다.\n\n<https://ot1l.hyuk.me/maintainers|공개 가능한 작업 단계 보기>`;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          feedbackButton("피드백·작업 제안"),
          {
            type: "button",
            text: { type: "plain_text", text: "Linear 연결" },
            action_id: "community_maintainer_linear_connect",
            value: JSON.stringify({ ownerId: "actor", key: "linear-connect" }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "연결 현황" },
            action_id: "community_maintainer_linear_members",
            value: JSON.stringify({ ownerId: "actor", key: "linear-members" }),
          },
        ],
      },
    ],
  } as const;
}

async function upsertPinnedGuide(
  env: Pick<CommunityEnv, "SLACK_BOT_TOKEN">,
  channel: string,
  marker: string,
  payload: ReturnType<typeof maintainerRetentionGuide> | ReturnType<typeof maintainerWorkGuide>,
): Promise<string> {
  const history = await callSlack(env.SLACK_BOT_TOKEN, "conversations.history", {
    channel,
    limit: 100,
  });
  const previous = Array.isArray(history.messages)
    ? history.messages
        .map(object)
        .find((message) => typeof message.text === "string" && message.text.includes(marker))
    : undefined;
  const message = { channel, ...payload };
  const ts = previous
    ? string(
        (
          await callSlack(env.SLACK_BOT_TOKEN, "chat.update", {
            ...message,
            ts: string(previous.ts),
          })
        ).ts,
      )
    : string((await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", message)).ts);
  try {
    await callSlack(env.SLACK_BOT_TOKEN, "pins.add", { channel, timestamp: ts });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already_pinned")) throw error;
  }
  return ts;
}

export async function publishMaintainerRetentionGuide(
  env: Pick<
    CommunityEnv,
    "SLACK_BOT_TOKEN" | "COMMUNITY_RETENTION_CHANNEL_ID" | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
  >,
): Promise<string> {
  const channel = env.COMMUNITY_RETENTION_CHANNEL_ID;
  const main = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
  if (!channel || !main) throw new InputError("Maintainer 채널을 확인해 주세요.");
  const ts = await upsertPinnedGuide(
    env,
    channel,
    "*OT1L Maintainer 시작 안내*",
    maintainerRetentionGuide(main),
  );
  await upsertPinnedGuide(env, main, "*OT1L Maintainer 작업 시작*", maintainerWorkGuide());
  return ts;
}

export async function openMaintainerHelpModal(
  context: CommunityContext,
  triggerId: string,
  mode: "question" | "qna" | "ot",
): Promise<void> {
  if (!context.env.COMMUNITY_RETENTION_CHANNEL_ID)
    throw new InputError("Maintainer retention 채널을 확인해 주세요.");
  const titles = { question: "질문 남기기", qna: "Q&A 허들 요청", ot: "첫 기여 OT 요청" } as const;
  await callSlack(context.env.SLACK_BOT_TOKEN, "views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_maintainer_help_submit",
      private_metadata: JSON.stringify({
        channelId: context.scope.channelId,
        userId: context.scope.userId,
        source: context.source,
        thread: context.thread,
        date: context.date,
        mode,
      }),
      title: { type: "plain_text", text: titles[mode] },
      submit: { type: "plain_text", text: "요청하기" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "input",
          block_id: "topic",
          label: { type: "plain_text", text: mode === "question" ? "궁금한 점" : "함께 볼 주제" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            max_length: 700,
          },
        },
        {
          type: "input",
          block_id: "times",
          optional: mode === "question",
          label: { type: "plain_text", text: "가능한 시간 (선택)" },
          hint: {
            type: "plain_text",
            text: "한국시간 기준으로 가능한 시간을 한두 개 적어 주세요.",
          },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            max_length: 300,
          },
        },
      ],
    },
  });
}

function modalValue(view: Record<string, unknown>, id: string): string {
  const values = object(object(view.state).values);
  const block = object(values[id]);
  return string(object(block.value).value ?? "").trim();
}

export async function submitMaintainerHelp(
  context: CommunityContext,
  view: Record<string, unknown>,
  mode: "question" | "qna" | "ot",
): Promise<void> {
  const channel = context.env.COMMUNITY_RETENTION_CHANNEL_ID;
  if (!channel) throw new InputError("Maintainer retention 채널을 확인해 주세요.");
  const topic = modalValue(view, "topic");
  const times = modalValue(view, "times");
  if (!topic || topic.length > 700) throw new InputError("요청 내용을 확인해 주세요.");
  const labels = { question: "질문", qna: "Q&A 허들 요청", ot: "첫 기여 OT 요청" } as const;
  const text = `<@${context.scope.userId}>님의 *${labels[mode]}*\n${escapeSlackText(topic)}${times ? `\n\n*가능한 시간*\n${escapeSlackText(times)}` : ""}\n\n스레드에서 답하거나 시간을 맞춰 주세요.${mode === "question" ? "" : " 담당자가 정해지면 이 채널에서 허들을 시작합니다."}`;
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
    channel,
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "제가 도울게요" },
            action_id: "community_maintainer_help_claim",
            value: JSON.stringify({
              ownerId: "actor",
              key: `help:${string(view.id)}`,
              requesterId: context.scope.userId,
            }),
          },
        ],
      },
    ],
  });
}

export async function claimMaintainerHelp(
  context: CommunityContext,
  requesterId: string,
): Promise<void> {
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
    "active"
  )
    throw new InputError("활성 Maintainer만 도움 요청을 맡을 수 있어요.");
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
    channel: context.scope.channelId,
    thread_ts: context.thread,
    text: `<@${context.scope.userId}>님이 도와드릴게요. <@${requesterId}>님과 이 스레드에서 방법이나 시간을 맞춰 주세요.`,
  });
}
