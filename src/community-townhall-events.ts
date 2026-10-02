import { escapeSlackText } from "./community-messages";
import { type CommunityContext, ephemeral } from "./community-runtime";
import { callSlack } from "./community-social";
import type { TownhallEvent } from "./community-types";
import { InputError, type Json, list, object, string } from "./input";
import { openView } from "./slack-api";

export type TownhallEventInput = {
  readonly activity: string;
  readonly location: string;
  readonly options: readonly string[];
};

function button(label: string, actionId: string, ownerId: string, eventId: string): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    action_id: actionId,
    value: JSON.stringify({ ownerId, key: eventId, eventId }),
  };
}

export function townhallEventButton(): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: "이벤트 열기" },
    style: "primary",
    action_id: "community_event_open",
    value: JSON.stringify({ ownerId: "actor", key: "new-townhall-event" }),
    accessibility_label: "Townhall에 새 활동 열기",
  };
}

export function townhallEventLauncher(): Json {
  const text =
    "누구나 작은 활동을 열 수 있어요. 활동·장소를 적고, 정해진 시간이 없다면 시간 후보는 비워두세요. 후보가 있으면 참여자는 가능한 시간을 여러 개 고를 수 있어요.";
  return {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*같이할 이벤트가 있나요?*\n${text}` },
      },
      { type: "actions", elements: [townhallEventButton()] },
    ],
  };
}

function localTime(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

function parseOptions(value: string): readonly string[] | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 8 || new Set(lines).size !== lines.length) return null;
  const parsed: string[] = [];
  for (const line of lines) {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(line);
    if (!match) return null;
    const timestamp = Date.parse(
      `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+09:00`,
    );
    if (!Number.isFinite(timestamp) || timestamp <= Date.now() - 60_000) return null;
    const canonical = new Date(timestamp).toISOString();
    if (localTime(canonical) !== line.replace("T", " ")) return null;
    parsed.push(canonical);
  }
  return parsed;
}

export function parseTownhallEvent(
  view: Record<string, unknown>,
): TownhallEventInput | { readonly errors: Record<string, string> } {
  const values = object(object(view.state).values);
  const activity = string(object(object(values.activity).value).value).trim();
  const location = string(object(object(values.location).value).value).trim();
  const rawOptions = string(object(object(values.options).value).value).trim();
  const options = parseOptions(rawOptions);
  const errors: Record<string, string> = {};
  if (!activity || [...activity].length > 500)
    errors.activity = "함께할 활동을 1~500자로 적어 주세요.";
  if (!location || [...location].length > 120 || /[\r\n]/.test(location))
    errors.location = "장소나 접속 방법을 줄바꿈 없이 1~120자로 적어 주세요.";
  if (!options)
    errors.options =
      "시간 후보를 비우거나, 한국시간 YYYY-MM-DD HH:MM 형식으로 미래 시간을 한 줄에 하나씩 최대 8개 적어 주세요.";
  return Object.keys(errors).length ? { errors } : { activity, location, options: options ?? [] };
}

function eventMetadata(context: CommunityContext, event?: TownhallEvent) {
  return JSON.stringify({
    userId: context.scope.userId,
    channelId: context.scope.channelId,
    thread: context.thread,
    source: context.source,
    date: context.date,
    ...(event ? { eventId: event.eventId, expectedRevision: event.revision } : {}),
  });
}

export async function openTownhallEventModal(
  context: CommunityContext,
  triggerId: string,
  event?: TownhallEvent,
): Promise<void> {
  if (context.scope.channelId !== context.env.COMMUNITY_RELEASE_CHANNEL_ID)
    throw new InputError("Townhall에서 열어 주세요.");
  if (event && event.hostUserId !== context.scope.userId)
    throw new InputError("주최자만 이벤트를 수정할 수 있어요.");
  await openView(context.env.SLACK_BOT_TOKEN, {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_event_submit",
      title: { type: "plain_text", text: event ? "이벤트 수정" : "이벤트 열기" },
      submit: { type: "plain_text", text: event ? "수정하기" : "Townhall에 올리기" },
      close: { type: "plain_text", text: "닫기" },
      private_metadata: eventMetadata(context, event),
      blocks: [
        {
          type: "input",
          block_id: "activity",
          label: { type: "plain_text", text: "무슨 활동을 하나요?" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            max_length: 500,
            ...(event ? { initial_value: event.activity } : {}),
            placeholder: { type: "plain_text", text: "함께 산책하고 커피 마셔요." },
          },
        },
        {
          type: "input",
          block_id: "location",
          label: { type: "plain_text", text: "장소 또는 접속 방법" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            max_length: 120,
            ...(event ? { initial_value: event.location } : {}),
            placeholder: { type: "plain_text", text: "성수역 또는 온라인 링크" },
          },
        },
        {
          type: "input",
          block_id: "options",
          optional: true,
          label: { type: "plain_text", text: "가능한 시간 후보" },
          hint: {
            type: "plain_text",
            text: "아직 시간을 정하지 않았다면 비워두세요. 입력할 때는 한국시간 기준으로 한 줄에 하나씩 최대 8개까지 적어 주세요.",
          },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            max_length: 160,
            ...(event
              ? {
                  initial_value: event.options
                    .map((option) => localTime(option.startsAt))
                    .join("\n"),
                }
              : {}),
            placeholder: { type: "plain_text", text: "2026-10-10 19:00\n2026-10-11 14:00" },
          },
        },
      ],
    },
  });
}

function slackDate(iso: string): string {
  const epoch = Math.floor(Date.parse(iso) / 1000);
  return `<!date^${epoch}^{date_short_pretty} {time}|${localTime(iso)} KST>`;
}

export function townhallEventMessage(event: TownhallEvent): Json {
  const options = event.options
    .map((option) => `• ${slackDate(option.startsAt)} · 가능 ${option.votes}명`)
    .join("\n");
  const schedule = options
    ? `*시간 후보*\n${options}\n\n이번 이벤트에 가능한 시간을 여러 개 골라주세요.`
    : "*시간*\n아직 정하지 않았어요. 가능한 일정은 이 글의 스레드에서 함께 이야기해 주세요.";
  const text = `<@${event.hostUserId}>님이 이벤트를 열었어요! 🎟️\n*${escapeSlackText(event.activity)}*\n장소: ${escapeSlackText(event.location)}\n\n${schedule}\n\n참여 의견과 다음에 열었으면 하는 활동은 이 글의 스레드에 남겨주세요.`;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          ...(event.options.length
            ? [button("가능 시간 선택", "community_event_availability", "actor", event.eventId)]
            : []),
          button("이벤트 수정", "community_event_edit", event.hostUserId, event.eventId),
          townhallEventButton(),
        ],
      },
    ],
    unfurl_links: false,
    unfurl_media: false,
  };
}

export async function openTownhallAvailabilityModal(
  context: CommunityContext,
  triggerId: string,
  event: TownhallEvent,
): Promise<void> {
  await openView(context.env.SLACK_BOT_TOKEN, {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_event_availability_submit",
      title: { type: "plain_text", text: "가능한 시간" },
      submit: { type: "plain_text", text: "저장" },
      close: { type: "plain_text", text: "닫기" },
      private_metadata: eventMetadata(context, event),
      blocks: [
        {
          type: "input",
          block_id: "availability",
          optional: true,
          label: { type: "plain_text", text: "가능한 시간을 모두 선택해 주세요" },
          element: {
            type: "multi_static_select",
            action_id: "value",
            placeholder: { type: "plain_text", text: "복수 선택 가능" },
            options: event.options.map((option) => ({
              text: { type: "plain_text", text: `${localTime(option.startsAt)} KST` },
              value: option.startsAt,
            })),
            ...(event.selected.length
              ? {
                  initial_options: event.options
                    .filter((option) => event.selected.includes(option.startsAt))
                    .map((option) => ({
                      text: { type: "plain_text", text: `${localTime(option.startsAt)} KST` },
                      value: option.startsAt,
                    })),
                }
              : {}),
          },
        },
      ],
    },
  });
}

export function parseTownhallAvailability(view: Record<string, unknown>): readonly string[] {
  const values = object(object(view.state).values);
  const selected = object(object(values.availability).value).selected_options;
  if (selected === undefined || selected === null) return [];
  return list(selected).map((value) => string(object(value).value));
}

async function updateEventMessage(context: CommunityContext, event: TownhallEvent): Promise<void> {
  if (!event.messageTs) throw new InputError("이벤트 게시 위치를 확인할 수 없어요.");
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.update", {
    channel: event.channelId,
    ts: event.messageTs,
    ...object(townhallEventMessage(event)),
  });
}

async function notice(context: CommunityContext, text: string): Promise<void> {
  try {
    await ephemeral(context, { text });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "community.townhall_event.notice_failed",
        type: error instanceof Error ? error.name : "Unknown",
      }),
    );
  }
}

export async function submitTownhallEvent(
  context: CommunityContext,
  viewId: string,
  input: TownhallEventInput,
  metadata: Record<string, unknown>,
): Promise<void> {
  const channelId = context.env.COMMUNITY_RELEASE_CHANNEL_ID;
  if (!channelId || context.scope.channelId !== channelId)
    throw new InputError("Townhall에서 열어 주세요.");
  if (metadata.eventId !== undefined) {
    const eventId = string(metadata.eventId);
    const expectedRevision = Number(metadata.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new InputError("이벤트 버전을 확인할 수 없어요.");
    const event = await context.store.editTownhallEvent({
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      eventId,
      expectedRevision,
      ...input,
    });
    await updateEventMessage(context, event);
    await notice(context, "이벤트를 수정했어요. 그대로 남은 시간 후보의 응답은 유지했어요.");
    return;
  }

  const prepared = await context.store.createTownhallEvent({
    teamId: context.scope.teamId,
    channelId,
    actorId: context.scope.userId,
    eventId: viewId,
    ...input,
  });
  if (!prepared.created) {
    if (prepared.event.status === "active") await updateEventMessage(context, prepared.event);
    return;
  }
  let createdMessageTs: string | null = null;
  try {
    const sent = await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel: channelId,
      ...object(townhallEventMessage(prepared.event)),
    });
    createdMessageTs = string(sent.ts);
    if (
      !(await context.store.bindTownhallEvent({
        teamId: context.scope.teamId,
        channelId,
        actorId: context.scope.userId,
        eventId: viewId,
        messageTs: createdMessageTs,
      }))
    )
      throw new InputError("이벤트 저장 결과를 확인할 수 없어요.");
    createdMessageTs = null;
    await notice(context, "Townhall에 이벤트를 올렸어요.");
  } catch (error) {
    if (createdMessageTs)
      try {
        await callSlack(context.env.SLACK_BOT_TOKEN, "chat.delete", {
          channel: channelId,
          ts: createdMessageTs,
        });
        createdMessageTs = null;
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            event: "community.townhall_event.cleanup_failed",
            type: cleanupError instanceof Error ? cleanupError.name : "Unknown",
          }),
        );
      }
    if (!createdMessageTs)
      await context.store.abortTownhallEvent({
        teamId: context.scope.teamId,
        channelId,
        actorId: context.scope.userId,
        eventId: viewId,
      });
    await notice(context, "이벤트 게시를 확인하지 못했어요. 다시 시도해 주세요.");
    console.error(
      JSON.stringify({
        event: "community.townhall_event.failed",
        type: error instanceof Error ? error.name : "Unknown",
      }),
    );
  }
}

export async function submitTownhallAvailability(
  context: CommunityContext,
  eventId: string,
  selected: readonly string[],
): Promise<void> {
  const event = await context.store.voteTownhallEvent({
    teamId: context.scope.teamId,
    channelId: context.scope.channelId,
    actorId: context.scope.userId,
    eventId,
    selected,
  });
  await updateEventMessage(context, event);
  await notice(context, selected.length ? "가능한 시간을 저장했어요." : "시간 선택을 비웠어요.");
}
