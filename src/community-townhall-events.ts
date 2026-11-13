import { eventDemandButton, refreshEventDemand } from "./community-event-demands";
import { eventScheduleToken } from "./community-event-link";
import { escapeSlackText } from "./community-messages";
import { type CommunityContext, ephemeral } from "./community-runtime";
import { callSlack } from "./community-social";
import type { CommunityStore } from "./community-store";
import type { TownhallEvent } from "./community-types";
import { InputError, type Json, list, object, string } from "./input";
import { openView } from "./slack-api";

export type TownhallEventInput = {
  readonly activity: string;
  readonly location: string;
  readonly scheduleMode: "fixed" | "poll" | "edit" | "edit-fixed";
  readonly startsAt: string | null;
  readonly durationMinutes: number;
  readonly minConfirmed: number;
  readonly capacity: number | null;
};
export type EventDemandPrefill = {
  readonly demandId: string;
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

export function townhallEventButton(label = "일정 정해서 열기"): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    style: "primary",
    action_id: "community_event_open_fixed",
    value: JSON.stringify({ ownerId: "actor", key: "new-townhall-event" }),
    accessibility_label: "Townhall에 새 활동 열기",
  };
}

export function townhallPollButton(): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: "시간 미정 이벤트 열기" },
    action_id: "community_event_open_poll",
    value: JSON.stringify({ ownerId: "actor", key: "new-townhall-event-poll" }),
    accessibility_label: "Townhall에서 시간 미정 이벤트 열기",
  };
}

function townhallEventCardLaunchButtons(): readonly Json[] {
  return [townhallEventButton("나도 일정 정해서 열기"), townhallPollButton()];
}

