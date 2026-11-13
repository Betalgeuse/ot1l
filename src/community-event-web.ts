import { z } from "zod";
import { readEventScheduleToken } from "./community-event-link";
import { authenticateReferralServiceRequest } from "./community-referral-service-auth";
import { CommunityReferralStore } from "./community-referral-store";
import type { CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { CommunityStore } from "./community-store";
import {
  postEventThreadStatus,
  scheduleEventReviewPrompt,
  syncTownhallEventMessage,
} from "./community-townhall-events";
import type { TownhallEvent } from "./community-types";
import { InputError, object, string } from "./input";
import { NeonStore } from "./store";

const base = z.object({ token: z.string().min(20).max(2000) }).strict();
const configure = base
  .extend({
    startDate: z.string().date(),
    endDate: z.string().date(),
    dayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    dayEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    stepMinutes: z.union([z.literal(30), z.literal(60)]),
    eventKind: z.enum(["gathering", "challenge", "series"]),
    minConfirmed: z.number().int().min(1).max(100),
    capacity: z.number().int().min(1).max(500).nullable(),
    recruitmentDeadline: z.string().datetime({ offset: true }).nullable(),
    graceHours: z.number().int().min(1).max(168),
    autoCancel: z.boolean(),
    recurrenceEveryWeeks: z.union([z.literal(1), z.literal(2)]),
    occurrenceCount: z.number().int().min(2).max(24),
    durationMinutes: z
      .number()
      .int()
      .min(30)
      .max(720)
      .refine((value) => value % 30 === 0),
  })
  .strict();
const vote = base.extend({ selected: z.array(z.string().datetime()).max(336) }).strict();
const finalize = base.extend({ startsAt: z.string().datetime() }).strict();

async function eventForWeb(env: CommunityEnv, event: TownhallEvent): Promise<object> {
  const going = event.participants
    .filter((participant) => participant.state === "going")
    .slice(0, 50);
  const participantProfiles = await Promise.all(
    going.map(async (participant) => {
      try {
        const response = object(
          await callSlack(env.SLACK_BOT_TOKEN, "users.info", { user: participant.userId }),
        );
        const user = object(response.user);
        const profile = object(user.profile);
        return {
          userId: participant.userId,
          name: string(
            profile.display_name || profile.real_name || user.real_name || participant.userId,
          ),
        };
      } catch {
        return { userId: participant.userId, name: participant.userId };
      }
    }),
  );
  return { ...event, participantProfiles };
}

export async function handleEventWebRequest(
  request: Request,
  env: CommunityEnv,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (
    request.method !== "POST" ||
    ![
      "/internal/events/state",
      "/internal/events/configure",
      "/internal/events/vote",
      "/internal/events/finalize",
    ].includes(path)
  )
    return new Response("Not found", { status: 404 });
  if (!env.EVENT_CORE_HMAC_SECRET || !env.EVENT_SIGNING_SECRET)
    return Response.json({ error: "unavailable" }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? "0") > 32_768)
    return new Response("Request too large", { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 32_768)
    return new Response("Request too large", { status: 413 });
  const nonceStore = new CommunityReferralStore(new NeonStore(env.DATABASE_URL), {
    teamId: env.SLACK_TEAM_ID,
    channelId: env.COMMUNITY_PUBLIC_CHANNEL_ID ?? "event-web",
    userId: env.COMMUNITY_ADMIN_ID ?? "event-web",
  });
  if (
    !(await authenticateReferralServiceRequest({
      request,
      body,
      secret: env.EVENT_CORE_HMAC_SECRET,
      store: nonceStore,
      persistNonce: true,
    }))
  )
    return new Response("Unauthorized", { status: 401 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ error: "invalid_request" }, { status: 400 });
    throw error;
  }
  const input = path.endsWith("/configure")
    ? configure.safeParse(parsed)
    : path.endsWith("/vote")
      ? vote.safeParse(parsed)
      : path.endsWith("/finalize")
        ? finalize.safeParse(parsed)
        : base.safeParse(parsed);
  if (!input.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const identity = await readEventScheduleToken(input.data.token, env.EVENT_SIGNING_SECRET);
    if (
      identity.teamId !== env.SLACK_TEAM_ID ||
      identity.channelId !== env.COMMUNITY_RELEASE_CHANNEL_ID
    )
      throw new InputError("이벤트 링크 범위가 다릅니다.");
    const store = new CommunityStore(new NeonStore(env.DATABASE_URL));
    if (path.endsWith("/configure")) {
      const value = configure.parse(input.data);
      await store.configureTownhallEventPoll({
        ...identity,
        actorId: identity.userId,
        startDate: value.startDate,
        endDate: value.endDate,
        dayStart: value.dayStart,
        dayEnd: value.dayEnd,
        stepMinutes: value.stepMinutes,
      });
      await store.townhallEventLifecycle("configure", {
        ...identity,
        actorId: identity.userId,
        eventKind: value.eventKind,
        minConfirmed: value.minConfirmed,
        capacity: value.capacity,
        recruitmentDeadline: value.recruitmentDeadline,
        graceHours: value.graceHours,
        autoCancel: value.autoCancel,
        now: new Date().toISOString(),
      });
      const event = await store.townhallEventSeries("configure", {
        ...identity,
        actorId: identity.userId,
        recurrenceEveryWeeks: value.recurrenceEveryWeeks,
        occurrenceCount: value.occurrenceCount,
        durationMinutes: value.durationMinutes,
      });
      if (!event) throw new InputError("이벤트를 찾을 수 없습니다.");
      await syncTownhallEventMessage(env, event);
      return Response.json({ event: await eventForWeb(env, event) });
    }
    if (path.endsWith("/vote")) {
      const value = vote.parse(input.data);
      const event = await store.voteTownhallEventWeb({
        ...identity,
        actorId: identity.userId,
        selected: value.selected,
      });
      await syncTownhallEventMessage(env, event);
      return Response.json({ event: await eventForWeb(env, event) });
    }
    if (path.endsWith("/finalize")) {
      const value = finalize.parse(input.data);
      await store.townhallEventLifecycle("finalize", {
        ...identity,
        actorId: identity.userId,
        startsAt: value.startsAt,
        now: new Date().toISOString(),
      });
      const event = await store.townhallEventSeries("finalize", {
        ...identity,
        actorId: identity.userId,
      });
      if (!event) throw new InputError("이벤트를 찾을 수 없습니다.");
      await syncTownhallEventMessage(env, event);
      await postEventThreadStatus(
        env,
        event,
        "일정이 확정됐어요. 선택한 시간과 일치한 회원은 자동 참가됐습니다.",
      );
      await scheduleEventReviewPrompt(env, store, event, identity.userId);
      return Response.json({ event: await eventForWeb(env, event) });
    }
    const event = await store.getTownhallEvent({ ...identity, actorId: identity.userId });
    return event
      ? Response.json({ event: await eventForWeb(env, event) })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    if (error instanceof InputError)
      return Response.json({ error: "invalid_request" }, { status: 400 });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
