import { CommunityScheduleStore, parseCommunityRecord } from "./community-schedule-store";
import type {
  ChangeResult,
  CommunityChapter,
  CommunityDay,
  CommunityMaintainer,
  CommunityRecord,
  CommunityScope,
  DayChange,
  DayScope,
  GardenSeason,
  MemberIntroduction,
  Outcome,
  TownhallEvent,
} from "./community-types";
import { date, InputError, type Json, list, object, string } from "./input";

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InputError("Boolean required");
  return value;
}
function scope(value: unknown): CommunityScope {
  const v = object(value);
  return { teamId: string(v.teamId), channelId: string(v.channelId), userId: string(v.userId) };
}
function outcome(value: unknown): Outcome {
  switch (value) {
    case "pending":
    case "complete":
    case "progress":
    case "partial":
    case "not_done":
      return value;
    default:
      throw new InputError("Invalid outcome");
  }
}
function day(value: unknown): CommunityDay {
  const v = object(value);
  if (typeof v.revision !== "number" || !Number.isSafeInteger(v.revision))
    throw new InputError("Invalid revision");
  return {
    ...scope(v),
    date: date(v.date),
    goal: string(v.goal),
    outcome: outcome(v.outcome),
    reflection: string(v.reflection),
    resting: bool(v.resting),
    revision: v.revision,
  };
}
function introduction(value: unknown): MemberIntroduction | null {
  if (value === null) return null;
  const v = object(value);
  if (typeof v.revision !== "number" || !Number.isSafeInteger(v.revision))
    throw new InputError("Invalid introduction revision");
  return {
    teamId: string(v.teamId),
    userId: string(v.userId),
    confirmedName: v.confirmedName === null ? null : string(v.confirmedName),
    intro: string(v.intro),
    linkedin: v.linkedin === null ? null : string(v.linkedin),
    details: v.details === null ? null : string(v.details),
    channelId: v.channelId === null ? null : string(v.channelId),
    messageTs: v.messageTs === null ? null : string(v.messageTs),
    revision: v.revision,
  };
}

function gardenSeason(value: Json): GardenSeason | null {
  if (value === null) return null;
  const input = object(value);
  if (typeof input.seasonId !== "number" || !Number.isSafeInteger(input.seasonId))
    throw new InputError("Invalid garden season");
  return {
    seasonId: input.seasonId,
    openedOn: date(input.openedOn),
    closedOn: input.closedOn === null ? null : date(input.closedOn),
    days: list(input.days).map(day),
  };
}