export function townhallEventLauncher(): Json {
  const text =
    "날짜가 정해졌다면 Slack에서 바로 열고 참가를 받아요. 아직 모른다면 시간 같이 정하기로 가능한 일정을 모아보세요.";
  return {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*같이할 이벤트가 있나요?*\n${text}` },
      },
      {
        type: "actions",
        elements: [
          townhallEventButton(),
          townhallPollButton(),
          eventDemandButton("validate"),
          eventDemandButton("host_request"),
        ],
      },
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
  scheduleMode: "fixed" | "poll" | "edit" | "edit-fixed",
): TownhallEventInput | { readonly errors: Record<string, string> } {
  const values = object(object(view.state).values);
  const activity = string(object(object(values.activity).value).value).trim();
  const location = string(object(object(values.location).value).value).trim();
  const errors: Record<string, string> = {};
  if (!activity || [...activity].length > 500)
    errors.activity = "함께할 활동을 1~500자로 적어 주세요.";
  if (!location || [...location].length > 120 || /[\r\n]/.test(location))
    errors.location = "장소나 접속 방법을 줄바꿈 없이 1~120자로 적어 주세요.";
  let startsAt: string | null = null;
  let durationMinutes = 60;
  let minConfirmed = 2;
  let capacity: number | null = null;
  const minimum = Number(string(object(object(values.minimum).value).value));
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > 100)
    errors.minimum = "최소 인원을 1~100명으로 적어 주세요.";
  else minConfirmed = minimum;
  const capacityText = string(object(object(values.capacity).value).value ?? "").trim();
  if (capacityText) {
    const maximum = Number(capacityText);
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 500)
      errors.capacity = "최대 인원을 1~500명으로 적거나 무제한이면 비워 주세요.";
    else if (Number.isSafeInteger(minimum) && maximum < minimum)
      errors.capacity = "최대 인원은 최소 성사 인원보다 작을 수 없어요.";
    else capacity = maximum;
  }
  if (scheduleMode === "fixed" || scheduleMode === "edit-fixed") {
    const selectedDate = string(object(object(values.event_date).value).selected_date);
    const selectedHour = string(
      object(object(object(values.event_hour).value).selected_option).value,
    );
    const selectedMinute = string(
      object(object(object(values.event_minute).value).selected_option).value,
    );
    const selectedTime = `${selectedHour}:${selectedMinute}`;
    const duration = Number(
      string(object(object(object(values.duration).value).selected_option).value),
    );
    const timestamp = Date.parse(`${selectedDate}T${selectedTime}:00+09:00`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ||
      !/^(?:[01]\d|2[0-3])$/.test(selectedHour) ||
      !/^(?:00|30)$/.test(selectedMinute)
    )
      errors.event_date = "날짜와 시작 시각을 확인해 주세요.";
    else if (!Number.isFinite(timestamp) || timestamp <= Date.now())
      errors.event_date = "미래 일정을 선택해 주세요.";
    else startsAt = new Date(timestamp).toISOString();
    if (![60, 90, 120, 180, 240].includes(duration)) errors.duration = "진행 시간을 선택해 주세요.";
    else durationMinutes = duration;
  }
  return Object.keys(errors).length
    ? { errors }
    : { activity, location, scheduleMode, startsAt, durationMinutes, minConfirmed, capacity };
}

function eventMetadata(
  context: CommunityContext,
  event?: TownhallEvent,
  scheduleMode: "fixed" | "poll" | "edit" | "edit-fixed" = event
    ? event.finalStartAt
      ? "edit-fixed"
      : "edit"
    : "fixed",
  demand?: EventDemandPrefill,
) {
  return JSON.stringify({
    userId: context.scope.userId,
    channelId: context.scope.channelId,
    thread: context.thread,
    source: context.source,
    date: context.date,
    scheduleMode,
    ...(demand ? { demandId: demand.demandId } : {}),
    ...(event ? { eventId: event.eventId, expectedRevision: event.revision } : {}),
  });
}

export async function openTownhallEventModal(
  context: CommunityContext,
  triggerId: string,
  event?: TownhallEvent,
  scheduleMode: "fixed" | "poll" = "fixed",
  demand?: EventDemandPrefill,
): Promise<void> {
  if (context.scope.channelId !== context.env.COMMUNITY_RELEASE_CHANNEL_ID)
    throw new InputError("Townhall에서 열어 주세요.");
  if (event && event.hostUserId !== context.scope.userId)
    throw new InputError("주최자만 이벤트를 수정할 수 있어요.");
  const currentStart = event?.finalStartAt ? localTime(event.finalStartAt) : null;
  const durationOptions = [60, 90, 120, 180, 240].map((minutes) => ({
    text: {
      type: "plain_text",
      text: minutes % 60 ? `${Math.floor(minutes / 60)}시간 30분` : `${minutes / 60}시간`,
    },
    value: String(minutes),
  }));
  const hourOptions = Array.from({ length: 24 }, (_, hour) => {
    const value = String(hour).padStart(2, "0");
    return { text: { type: "plain_text", text: value }, value };
  });
  const minuteOptions = ["00", "30"].map((value) => ({
    text: { type: "plain_text", text: value },
    value,
  }));
  const initialHour = currentStart?.slice(11, 13) ?? "19";
  const initialMinute = currentStart?.slice(14, 16) ?? "00";
  await openView(context.env.SLACK_BOT_TOKEN, {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_event_submit",
      title: { type: "plain_text", text: event ? "이벤트 수정" : "이벤트 열기" },
      submit: { type: "plain_text", text: event ? "수정하기" : "Townhall에 올리기" },
      close: { type: "plain_text", text: "닫기" },
      private_metadata: eventMetadata(
        context,
        event,
        event ? (event.finalStartAt ? "edit-fixed" : "edit") : scheduleMode,
        demand,
      ),
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
            ...(event
              ? { initial_value: event.activity }
              : demand?.activity
                ? { initial_value: demand.activity }
                : {}),
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
            ...(event
              ? { initial_value: event.location }
              : demand?.location
                ? { initial_value: demand.location }
                : {}),
            placeholder: { type: "plain_text", text: "성수역 또는 온라인 링크" },
          },
        },
        ...((!event && scheduleMode === "fixed") || event?.finalStartAt
          ? [
              {
                type: "input",
                block_id: "event_date",
                label: { type: "plain_text", text: "날짜" },
                element: {
                  type: "datepicker",
                  action_id: "value",
                  ...(currentStart ? { initial_date: currentStart.slice(0, 10) } : {}),
                },
              },
              {
                type: "input",
                block_id: "event_hour",
                label: { type: "plain_text", text: "시작 시 (0~23시)" },
                element: {
                  type: "static_select",
                  action_id: "value",
                  initial_option:
                    hourOptions.find((option) => option.value === initialHour) ?? hourOptions[19],
                  options: hourOptions,
                },
              },
              {
                type: "input",
                block_id: "event_minute",
                label: { type: "plain_text", text: "시작 분 (30분 단위)" },
                element: {
                  type: "static_select",
                  action_id: "value",
                  initial_option:
                    minuteOptions.find((option) => option.value === initialMinute) ??
                    minuteOptions[0],
                  options: minuteOptions,
                },
              },
              {
                type: "input",
                block_id: "duration",
                label: { type: "plain_text", text: "진행 시간" },
                element: {
                  type: "static_select",
                  action_id: "value",
                  initial_option:
                    durationOptions.find(
                      (option) => option.value === String(event?.durationMinutes ?? 120),
                    ) ?? durationOptions[2],
                  options: durationOptions,
                },
              },
            ]
          : []),
        {
          type: "input",
          block_id: "minimum",
          label: { type: "plain_text", text: "최소 성사 인원" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            initial_value: String(event?.minConfirmed ?? 2),
          },
        },
        {
          type: "input",
          block_id: "capacity",
          optional: true,
          label: { type: "plain_text", text: "최대 인원" },
          hint: { type: "plain_text", text: "정원 제한이 없으면 비워 두세요." },
          element: {
            type: "plain_text_input",
            action_id: "value",
            ...(event?.capacity ? { initial_value: String(event.capacity) } : {}),
            placeholder: { type: "plain_text", text: "비워 두면 무제한" },
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: event
              ? event.finalStartAt
                ? "일정을 바꾸면 Slack 카드와 종료 후 후기 요청 시각도 함께 갱신됩니다."
                : "날짜 범위·가능 시간·정기 회차는 이벤트 글의 *가능한 시간 고르기*에서 조정하고, 최소 성사 인원과 최대 인원은 여기서 바꿀 수 있어요."
              : scheduleMode === "poll"
                ? "게시한 뒤 웹 달력에서 *이 시간으로 확정되면 참가할 수 있는 시간*을 받아요. 선택된 시간으로 확정되면 자동 참가 처리됩니다."
                : "게시 즉시 참가를 받을 수 있어요. 주최자는 참가 확정 1명으로 포함됩니다.",
          },
        },
      ],
    },
  } as Json);
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
  const options =
    event.poll && event.options.length > 8
      ? `${event.poll.startDate}~${event.poll.endDate} · 매일 ${event.poll.dayStart}~${event.poll.dayEnd} · ${event.poll.stepMinutes}분 간격 · 총 ${event.options.length}개`
      : event.options
          .map((option) => `• ${slackDate(option.startsAt)} · 가능 ${option.votes}명`)
          .join("\n");
  const schedule = options
    ? `*시간 후보*\n${options}\n\n선택한 시간으로 확정되면 자동으로 참가됩니다.`
    : "*시간*\n아직 정하지 않았어요.";
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
  const text = `<!channel> <@${event.hostUserId}>님이 이벤트를 열었어요! 🎟️\n${phaseLabels[event.phase]}\n${eventActivityText(event.activity)}\n장소: ${escapeSlackText(event.location)}${finalTime}${deadline}${series}\n👥 참가 확정 ${event.goingCount}명 · 성사 기준 ${event.minConfirmed}명 · 최대 인원 ${event.capacity ? `${event.capacity}명` : "무제한"}${event.waitlistCount ? ` · 대기 ${event.waitlistCount}명` : ""}${event.finalStartAt ? "" : `\n\n${schedule}`}`;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          ...(event.finalStartAt
            ? [button("참가 / 참가 취소", "community_event_rsvp", "actor", event.eventId)]
            : [
                button(
                  "가능한 시간 고르기",
                  "community_event_availability",
                  "actor",
                  event.eventId,
                ),
              ]),
          button("이벤트 수정", "community_event_edit", event.hostUserId, event.eventId),
          ...townhallEventCardLaunchButtons(),
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

export async function applyTownhallRsvp(
  context: CommunityContext,
  event: TownhallEvent,
): Promise<void> {
  const cancelling = event.viewerState === "going" || event.viewerState === "waitlist";
  const updated = await context.store.townhallEventLifecycle("rsvp", {
    teamId: context.scope.teamId,
    channelId: context.scope.channelId,
    actorId: context.scope.userId,
    eventId: event.eventId,
    state: cancelling ? "declined" : "going",
    now: new Date().toISOString(),
  });
  await updateEventMessage(context, updated);
  await postEventThreadStatus(
    context.env,
    updated,
    cancelling
      ? `<@${context.scope.userId}>님이 참가를 취소했어요.`
      : `<@${context.scope.userId}>님이 참가해요.`,
  );
  await notice(
    context,
    cancelling && updated.viewerState === "declined"
      ? "참가를 취소했어요."
      : updated.viewerState === "waitlist"
        ? "정원이 차서 대기자로 등록했어요."
        : updated.viewerState === "going"
          ? "참가를 확정했어요."
          : "참가 상태를 확인해 주세요.",
  );
}

export async function postEventThreadStatus(
  env: Pick<CommunityContext["env"], "SLACK_BOT_TOKEN">,
  event: TownhallEvent,
  lead: string,
): Promise<void> {
  if (!event.messageTs) return;
  const going = event.participants
    .filter((participant) => participant.state === "going")
    .map((participant) => `<@${participant.userId}>`);
  await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
    channel: event.channelId,
    thread_ts: event.messageTs,
    text: `${lead}\n👥 현재 참가자 ${going.length}명${going.length ? ` · ${going.join(" ")}` : ""}`,
  });
}

export async function scheduleEventReviewPrompt(
  env: Pick<CommunityContext["env"], "SLACK_BOT_TOKEN">,
  store: CommunityStore,
  event: TownhallEvent,
  actorId: string,
): Promise<void> {
  if (!event.messageTs || !event.finalEndAt) return;
  const postAt = Math.max(
    Math.floor(Date.parse(event.finalEndAt) / 1000) + 15 * 60,
    Math.floor(Date.now() / 1000) + 60,
  );
  const scope = {
    teamId: event.teamId,
    channelId: event.channelId,
    eventId: event.eventId,
    actorId,
  };
  const existing = await store.townhallEventFollowup("get", scope);
  if (existing !== null) {
    const record = object(existing);
    if (Math.abs(Date.parse(string(record.postAt)) / 1000 - postAt) < 1) return;
    await callSlack(env.SLACK_BOT_TOKEN, "chat.deleteScheduledMessage", {
      channel: event.channelId,
      scheduled_message_id: string(record.scheduledMessageId),
    });
  }
  const text = `<@${event.hostUserId}>님, 오늘 모임은 어떠셨나요? 참가한 분들과 짧은 후기를 이 스레드에 남겨주세요!`;
  const scheduled = object(
    await callSlack(env.SLACK_BOT_TOKEN, "chat.scheduleMessage", {
      channel: event.channelId,
      thread_ts: event.messageTs,
      post_at: postAt,
      text,
    }),
  );
  await store.townhallEventFollowup("put", {
    ...scope,
    scheduledMessageId: string(scheduled.scheduled_message_id),
    postAt: new Date(postAt * 1000).toISOString(),
  });
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
    let event = await context.store.editTownhallEvent({
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      eventId,
      expectedRevision,
      ...input,
      options: input.startsAt ? [input.startsAt] : current.options.map((option) => option.startsAt),
    });
    event = await context.store.townhallEventLifecycle("configure", {
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      eventId,
      eventKind: current.eventKind,
      minConfirmed: input.minConfirmed,
      capacity: input.capacity,
      recruitmentDeadline: input.startsAt
        ? new Date(Date.parse(input.startsAt) - 12 * 60 * 60 * 1000).toISOString()
        : current.recruitmentDeadline,
      graceHours: current.graceHours,
      autoCancel: current.autoCancel,
      now: new Date().toISOString(),
    });
    if (input.startsAt) {
      await context.store.townhallEventSeries("configure", {
        teamId: context.scope.teamId,
        channelId,
        actorId: context.scope.userId,
        eventId,
        recurrenceEveryWeeks: current.series?.recurrenceEveryWeeks ?? 1,
        occurrenceCount: current.series?.occurrenceCount ?? 4,
        durationMinutes: input.durationMinutes,
      });
      await context.store.townhallEventLifecycle("finalize", {
        teamId: context.scope.teamId,
        channelId,
        actorId: context.scope.userId,
        eventId,
        startsAt: input.startsAt,
        now: new Date().toISOString(),
      });
      event =
        (await context.store.townhallEventSeries("finalize", {
          teamId: context.scope.teamId,
          channelId,
          actorId: context.scope.userId,
          eventId,
        })) ?? event;
    }
    await updateEventMessage(context, event);
    if (input.startsAt) {
      await postEventThreadStatus(context.env, event, "일정이 변경됐어요.");
      await scheduleEventReviewPrompt(context.env, context.store, event, context.scope.userId);
    }
    await notice(context, "활동과 장소를 수정했어요. 시간표와 참여 응답은 그대로 유지했어요.");
    return;
  }

  const prepared = await context.store.createTownhallEvent({
    teamId: context.scope.teamId,
    channelId,
    actorId: context.scope.userId,
    eventId: viewId,
    ...input,
    options: input.startsAt ? [input.startsAt] : [],
  });
  if (!prepared.created) {
    if (prepared.event.status === "active") await updateEventMessage(context, prepared.event);
    return;
  }
  const demandId = metadata.demandId === undefined ? null : string(metadata.demandId);
  if (demandId)
    await context.store.townhallEventDemand("link_event", {
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      demandId,
      eventId: viewId,
    });
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
    await context.store.townhallEventLifecycle("configure", {
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      eventId: viewId,
      eventKind: "gathering",
      minConfirmed: input.minConfirmed,
      capacity: input.capacity,
      recruitmentDeadline:
        input.startsAt === null
          ? null
          : new Date(Date.parse(input.startsAt) - 12 * 60 * 60 * 1000).toISOString(),
      graceHours: 12,
      autoCancel: input.startsAt !== null,
      now: new Date().toISOString(),
    });
    let event = await context.store.townhallEventSeries("configure", {
      teamId: context.scope.teamId,
      channelId,
      actorId: context.scope.userId,
      eventId: viewId,
      recurrenceEveryWeeks: 1,
      occurrenceCount: 4,
      durationMinutes: input.durationMinutes,
    });
    if (input.startsAt) {
      await context.store.townhallEventLifecycle("finalize", {
        teamId: context.scope.teamId,
        channelId,
        actorId: context.scope.userId,
        eventId: viewId,
        startsAt: input.startsAt,
        now: new Date().toISOString(),
      });
      event = await context.store.townhallEventSeries("finalize", {
        teamId: context.scope.teamId,
        channelId,
        actorId: context.scope.userId,
        eventId: viewId,
      });
    }
    if (!event) throw new InputError("이벤트 상태를 확인할 수 없어요.");
    await updateEventMessage(context, event);
    if (input.startsAt)
      await postEventThreadStatus(
        context.env,
        event,
        "일정이 확정됐어요. 이 이벤트는 Slack에서 바로 참가할 수 있어요.",
      );
    if (input.startsAt)
      await scheduleEventReviewPrompt(context.env, context.store, event, context.scope.userId);
    createdMessageTs = null;
    await notice(context, "Townhall에 이벤트를 올렸어요.");
    if (demandId) await refreshEventDemand(context, demandId);
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
