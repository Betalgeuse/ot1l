import { eventScheduleToken } from "./community-event-link";
import { escapeSlackText } from "./community-messages";
import { type CommunityContext, ephemeral } from "./community-runtime";
import { callSlack } from "./community-social";
import type { TownhallEvent } from "./community-types";
import { InputError, type Json, list, object, string } from "./input";
import { openView } from "./slack-api";

export type TownhallEventInput = {
  readonly activity: string;
  readonly location: string;
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
    "누구나 작은 활동을 열 수 있어요. 활동·장소만 적어 먼저 올리고, 게시된 이벤트의 웹 시간표에서 가능한 날짜와 시간을 함께 맞춰보세요.";
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

export function parseTownhallEvent(
  view: Record<string, unknown>,
): TownhallEventInput | { readonly errors: Record<string, string> } {
  const values = object(object(view.state).values);
  const activity = string(object(object(values.activity).value).value).trim();
  const location = string(object(object(values.location).value).value).trim();
  const errors: Record<string, string> = {};
  if (!activity || [...activity].length > 500)
    errors.activity = "함께할 활동을 1~500자로 적어 주세요.";
  if (!location || [...location].length > 120 || /[\r\n]/.test(location))
    errors.location = "장소나 접속 방법을 줄바꿈 없이 1~120자로 적어 주세요.";
  return Object.keys(errors).length ? { errors } : { activity, location };
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
          type: "section",
          text: {
            type: "mrkdwn",
            text: event
              ? "날짜 범위·가능 시간·최소 인원·정기 회차는 이벤트 글의 *가능 시간 선택*에서 다시 조정할 수 있어요."
              : "이벤트를 게시한 뒤 *가능 시간 선택 → 시간 맞추기*에서 날짜 범위·복수 시간·최소 인원·정기 회차를 설정할 수 있어요.",
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

function eventActivityText(activity: string): string {
  const [title = "", ...description] = activity.split("\n");
  return `*${escapeSlackText(title)}*${description.length ? `\n${escapeSlackText(description.join("\n"))}` : ""}`;
}

export function townhallEventMessage(event: TownhallEvent): Json {
  const options = event.options
    .map((option) => `• ${slackDate(option.startsAt)} · 가능 ${option.votes}명`)
    .join("\n");
  const schedule = options
    ? `*시간 후보*\n${options}\n\n이번 이벤트에 가능한 시간을 여러 개 골라주세요.`
    : "*시간*\n아직 정하지 않았어요. 가능한 일정은 이 글의 스레드에서 함께 이야기해 주세요.";
  const phaseLabels: Record<TownhallEvent["phase"], string> = {
    recruiting: "🟡 모집 중",
    scheduling: "🗓 일정 조율 중",
    scheduled: "🗓 일정 확정·참가 확인 중",
    confirmed: "🟢 성사 확정",
    cancel_pending: "🟠 최소 인원 미달·취소 유예",
    cancelled: "⚪ 취소·보관",
    completed: "✅ 완료",
    paused: "⏸ 일시 중지",
  };
  const finalTime = event.finalStartAt
    ? `\n최종 일정: ${slackDate(event.finalStartAt)}${event.finalEndAt ? ` – ${slackDate(event.finalEndAt)}` : ""}`
    : "";
  const deadline = event.recruitmentDeadline
    ? `\n모집 마감: ${slackDate(event.recruitmentDeadline)}`
    : "";
  const series = event.series
    ? `\n반복: ${event.series.recurrenceEveryWeeks === 1 ? "매주" : "격주"} · ${event.series.occurrenceCount}회`
    : "";
  const text = `<@${event.hostUserId}>님이 이벤트를 열었어요! 🎟️\n${phaseLabels[event.phase]}\n${eventActivityText(event.activity)}\n장소: ${escapeSlackText(event.location)}${finalTime}${deadline}${series}\n관심 ${event.interestCount}명 · 참가 확정 ${event.goingCount}/${event.minConfirmed}명${event.capacity ? ` · 정원 ${event.capacity}명` : ""}\n\n${schedule}\n\n🙋 리액션은 관심 신호예요. 참가 확정과 실제 참석은 별도로 구분합니다. 참여 의견과 다음 활동 수요는 스레드에 남겨주세요.`;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          button(
            event.viewerState === "interested" ? "관심 취소" : "관심 있어요",
            "community_event_interest",
            "actor",
            event.eventId,
          ),
          button("가능 시간 선택", "community_event_availability", "actor", event.eventId),
          ...(event.finalStartAt
            ? [button("참가 확정", "community_event_rsvp", "actor", event.eventId)]
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

export async function publishTownhallScheduleLink(
  context: CommunityContext,
  event: TownhallEvent,
): Promise<void> {
  const baseUrl = context.env.EVENT_PUBLIC_BASE_URL;
  const secret = context.env.EVENT_SIGNING_SECRET;
  if (!baseUrl || !secret) throw new InputError("이벤트 시간표가 아직 준비되지 않았어요.");
  const origin = new URL(baseUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password)
    throw new InputError("이벤트 시간표 주소를 확인할 수 없어요.");
  const token = await eventScheduleToken(
    {
      teamId: context.scope.teamId,
      channelId: context.scope.channelId,
      eventId: event.eventId,
      userId: context.scope.userId,
    },
    secret,
  );
  const url = new URL(`/events/schedule/${token}`, origin).toString();
  await ephemeral(context, {
    text: "웹 시간표에서 가능한 시간을 표시해 주세요.",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            event.hostUserId === context.scope.userId && !event.poll
              ? "먼저 날짜 범위와 시간대를 열고, 회원들과 가능한 시간을 맞춰보세요."
              : "가능한 시간대를 여러 칸 선택해 저장할 수 있어요.",
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "시간 맞추기" },
          url,
          action_id: "community_event_schedule_web_open",
        },
      },
    ],
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

export async function syncTownhallEventMessage(
  env: Pick<CommunityContext["env"], "SLACK_BOT_TOKEN">,
  event: TownhallEvent,
): Promise<void> {
  if (!event.messageTs) throw new InputError("이벤트 게시 위치를 확인할 수 없어요.");
  await callSlack(env.SLACK_BOT_TOKEN, "chat.update", {
    channel: event.channelId,
    ts: event.messageTs,
    ...object(townhallEventMessage(event)),
  });
}

export async function applyTownhallInterest(
  context: CommunityContext,
  event: TownhallEvent,
): Promise<void> {
  const active = event.viewerState !== "interested";
  const updated = await context.store.townhallEventLifecycle("interest", {
    teamId: context.scope.teamId,
    channelId: context.scope.channelId,
    actorId: context.scope.userId,
    eventId: event.eventId,
    active,
    source: "button",
    now: new Date().toISOString(),
  });
  await updateEventMessage(context, updated);
  await notice(context, active ? "관심 이벤트로 표시했어요." : "관심 표시를 취소했어요.");
}

export async function applyTownhallRsvp(
  context: CommunityContext,
  event: TownhallEvent,
): Promise<void> {
  const updated = await context.store.townhallEventLifecycle("rsvp", {
    teamId: context.scope.teamId,
    channelId: context.scope.channelId,
    actorId: context.scope.userId,
    eventId: event.eventId,
    state: "going",
    now: new Date().toISOString(),
  });
  await updateEventMessage(context, updated);
  await notice(
    context,
    updated.viewerState === "waitlist" ? "정원이 차서 대기자로 등록했어요." : "참가를 확정했어요.",
  );
}

export async function runTownhallEventDue(
  context: Pick<CommunityContext, "env" | "store">,
  now: string,
): Promise<number> {
  const channelId = context.env.COMMUNITY_RELEASE_CHANNEL_ID;
  const actorId = context.env.COMMUNITY_ADMIN_ID;
  if (!channelId || !actorId) return 0;
  const events = await context.store.dueTownhallEvents(
    context.env.SLACK_TEAM_ID,
    channelId,
    actorId,
    now,
  );
  for (const event of events) {
    if (!event.messageTs) continue;
    await callSlack(context.env.SLACK_BOT_TOKEN, "chat.update", {
      channel: channelId,
      ts: event.messageTs,
      ...object(townhallEventMessage(event)),
    });
    if (event.phase === "cancel_pending" || event.phase === "cancelled")
      await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
        channel: channelId,
        thread_ts: event.messageTs,
        text:
          event.phase === "cancel_pending"
            ? `최소 인원 ${event.minConfirmed}명에 아직 못 미쳐 취소 유예 중이에요. ${event.graceHours}시간 안에 참가를 확정하거나 주최자가 마감을 조정할 수 있어요.`
            : "최소 인원이 모이지 않아 이번 이벤트는 취소·보관했어요. 나중에 ‘다시 열기’로 이어갈 수 있어요.",
      });
  }
  return events.length;
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
    const current = await context.store.getTownhallEvent({
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      eventId,
    });
    if (!current || current.hostUserId !== context.scope.userId)
      throw new InputError("주최자만 이벤트를 수정할 수 있어요.");
    const event = await context.store.editTownhallEvent({
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      eventId,
      expectedRevision,
      ...input,
      options: current.options.map((option) => option.startsAt),
    });
    await updateEventMessage(context, event);
    await notice(context, "활동과 장소를 수정했어요. 시간표와 참여 응답은 그대로 유지했어요.");
    return;
  }

  const prepared = await context.store.createTownhallEvent({
    teamId: context.scope.teamId,
    channelId,
    actorId: context.scope.userId,
    eventId: viewId,
    ...input,
    options: [],
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
