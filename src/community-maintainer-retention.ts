import { feedbackButton } from "./community-feedback-button";
import { escapeSlackText } from "./community-messages";
import type { CommunityContext, CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, type Json, object, string } from "./input";

export const MAINTAINER_RETENTION_VERSION = "v0.3.0";

function requestButton(label: string, mode: "question" | "qna" | "ot"): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    action_id: `community_maintainer_help_open_${mode}`,
    value: JSON.stringify({ ownerId: "actor", key: `retention-${mode}`, mode }),
  };
}

function specialtyButton(): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: "전문 그룹 설정" },
    action_id: "community_po_specialties_open",
    value: JSON.stringify({ ownerId: "actor", key: "po-specialties" }),
    accessibility_label: "PO Designer와 PO Dev 멘션 그룹 설정",
  };
}

export function maintainerRetentionGuide(maintainersChannelId?: string) {
  const workChannel = maintainersChannelId ? `<#${maintainersChannelId}>` : "#po-work";
  const text = `*OT1L Product Owner 라운지* · ${MAINTAINER_RETENTION_VERSION}\n\n이곳은 PO끼리 아이디어, 질문, 사용자 경험과 모임을 이야기하는 공간입니다. Product Owner는 코드를 잘 알아야 얻는 역할이 아니라 실제 회원의 문제를 발견하고 더 나은 결과까지 함께 책임지는 참여 방식이에요.\n\n• 궁금한 점은 *질문 남기기*로 바로 물어보세요.\n• 같이 배우거나 살펴보고 싶다면 *Q&A 허들 요청*을 남겨주세요.\n• 첫 기여를 혼자 시작하기 어렵다면 *첫 기여 OT 요청*으로 동료를 찾으세요.\n• 바꾸고 싶은 것은 *작업 제안하기*로 ${workChannel}의 DRI·진행 카드에 연결합니다.\n• 디자인이나 개발 멘션을 받고 싶다면 *전문 그룹 설정*에서 @po-designer 또는 @po-dev를 선택합니다.\n\n대화는 이 채널에서, DRI·단계·승인·병합·배포 영수증은 ${workChannel}에서 관리합니다. AI가 실행해도 결과를 확인하고 설명하는 사람 DRI는 남습니다.\n\n<https://github.com/Betalgeuse/ot1l/blob/main/CONTRIBUTING.md|직접 만들어 보고 싶을 때> · <https://github.com/Betalgeuse/ot1l/blob/main/docs/PRODUCT_OWNER_WORKFLOW.md|작업이 반영되는 흐름>`;
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
          specialtyButton(),
        ],
      },
    ],
  } as const;
}

export function maintainerWorkGuide() {
  const text = `*OT1L PO 작업 보드* · ${MAINTAINER_RETENTION_VERSION}\n\n이 채널은 대화방이 아니라 작업 정본입니다. 제안별 As-Is·To-Be, DRI, 단계, 검증 결과, 정확한 SHA 승인과 병합·배포 영수증을 한 스레드에서 관리합니다. 아이디어와 질문은 #po에서 충분히 이야기한 뒤 작업으로 연결해 주세요.\n\n<https://ot1l.hyuk.me/po|지금 함께 만드는 일 보기>`;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [feedbackButton("새 PO 작업 제안")],
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
  if (!channel || !main) throw new InputError("PO 채널을 확인해 주세요.");
  const ts = await upsertPinnedGuide(
    env,
    channel,
    "*OT1L Product Owner 라운지*",
    maintainerRetentionGuide(main),
  );
  await upsertPinnedGuide(env, main, "*OT1L PO 작업 보드*", maintainerWorkGuide());
  return ts;
}

export async function openMaintainerHelpModal(
  context: CommunityContext,
  triggerId: string,
  mode: "question" | "qna" | "ot",
): Promise<void> {
  if (!context.env.COMMUNITY_RETENTION_CHANNEL_ID)
    throw new InputError("PO 대화 채널을 확인해 주세요.");
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
  if (!channel) throw new InputError("PO 대화 채널을 확인해 주세요.");
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
    throw new InputError("활성 Product Owner만 도움 요청을 맡을 수 있어요.");
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
    channel: context.scope.channelId,
    thread_ts: context.thread,
    text: `<@${context.scope.userId}>님이 도와드릴게요. <@${requesterId}>님과 이 스레드에서 방법이나 시간을 맞춰 주세요.`,
  });
}
