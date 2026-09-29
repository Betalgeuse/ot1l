import { COMMUNITY_SCHEDULE_CLOCK_ROLE } from "./community-bug-clock-client";
import { nextCommunityAlarm } from "./community-clock-client";
import { nextGardenDue, nextMembershipDue } from "./community-membership-due";
import type { CommunityEnv } from "./community-runtime";
import { InputError } from "./input";
import { NeonStore } from "./store";

export async function refreshCommunityQueueClock(
  env: CommunityEnv,
  storage: DurableObjectStorage,
  channelId: string,
): Promise<{ readonly next: number | null }> {
  if (env.DATABASE_MAINTENANCE === "true") throw new InputError("Database maintenance");
  if (
    ![env.COMMUNITY_CHANNEL_ID, env.COMMUNITY_PUBLIC_CHANNEL_ID].includes(channelId) ||
    !channelId
  )
    throw new InputError("Channel is outside clock scope");
  const [role, previousChannel] = await Promise.all([
    storage.get<string>("role"),
    storage.get<string>("channel"),
  ]);
  if (role && role !== COMMUNITY_SCHEDULE_CLOCK_ROLE)
    throw new InputError("Clock role cannot change");
  if (previousChannel && previousChannel !== channelId)
    throw new InputError("Clock channel cannot change");
  await storage.put("role", COMMUNITY_SCHEDULE_CLOCK_ROLE);
  await storage.put("channel", channelId);
  if (env.COMMUNITY_ENABLED !== "true" || !env.COMMUNITY_ADMIN_ID) {
    await storage.deleteAlarm();
    return { next: null };
  }
  const scope = {
    teamId: env.SLACK_TEAM_ID,
    channelId,
    userId: env.COMMUNITY_ADMIN_ID,
  };
  const observedNow = Date.now();
  const [gardenDue, membershipDue] = await Promise.all([
    nextGardenDue(
      new NeonStore(env.DATABASE_URL),
      scope.teamId,
      channelId,
      env.GARDEN_RECONCILIATION === "true",
    ),
    nextMembershipDue(env, new NeonStore(env.DATABASE_URL), channelId),
  ]);
  const next = nextCommunityAlarm(
    [],
    [
      gardenDue === null ? null : new Date(gardenDue).toISOString(),
      membershipDue === null ? null : new Date(membershipDue).toISOString(),
    ]
      .filter((value): value is string => value !== null)
      .sort()[0] ?? null,
    observedNow,
  );
  if (next === null) await storage.deleteAlarm();
  else {
    const alarmAt = Math.max(observedNow + 1_000, next);
    const previous = await storage.getAlarm();
    await storage.setAlarm(
      previous !== null && previous > observedNow ? Math.min(previous, alarmAt) : alarmAt,
    );
  }
  return { next: await storage.getAlarm() };
}
