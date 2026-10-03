import { escapeSlackText } from "./community-messages";
import { type CommunityContext, ephemeral } from "./community-runtime";
import { callSlack } from "./community-social";
import { openTownhallEventModal } from "./community-townhall-events";
import type { TownhallEventDemand } from "./community-types";
import { InputError, type Json, list, object, string } from "./input";
import { openView } from "./slack-api";

export type EventDemandInput = {
  readonly mode: "validate" | "host_request";
  readonly activity: string;
  readonly description: string;
  readonly locationHint: string;
  readonly timingHint: string;
};

export function eventDemandButton(mode: EventDemandInput["mode"]): Json {
  return {
    type: "button",
    text: {
      type: "plain_text",
      text: mode === "validate" ? "수요 먼저 확인하기" : "누가 좀 열어주세요",
    },
    action_id:
      mode === "validate" ? "community_event_demand_open" : "community_event_host_request_open",
    value: JSON.stringify({ ownerId: "actor", key: mode }),
  };
}

function action(label: string, actionId: string, ownerId: string, demandId: string): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    action_id: actionId,
    value: JSON.stringify({ ownerId, key: demandId, demandId }),
  };
}

function metadata(
  context: CommunityContext,
  mode: EventDemandInput["mode"],
  demand?: TownhallEventDemand,
) {
  return JSON.stringify({
    userId: context.scope.userId,
    channelId: context.scope.channelId,
    thread: context.thread,
    source: context.source,
    date: context.date,
    mode,
    ...(demand ? { demandId: demand.demandId, expectedRevision: demand.revision } : {}),
  });
}

export async function openEventDemandModal(
  context: CommunityContext,
  triggerId: string,
  mode: EventDemandInput["mode"],
  demand?: TownhallEventDemand,
): Promise<void> {
  if (context.scope.channelId !== context.env.COMMUNITY_RELEASE_CHANNEL_ID)
    throw new InputError("Townhall에서 열어 주세요.");
  if (demand && demand.requesterUserId !== context.scope.userId)
    throw new InputError("제안자만 수요를 수정할 수 있어요.");
  await openView(context.env.SLACK_BOT_TOKEN, {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_event_demand_submit",
      title: { type: "plain_text", text: demand ? "수요 수정" : "모임 수요" },
      submit: { type: "plain_text", text: demand ? "수정하기" : "Townhall에 올리기" },
      close: { type: "plain_text", text: "닫기" },
      private_metadata: metadata(context, mode, demand),
      blocks: [
        {
          type: "input",
          block_id: "activity",
          label: { type: "plain_text", text: "어떤 모임을 원하나요?" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            max_length: 200,
            ...(demand ? { initial_value: demand.activity } : {}),
            placeholder: { type: "plain_text", text: "고전을 같이 읽고 싶어요" },
          },
        },
        {
          type: "input",
          block_id: "description",
          optional: true,
          label: { type: "plain_text", text: "조금 더 설명해 주세요 (선택)" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            max_length: 500,
            ...(demand?.description ? { initial_value: demand.description } : {}),
          },
        },
        {
          type: "input",
          block_id: "location",
          optional: true,
          label: { type: "plain_text", text: "희망 장소 또는 방식 (선택)" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            max_length: 120,
            ...(demand?.locationHint ? { initial_value: demand.locationHint } : {}),
            placeholder: { type: "plain_text", text: "서울 또는 온라인" },
          },
        },
        {
          type: "input",
          block_id: "timing",
          optional: true,
          label: { type: "plain_text", text: "언제쯤이면 좋나요? (선택)" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            max_length: 120,
            ...(demand?.timingHint ? { initial_value: demand.timingHint } : {}),
            placeholder: { type: "plain_text", text: "10월 주말 또는 평일 저녁" },
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text:
                mode === "validate"
                  ? "관심은 리액션으로, 가능한 시간·장소와 아이디어는 스레드로 받아요."
                  : "주최자를 찾는 카드로 올라가며 누구나 *내가 주최할래요!*를 누를 수 있어요.",
            },
          ],
        },
      ],
    },
  } as Json);
}

function value(values: Record<string, unknown>, key: string): string {
  return string(object(object(values[key]).value).value ?? "").trim();
}
export function parseEventDemand(
  view: Record<string, unknown>,
  mode: EventDemandInput["mode"],
): EventDemandInput | { readonly errors: Record<string, string> } {
  const values = object(object(view.state).values);
  const activity = value(values, "activity");
  const description = value(values, "description"),
    locationHint = value(values, "location"),
    timingHint = value(values, "timing");
  const errors: Record<string, string> = {};
  if (!activity || [...activity].length > 200)
    errors.activity = "원하는 모임을 1~200자로 적어 주세요.";
  if ([...description].length > 500) errors.description = "설명은 500자까지 적을 수 있어요.";
  if ([...locationHint].length > 120) errors.location = "장소나 방식은 120자까지 적어 주세요.";
  if ([...timingHint].length > 120) errors.timing = "희망 시기는 120자까지 적어 주세요.";
  return Object.keys(errors).length
    ? { errors }
    : { mode, activity, description, locationHint, timingHint };
}

