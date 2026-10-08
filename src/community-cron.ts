import { sendAgentNotifications } from "./community-agent-notifications";
import { armBugDeliveryClock } from "./community-bug-clock-client";
import { reconcileCommunityChapters } from "./community-chapters";
import { reconcileNativeFeedback } from "./community-feedback";
import { runDueGardenDeliveries } from "./community-garden-delivery";
import { collectCurrentChannelMembers } from "./community-membership";
import { runMembershipDue } from "./community-membership-schedule";
import type { CommunityEnv } from "./community-runtime";
import { runCommunitySchedule } from "./community-scheduler";
import { reconcileShareInfoChannels } from "./community-share-info-reconcile";
import { CommunityStore } from "./community-store";
import { runTownhallEventDue } from "./community-townhall-events";
import { NeonStore } from "./store";

export async function communityCron(env: CommunityEnv, scheduledTime: number): Promise<void> {
  try {
    await armBugDeliveryClock(env, { reason: "cron", observedAt: scheduledTime });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "community.bug.clock.arm.failed",
        scheduledTime,
        code: "boundary_failure",
        failure: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
  if (env.COMMUNITY_ENABLED !== "true" || env.DATABASE_MAINTENANCE === "true") return;
  if (!env.COMMUNITY_ADMIN_ID) return;
  try {
    await reconcileNativeFeedback(env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "community.feedback.backfill_failed",
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
  }
  try {
    const eventStore = new CommunityStore(new NeonStore(env.DATABASE_URL));
    const eventTransitions = await runTownhallEventDue(
      { env, store: eventStore },
      new Date(scheduledTime).toISOString(),
    );
    if (eventTransitions > 0)
      console.log(JSON.stringify({ event: "community.events.due", processed: eventTransitions }));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "community.cron.queue.failed",
        queue: "events",
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
  }
  if (env.BUG_RUNNER_ENABLED === "true")
    try {
      const agent = await sendAgentNotifications(env, new Date(scheduledTime));
      if (agent.claimed > 0)
        console.log(JSON.stringify({ event: "community.agent.notifications", ...agent }));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "community.cron.queue.failed",
          queue: "agent_notifications",
          errorType: error instanceof Error ? error.name : "Unknown",
        }),
      );
    }
  if (Math.floor(scheduledTime / 60_000) % 15 === 0)
    try {
      const shareStore = new CommunityStore(new NeonStore(env.DATABASE_URL));
      const chapters = await reconcileCommunityChapters(env, shareStore);
      const processed = await reconcileShareInfoChannels(env, scheduledTime, shareStore);
      console.log(JSON.stringify({ event: "community.share_info.reconcile", processed, chapters }));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "community.cron.queue.failed",
          queue: "share_info",
          errorType: error instanceof Error ? error.name : "Unknown",
        }),
      );
    }
  const channels = [env.COMMUNITY_CHANNEL_ID, env.COMMUNITY_PUBLIC_CHANNEL_ID].filter(
    (v): v is string => Boolean(v),
  );
  for (const channel of new Set(channels)) {
    let garden: { readonly processed: number } = { processed: 0 };
    try {
      garden = await runDueGardenDeliveries(env, channel, scheduledTime);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.error(
        JSON.stringify({
          event: "community.cron.queue.failed",
          queue: "garden",
          errorType: error.name,
        }),
      );
    }
    let membership = {
      possiblyMore: false,
      nextDue: null as number | null,
      nextCursor: null as string | null,
      interestNextCursor: null as string | null,
    };
    try {
      membership = await runMembershipDue(
        env,
        new NeonStore(env.DATABASE_URL),
        channel,
        scheduledTime,
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.error(
        JSON.stringify({
          event: "community.cron.queue.failed",
          queue: "membership",
          errorType: error.name,
        }),
      );
    }
    if (
      (membership.possiblyMore || membership.nextCursor) &&
      env.COMMUNITY_CLOCK &&
      channel === env.COMMUNITY_PUBLIC_CHANNEL_ID
    )
      await env.COMMUNITY_CLOCK.getByName(`${env.SLACK_TEAM_ID}:${channel}`).armMembershipScan(
        channel,
        membership.nextCursor,
      );
    let result: { readonly common: number; readonly personal: number } = { common: 0, personal: 0 };
    try {
      const scheduleStore = new CommunityStore(new NeonStore(env.DATABASE_URL));
      result = await runCommunitySchedule(
        { ...env, COMMUNITY_CHANNEL_ID: channel, COMMUNITY_ADMIN_ID: env.COMMUNITY_ADMIN_ID },
        scheduleStore,
        new Date(scheduledTime),
      );
      if (result.common > 0 && channel === env.COMMUNITY_PUBLIC_CHANNEL_ID) {
        try {
          const snapshot = await collectCurrentChannelMembers(
            env.SLACK_BOT_TOKEN,
            channel,
            env.COMMUNITY_BOT_USER_ID ?? "",
            new Date(scheduledTime).toISOString(),
          );
          await scheduleStore.reconcileChannelMembers(
            { teamId: env.SLACK_TEAM_ID, channelId: channel, userId: env.COMMUNITY_ADMIN_ID },
            snapshot,
          );
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          console.error(
            JSON.stringify({
              event: "community.cron.queue.failed",
              queue: "membership_refresh",
              errorType: error.name,
            }),
          );
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.error(
        JSON.stringify({
          event: "community.cron.queue.failed",
          queue: "reminders",
          errorType: error.name,
        }),
      );
    }
    console.log(
      JSON.stringify({
        event: "community.cron",
        scheduledTime,
        gardenProcessed: garden.processed,
        membershipPossiblyMore: membership.possiblyMore,
        ...result,
      }),
    );
  }
}