function townhallEvent(value: Json): TownhallEvent | null {
  if (value === null) return null;
  const input = object(value);
  const status = string(input.status);
  if (status !== "draft" && status !== "active") throw new InputError("Invalid event status");
  const revision = input.revision;
  const eventKind = string(input.eventKind);
  const phase = string(input.phase);
  const viewerState = input.viewerState === null ? null : string(input.viewerState);
  const integer = (value: unknown, label: string) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value))
      throw new InputError(`Invalid ${label}`);
    return value;
  };
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1)
    throw new InputError("Invalid event revision");
  if (!["gathering", "challenge", "series"].includes(eventKind))
    throw new InputError("Invalid event kind");
  if (
    ![
      "recruiting",
      "scheduling",
      "scheduled",
      "confirmed",
      "cancel_pending",
      "cancelled",
      "completed",
      "paused",
    ].includes(phase)
  )
    throw new InputError("Invalid event phase");
  if (
    viewerState !== null &&
    !["interested", "going", "waitlist", "declined"].includes(viewerState)
  )
    throw new InputError("Invalid event participant state");
  return {
    eventId: string(input.eventId),
    teamId: string(input.teamId),
    channelId: string(input.channelId),
    hostUserId: string(input.hostUserId),
    activity: string(input.activity),
    location: string(input.location),
    revision,
    status,
    messageTs: input.messageTs === null ? null : string(input.messageTs),
    options: list(input.options).map((value) => {
      const option = object(value);
      const position = option.position;
      const votes = option.votes;
      if (
        typeof position !== "number" ||
        !Number.isSafeInteger(position) ||
        typeof votes !== "number" ||
        !Number.isSafeInteger(votes)
      )
        throw new InputError("Invalid event option");
      return { startsAt: string(option.startsAt), position, votes };
    }),
    selected: list(input.selected).map(string),
    eventKind: eventKind as TownhallEvent["eventKind"],
    phase: phase as TownhallEvent["phase"],
    minConfirmed: integer(input.minConfirmed, "minimum"),
    capacity: input.capacity === null ? null : integer(input.capacity, "capacity"),
    recruitmentDeadline:
      input.recruitmentDeadline === null ? null : string(input.recruitmentDeadline),
    graceHours: integer(input.graceHours, "grace"),
    autoCancel: input.autoCancel === true,
    graceUntil: input.graceUntil === null ? null : string(input.graceUntil),
    finalStartAt: input.finalStartAt === null ? null : string(input.finalStartAt),
    finalEndAt:
      input.finalEndAt === undefined || input.finalEndAt === null ? null : string(input.finalEndAt),
    durationMinutes:
      input.durationMinutes === undefined ? 60 : integer(input.durationMinutes, "event duration"),
    cancelledAt: input.cancelledAt === null ? null : string(input.cancelledAt),
    cancellationReason: input.cancellationReason === null ? null : string(input.cancellationReason),
    interestCount: integer(input.interestCount, "interest count"),
    goingCount: integer(input.goingCount, "going count"),
    waitlistCount: integer(input.waitlistCount, "waitlist count"),
    viewerState: viewerState as TownhallEvent["viewerState"],
    participants:
      input.participants === undefined
        ? []
        : list(input.participants).map((value) => {
            const participant = object(value);
            const state = string(participant.state);
            if (state !== "going" && state !== "waitlist")
              throw new InputError("Invalid event participant");
            return { userId: string(participant.userId), state };
          }),
    poll:
      input.poll === null
        ? null
        : (() => {
            const poll = object(input.poll);
            const stepMinutes = poll.stepMinutes;
            if (stepMinutes !== 30 && stepMinutes !== 60) throw new InputError("Invalid poll step");
            if (poll.timezone !== "Asia/Seoul") throw new InputError("Invalid poll timezone");
            return {
              startDate: date(poll.startDate),
              endDate: date(poll.endDate),
              dayStart: string(poll.dayStart),
              dayEnd: string(poll.dayEnd),
              stepMinutes,
              timezone: poll.timezone,
            };
          })(),
    series:
      input.series === undefined || input.series === null
        ? null
        : (() => {
            const series = object(input.series);
            const recurrenceEveryWeeks = integer(series.recurrenceEveryWeeks, "series cadence");
            const occurrenceCount = integer(series.occurrenceCount, "series count");
            if (
              ![1, 2].includes(recurrenceEveryWeeks) ||
              occurrenceCount < 2 ||
              occurrenceCount > 24
            )
              throw new InputError("Invalid event series");
            return {
              recurrenceEveryWeeks: recurrenceEveryWeeks as 1 | 2,
              occurrenceCount,
              occurrences: list(series.occurrences).map((value) => {
                const occurrence = object(value);
                const status = string(occurrence.status);
                if (!["scheduled", "completed", "cancelled"].includes(status))
                  throw new InputError("Invalid event occurrence");
                return {
                  number: integer(occurrence.number, "occurrence number"),
                  startsAt: string(occurrence.startsAt),
                  status: status as "scheduled" | "completed" | "cancelled",
                };
              }),
            };
          })(),
  };
}

function communityMaintainer(value: Json): CommunityMaintainer | null {
  if (value === null) return null;
  const input = object(value);
  const state = string(input.state);
  const revision = input.revision;
  if (
    !["active", "inactive", "revoked"].includes(state) ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision)
  )
    throw new InputError("Invalid maintainer");
  return {
    teamId: string(input.teamId),
    userId: string(input.userId),
    state: state as CommunityMaintainer["state"],
    revision,
    changed: input.changed === true,
  };
}