export function eventDemandMessage(demand: TownhallEventDemand): Json {
  const status =
    demand.status === "closed"
      ? "⚪ 수요 마감"
      : demand.mode === "validate"
        ? "🟡 수요 확인 중"
        : "🙋 주최자 찾는 중";
  const details = [
    demand.description,
    demand.locationHint ? `희망 장소/방식: ${demand.locationHint}` : "",
    demand.timingHint ? `희망 시기: ${demand.timingHint}` : "",
  ]
    .filter(Boolean)
    .map(escapeSlackText)
    .join("\n");
  const opened = demand.events
    .map(
      (event) =>
        `<https://app.slack.com/client/${demand.teamId}/${demand.channelId}/thread/${demand.channelId}-${event.messageTs}|<@${event.hostUserId}>님이 연 이벤트>`,
    )
    .join(" · ");
  const text = `<@${demand.requesterUserId}>님이 이런 모임을 원해요!\n${status}\n*${escapeSlackText(demand.activity)}*${details ? `\n${details}` : ""}${opened ? `\n\n열린 이벤트: ${opened}` : ""}\n\n관심은 리액션으로, 가능한 시간·장소와 의견은 스레드에 남겨주세요.`;
  const elements: Json[] = [];
  if (demand.status === "active") {
    elements.push(
      action(
        demand.events.length ? "나도 주최하기" : "내가 주최할래요!",
        "community_event_demand_host",
        "actor",
        demand.demandId,
      ),
    );
    elements.push(
      action("수요 수정", "community_event_demand_edit", demand.requesterUserId, demand.demandId),
    );
    elements.push(
      action("수요 마감", "community_event_demand_close", demand.requesterUserId, demand.demandId),
    );
  }
  return {
    text,
    blocks: [
      { type: "section", block_id: demand.demandId, text: { type: "mrkdwn", text } },
      ...(elements.length ? [{ type: "actions", elements }] : []),
    ],
    unfurl_links: false,
    unfurl_media: false,
  };
}

export async function submitEventDemand(
  context: CommunityContext,
  viewId: string,
  input: EventDemandInput,
  meta: Record<string, unknown>,
) {
  const channelId = context.env.COMMUNITY_RELEASE_CHANNEL_ID;
  if (!channelId) throw new InputError("Townhall을 확인해 주세요.");
  const demandId =
    meta.demandId === undefined
      ? `D${viewId.replace(/[^A-Z0-9-]/gi, "").slice(0, 79)}`
      : string(meta.demandId);
  let demand: TownhallEventDemand;
  if (meta.demandId === undefined) {
    demand = await context.store.townhallEventDemand("create", {
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      demandId,
      ...input,
    });
    if (!demand.messageTs) {
      const history = await callSlack(context.env.SLACK_BOT_TOKEN, "conversations.history", {
        channel: channelId,
        limit: 200,
      });
      const existing = list(history.messages)
        .map(object)
        .find((message) =>
          list(message.blocks ?? [])
            .map(object)
            .some((block) => block.block_id === demandId),
        );
      const messageTs = existing
        ? string(existing.ts)
        : string(
            (
              await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
                channel: channelId,
                ...object(eventDemandMessage(demand)),
              })
            ).ts,
          );
      demand = await context.store.townhallEventDemand("bind", {
        teamId: context.scope.teamId,
        channelId,
        actorId: context.scope.userId,
        demandId,
        messageTs,
      });
    }
  } else {
    demand = await context.store.townhallEventDemand("edit", {
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      demandId,
      expectedRevision: Number(meta.expectedRevision),
      ...input,
    });
  }
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.update", {
    channel: channelId,
    ts: demand.messageTs,
    ...object(eventDemandMessage(demand)),
  });
  await ephemeral(context, {
    text: meta.demandId === undefined ? "모임 수요를 올렸어요." : "모임 수요를 수정했어요.",
  });
}

export async function getEventDemand(context: CommunityContext, demandId: string) {
  return context.store.townhallEventDemand("get", {
    teamId: context.scope.teamId,
    channelId: context.scope.channelId,
    actorId: context.scope.userId,
    demandId,
  });
}
export async function openDemandHostingModal(
  context: CommunityContext,
  triggerId: string,
  demand: TownhallEventDemand,
) {
  if (demand.status !== "active") throw new InputError("마감되지 않은 수요만 주최할 수 있어요.");
  await openTownhallEventModal(context, triggerId, undefined, "poll", {
    demandId: demand.demandId,
    activity: [demand.activity, demand.description].filter(Boolean).join("\n"),
    location: demand.locationHint,
  });
}
export async function closeEventDemand(context: CommunityContext, demandId: string) {
  const demand = await context.store.townhallEventDemand("close", {
    teamId: context.scope.teamId,
    channelId: context.scope.channelId,
    actorId: context.scope.userId,
    demandId,
  });
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.update", {
    channel: demand.channelId,
    ts: demand.messageTs,
    ...object(eventDemandMessage(demand)),
  });
}
export async function refreshEventDemand(context: CommunityContext, demandId: string) {
  const demand = await getEventDemand(context, demandId);
  if (!demand.messageTs) return;
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.update", {
    channel: demand.channelId,
    ts: demand.messageTs,
    ...object(eventDemandMessage(demand)),
  });
}