function communityChapter(value: Json): CommunityChapter | null {
  if (value === null) return null;
  const input = object(value);
  const state = string(input.state);
  const revision = input.revision;
  const channelId = input.channelId;
  if (
    !["creating", "active", "failed", "archived"].includes(state) ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    (channelId !== null && (typeof channelId !== "string" || !/^C[A-Z0-9]+$/.test(channelId)))
  )
    throw new InputError("Invalid chapter");
  return {
    teamId: string(input.teamId),
    slug: string(input.slug),
    channelId: channelId as string | null,
    title: string(input.title),
    description: string(input.description),
    createdBy: string(input.createdBy),
    state: state as CommunityChapter["state"],
    revision,
    changed: input.changed === true,
    announcementMessageTs:
      input.announcementMessageTs === null ? null : string(input.announcementMessageTs),
    guideSynced: input.guideSynced === true,
  };
}

export class CommunityStore extends CommunityScheduleStore {
  private chapterCall(operation: string, payload: Json): Promise<Json> {
    return this.db.queryJson("SELECT otl.community_chapter_execute($1,$2::jsonb)", [
      operation,
      JSON.stringify(payload),
    ]);
  }
  async requestCommunityChapter(input: {
    readonly teamId: string;
    readonly actorId: string;
    readonly slug: string;
    readonly title: string;
    readonly description: string;
  }): Promise<CommunityChapter> {
    const result = communityChapter(await this.chapterCall("request", input));
    if (!result) throw new InputError("Chapter missing");
    return result;
  }
  async activateCommunityChapter(input: {
    readonly teamId: string;
    readonly actorId: string;
    readonly slug: string;
    readonly channelId: string;
  }): Promise<CommunityChapter> {
    const result = communityChapter(await this.chapterCall("activate", input));
    if (!result) throw new InputError("Chapter missing");
    return result;
  }
  async markCommunityChapterAnnouncement(input: {
    readonly teamId: string;
    readonly slug: string;
    readonly channelId: string;
    readonly messageTs: string;
  }): Promise<CommunityChapter> {
    const result = communityChapter(await this.chapterCall("mark_announcement", input));
    if (!result) throw new InputError("Chapter missing");
    return result;
  }
  async markCommunityChapterGuide(input: {
    readonly teamId: string;
    readonly slug: string;
    readonly channelId: string;
  }): Promise<CommunityChapter> {
    const result = communityChapter(await this.chapterCall("mark_guide", input));
    if (!result) throw new InputError("Chapter missing");
    return result;
  }
  async communityChapterActive(teamId: string, channelId: string): Promise<boolean> {
    return (await this.chapterCall("active", { teamId, channelId })) === true;
  }
  async listCommunityChapters(teamId: string): Promise<readonly CommunityChapter[]> {
    return list(
      await this.db.queryJson("SELECT otl.community_chapter_list($1::jsonb)", [
        JSON.stringify({ teamId }),
      ]),
    ).map((value) => {
      const result = communityChapter(value as Json);
      if (!result) throw new InputError("Chapter missing");
      return result;
    });
  }
  private maintainerCall(operation: string, payload: Json): Promise<Json> {
    return this.db.queryJson("SELECT otl.community_maintainer_execute($1,$2::jsonb)", [
      operation,
      JSON.stringify(payload),
    ]);
  }
  async activateMaintainer(teamId: string, actorId: string): Promise<CommunityMaintainer> {
    const maintainer = communityMaintainer(
      await this.maintainerCall("activate", { teamId, actorId }),
    );
    if (!maintainer) throw new InputError("Maintainer missing");
    return maintainer;
  }
  async maintainerStatus(teamId: string, actorId: string): Promise<CommunityMaintainer | null> {
    return communityMaintainer(await this.maintainerCall("status", { teamId, actorId }));
  }
  async deactivateMaintainer(teamId: string, actorId: string): Promise<boolean> {
    return bool(await this.maintainerCall("deactivate", { teamId, actorId }));
  }
  private townhallEventCall(operation: string, payload: Json): Promise<Json> {
    return this.db.queryJson("SELECT otl.townhall_event_execute($1,$2::jsonb)", [
      operation,
      JSON.stringify(payload),
    ]);
  }
  async createTownhallEvent(input: {
    readonly teamId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly eventId: string;
    readonly activity: string;
    readonly location: string;
    readonly options: readonly string[];
  }): Promise<{ readonly created: boolean; readonly event: TownhallEvent }> {
    const value = object(await this.townhallEventCall("create", input));
    const event = townhallEvent(value.event as Json);
    if (!event || typeof value.created !== "boolean") throw new InputError("Event missing");
    return { created: value.created, event };
  }
  async getTownhallEvent(input: {
    readonly teamId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly eventId: string;
  }): Promise<TownhallEvent | null> {
    return this.townhallEventSeries("get", input);
  }
  async getTownhallEventByMessage(
    teamId: string,
    channelId: string,
    actorId: string,
    messageTs: string,
  ): Promise<TownhallEvent | null> {
    return townhallEvent(
      await this.db.queryJson(
        `SELECT coalesce((SELECT otl.townhall_event_json(e,$3) FROM otl.townhall_events e
          WHERE e.team_id=$1 AND e.channel_id=$2 AND e.message_ts=$4),'null'::jsonb)`,
        [teamId, channelId, actorId, messageTs],
      ),
    );
  }
  async bindTownhallEvent(input: {
    readonly teamId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly eventId: string;
    readonly messageTs: string;
  }): Promise<boolean> {
    return bool(await this.townhallEventCall("bind", input));
  }
  async abortTownhallEvent(input: {
    readonly teamId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly eventId: string;
  }): Promise<boolean> {
    return bool(await this.townhallEventCall("abort", input));
  }
  async editTownhallEvent(input: {
    readonly teamId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly eventId: string;
    readonly expectedRevision: number;
    readonly activity: string;
    readonly location: string;
    readonly options: readonly string[];
  }): Promise<TownhallEvent> {
    await this.townhallEventCall("edit", input);
    const event = await this.townhallEventSeries("get", input);
    if (!event) throw new InputError("Event missing");
    return event;
  }
  async voteTownhallEvent(input: {
    readonly teamId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly eventId: string;
    readonly selected: readonly string[];
  }): Promise<TownhallEvent> {
    await this.townhallEventCall("vote", input);
    const event = await this.townhallEventSeries("get", input);
    if (!event) throw new InputError("Event missing");
    return event;
  }
  async configureTownhallEventPoll(input: {
    readonly teamId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly eventId: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly dayStart: string;
    readonly dayEnd: string;
    readonly stepMinutes: 30 | 60;
  }): Promise<TownhallEvent> {
    const event = townhallEvent(
      await this.db.queryJson("SELECT otl.townhall_event_web_execute($1,$2::jsonb)", [
        "configure",
        JSON.stringify(input),
      ]),
    );
    if (!event) throw new InputError("Event missing");
    return event;
  }
  async voteTownhallEventWeb(input: {
    readonly teamId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly eventId: string;
    readonly selected: readonly string[];
  }): Promise<TownhallEvent> {
    await this.db.queryJson("SELECT otl.townhall_event_web_execute($1,$2::jsonb)", [
      "vote",
      JSON.stringify(input),
    ]);
    const event = await this.townhallEventSeries("get", input);
    if (!event) throw new InputError("Event missing");
    return event;
  }
  async townhallEventLifecycle(
    operation: "interest" | "rsvp" | "configure" | "finalize",
    input: Json,
  ): Promise<TownhallEvent> {
    await this.db.queryJson("SELECT otl.townhall_event_lifecycle_execute($1,$2::jsonb)", [
      operation,
      JSON.stringify(input),
    ]);
    const event = await this.townhallEventSeries("get", input);
    if (!event) throw new InputError("Event missing");
    return event;
  }
  async townhallEventSeries(
    operation: "get" | "configure" | "finalize",
    input: Json,
  ): Promise<TownhallEvent | null> {
    return townhallEvent(
      await this.db.queryJson("SELECT otl.townhall_event_series_execute($1,$2::jsonb)", [
        operation,
        JSON.stringify(input),
      ]),
    );
  }
  async townhallEventFollowup(operation: "get" | "put", input: Json): Promise<Json> {
    return this.db.queryJson("SELECT otl.townhall_event_followup_execute($1,$2::jsonb)", [
      operation,
      JSON.stringify(input),
    ]);
  }
  async dueTownhallEvents(
    teamId: string,
    channelId: string,
    actorId: string,
    now: string,
  ): Promise<readonly TownhallEvent[]> {
    const changed = list(
      await this.db.queryJson("SELECT otl.townhall_event_lifecycle_execute($1,$2::jsonb)", [
        "due",
        JSON.stringify({ teamId, channelId, actorId, now }),
      ]),
    ).map((value) => {
      const event = townhallEvent(value as Json);
      if (!event) throw new InputError("Event missing");
      return event;
    });
    return Promise.all(
      changed.map(
        async (event) =>
          (await this.townhallEventSeries("get", {
            teamId,
            channelId,
            actorId,
            eventId: event.eventId,
          })) ?? event,
      ),
    );
  }
  private introductionCall(operation: string, payload: Json): Promise<Json> {
    return this.db.queryJson("SELECT otl.introduction_execute($1,$2::jsonb)", [
      operation,
      JSON.stringify(payload),
    ]);
  }
  async day(input: DayScope): Promise<CommunityDay> {
    date(input.date);
    return day(await this.call("day", input));
  }
  async listDays(
    teamId: string,
    channelId: string,
    forDate: string,
  ): Promise<readonly CommunityDay[]> {
    date(forDate);
    return list(await this.call("list_days", { teamId, channelId, date: forDate })).map(day);
  }
  async members(teamId: string, channelId: string): Promise<readonly string[]> {
    return list(await this.call("members", { teamId, channelId })).map(string);
  }
  async lifecycleEligibility(input: CommunityScope): Promise<{
    readonly state: "active" | "grace" | "dormant";
    readonly revision: number | null;
  }> {
    const value = object(await this.call("lifecycle_eligibility", input));
    const state = string(value.state);
    if (state !== "active" && state !== "grace" && state !== "dormant")
      throw new InputError("Invalid lifecycle eligibility");
    const revision = value.revision;
    if (
      revision !== null &&
      (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
    )
      throw new InputError("Invalid lifecycle revision");
    return { state, revision };
  }
  async history(input: CommunityScope): Promise<readonly CommunityDay[]> {
    return list(await this.call("history", input)).map(day);
  }
  async seasonHistory(input: CommunityScope, seasonId?: number): Promise<GardenSeason | null> {
    if (seasonId !== undefined && (!Number.isSafeInteger(seasonId) || seasonId < 1))
      throw new InputError("Invalid garden season");
    return gardenSeason(
      await this.db.queryJson(
        `SELECT coalesce((SELECT jsonb_build_object(
          'seasonId',s.season_id,'openedOn',s.opened_on,'closedOn',s.closed_on,
          'days',coalesce((SELECT jsonb_agg(otl.community_day_json(d) ORDER BY d.day)
            FROM otl.community_days d WHERE d.team_id=s.team_id AND d.channel_id=s.channel_id
              AND d.user_id=s.user_id AND d.day>=s.opened_on
              AND (s.closed_on IS NULL OR d.day<=s.closed_on)),'[]'::jsonb))
          FROM otl.grass_seasons s WHERE s.team_id=$1 AND s.channel_id=$2 AND s.user_id=$3
            AND (nullif($4,'') IS NULL OR s.season_id=nullif($4,'')::bigint)
            AND (nullif($4,'') IS NOT NULL OR s.closed_at IS NULL)
          ORDER BY s.season_id DESC LIMIT 1),'null'::jsonb)`,
        [
          input.teamId,
          input.channelId,
          input.userId,
          seasonId === undefined ? "" : String(seasonId),
        ],
      ),
    );
  }
  async listRecords(input: CommunityScope, kind: string): Promise<readonly CommunityRecord[]> {
    const values = await this.call("list_records", { ...input, kind });
    if (!Array.isArray(values)) throw new InputError("Record list required");
    return values.map((value: Json) => {
      const result = parseCommunityRecord(value);
      if (!result) throw new InputError("Record missing");
      return result;
    });
  }
  async introduction(teamId: string, userId: string): Promise<MemberIntroduction | null> {
    return introduction(await this.introductionCall("get", { teamId, userId }));
  }
  async introductionNameInput(teamId: string, userId: string): Promise<string | null> {
    const value = await this.introductionCall("name_input", { teamId, userId });
    return value === null ? null : string(value);
  }
  async introductions(teamId: string): Promise<readonly MemberIntroduction[]> {
    return list(await this.introductionCall("list", { teamId })).map((value) => {
      const result = introduction(value);
      if (!result) throw new InputError("Introduction missing");
      return result;
    });
  }
  async prepareIntroduction(input: {
    readonly teamId: string;
    readonly userId: string;
    readonly confirmedName: string;
    readonly intro: string;
    readonly linkedin: string | null;
    readonly details: string | null;
    readonly expectedRevision: number;
    readonly token: string;
  }): Promise<MemberIntroduction | null> {
    return introduction(await this.introductionCall("prepare", input));
  }
  async finishIntroduction(input: {
    readonly teamId: string;
    readonly userId: string;
    readonly token: string;
    readonly channelId: string;
    readonly messageTs: string;
  }): Promise<MemberIntroduction | null> {
    return introduction(await this.introductionCall("finish", input));
  }
  async abortIntroduction(teamId: string, userId: string, token: string): Promise<boolean> {
    return bool(await this.introductionCall("abort", { teamId, userId, token }));
  }
  async change(input: DayChange): Promise<ChangeResult> {
    date(input.date);
    if (input.action === "goal" && (!input.text?.trim() || [...input.text].length > 200))
      throw new InputError("ONE THING은 1~200자로 적어 주세요.");
    if (input.action === "reflection" && (!input.text?.trim() || [...input.text].length > 2000))
      throw new InputError("후기는 1~2000자로 적어 주세요.");
    const { delivery, reviewThreadV2, ...change } = input;
    const v = object(await this.call("change", change));
    let returnTransition: ChangeResult["returnTransition"];
    if (v.returnTransition !== undefined) {
      const transition = object(v.returnTransition);
      if (transition.kind !== "welcome_back") throw new InputError("Invalid return transition");
      const lifecycleRevision = transition.lifecycleRevision;
      const seasonId = transition.seasonId;
      if (
        typeof lifecycleRevision !== "number" ||
        typeof seasonId !== "number" ||
        !Number.isSafeInteger(lifecycleRevision) ||
        !Number.isSafeInteger(seasonId)
      )
        throw new InputError("Invalid return transition revision");
      returnTransition = {
        kind: "welcome_back",
        lifecycleRevision,
        seasonId,
        effectKey: string(transition.effectKey),
      };
    }
    const result: ChangeResult = {
      day: day(v.day),
      changed: bool(v.changed),
      conflict: bool(v.conflict),
      firstGoal: bool(v.firstGoal),
      firstRegistration: v.firstRegistration === true,
      firstReflection: bool(v.firstReflection),
      undoKey: string(v.undoKey),
      ...(returnTransition ? { returnTransition } : {}),
    };
    if (result.conflict || delivery === undefined || reviewThreadV2 !== true) return result;
    const routeReplay =
      !result.changed &&
      ["goal", "complete", "progress", "partial", "not_done", "reflection"].includes(change.action);
    if (!result.changed && !routeReplay) return result;
    const season = await this.seasonHistory(input);
    if (!season || result.day.date < season.openedOn) return result;
    if (
      change.action !== "goal" &&
      result.day.outcome === "pending" &&
      result.day.reflection === ""
    )
      return result;
    const route =
      change.action === "goal" ? "route_member_goal_garden" : "route_member_review_garden";
    const routed = await this.db.queryJson(`SELECT otl.${route}($1::jsonb)`, [
      JSON.stringify({
        teamId: input.teamId,
        channelId: input.channelId,
        userId: input.userId,
        date: result.day.date,
        sourceTs: delivery.source,
        threadTs: delivery.thread,
      }),
    ]);
    if (routed === null) return result;
    return { ...result, gardenDeliveryKey: string(object(routed).deliveryKey) };
  }
}
