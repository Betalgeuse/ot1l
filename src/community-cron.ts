import { sendAgentNotifications } from "./community-agent-notifications";
import { armBugDeliveryClock } from "./community-bug-clock-client";
import { runDailyChallenges } from "./community-challenges";
import { reconcileCommunityChapters } from "./community-chapters";
import { armCommunityClock } from "./community-clock-client";
import { reconcileNativeFeedback } from "./community-feedback";
import { runDueGardenDeliveries } from "./community-garden-delivery";
import { collectCurrentChannelMembers } from "./community-membership";
import { runMembershipDue } from "./community-membership-schedule";
import { poMembershipChannels, reconcilePoMembership } from "./community-po-membership";
import { syncPrMetadataResults } from "./community-pr-metadata";
import type { CommunityEnv } from "./community-runtime";
import { runCommunityPrompts } from "./community-scheduler";
import { reconcileShareInfoChannels } from "./community-share-info-reconcile";
import { CommunityStore } from "./community-store";
import { runTownhallEventDue } from "./community-townhall-events";
import { runtimeFailureCode } from "./runtime-failure";
import { NeonStore } from "./store";

// Different scheduled invocations have separate CPU budgets. try/catch or
// Promise.all inside the maintenance invocation cannot survive exceededCpu.
export const SCRUM_CRONS = ["0 1 * * *", "0 9 * * *", "*/5 * * * *"] as const;
export const MAINTENANCE_CRON = "1-59/5 * * * *";

export async function communityCron(
  env: CommunityEnv,
  scheduledTime: number,
  cron = "*/5 * * * *",
): Promise<void> {
  if (cron === MAINTENANCE_CRON) {
    if (!env.COMMUNITY_CLOCK) throw new Error("Scheduled work binding missing");
    await env.COMMUNITY_CLOCK.getByName(`maintenance:${env.SLACK_TEAM_ID}`).runMaintenance(
      scheduledTime,
    );
    return;
  }
  if (env.COMMUNITY_ENABLED !== "true" || env.DATABASE_MAINTENANCE === "true") return;
  if (!env.COMMUNITY_ADMIN_ID) return;
  if (SCRUM_CRONS.some((value) => value === cron)) {
    // Public daily scrum comes first, including when a private channel fails.
    const channels = new Set([env.COMMUNITY_PUBLIC_CHANNEL_ID, env.COMMUNITY_CHANNEL_ID]);
    let failed = false;
    for (const channel of channels) {
      if (!channel) continue;
      console.log(JSON.stringify({ event: "community.scrum.start", scheduledTime, cron, channel }));
      try {
        if (!env.COMMUNITY_CLOCK) throw new Error("Scrum binding missing");
        const result = await env.COMMUNITY_CLOCK.getByName(
          `scrum:${env.SLACK_TEAM_ID}:${channel}`,
        ).runScrum(channel, scheduledTime);
        console.log(
          JSON.stringify({ event: "community.scrum.end", scheduledTime, cron, channel, ...result }),
        );
      } catch (error) {
        failed = true;
        console.error(
          JSON.stringify({
            event: "community.scrum.failed",
            scheduledTime,
            cron,
            channel,
            errorType: error instanceof Error ? error.name : "Unknown",
          }),
        );
      }
    }
    if (failed) throw new Error("Daily scrum dispatch failed");
    return;
  }
  throw new Error("Unknown community cron");
}

export async function communityMaintenanceCron(
  env: CommunityEnv,
  scheduledTime: number,
): Promise<void> {
  const stage = (queue: string) =>
    console.log(JSON.stringify({ event: "community.maintenance.stage", queue, scheduledTime }));
  stage("bug_clock");
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
  stage("community_clock_backup");
  // The scheduled maintenance invocation restores missing queue alarms after
  // platform cancellation, even when no new Slack event or cursor is present.
  for (const channel of new Set([env.COMMUNITY_PUBLIC_CHANNEL_ID, env.COMMUNITY_CHANNEL_ID])) {
    if (!channel) continue;
    try {
      await armCommunityClock(env, channel);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "community.clock.backup.failed",
          errorType: error instanceof Error ? error.name : "Unknown",
          code: runtimeFailureCode(error),
        }),
      );
    }
  }
  stage("po_membership");
  if (poMembershipChannels(env).length)
    try {
      await reconcilePoMembership(env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "community.po.membership_reconcile_failed",
          errorType: error instanceof Error ? error.name : "Unknown",
        }),
      );
    }
  stage("feedback");
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
  stage("events");
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
  stage("pr_metadata");
  if (env.BUG_RUNNER_ENABLED === "true")
    try {
      await syncPrMetadataResults(env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "community.cron.queue.failed",
          queue: "pr_metadata",
          errorType: error instanceof Error ? error.name : "Unknown",
        }),
      );
    }
  stage("agent_notifications");
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
  stage("share_info");
  if (Math.floor(scheduledTime / 60_000) % 15 === 1)
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
  stage("chapter_challenges");
  // Maintenance-only: no challenge failure can consume the scrum invocation.
  try {
    await runDailyChallenges(
      env,
      new CommunityStore(new NeonStore(env.DATABASE_URL)),
      new Date(scheduledTime),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "community.cron.queue.failed",
        queue: "chapter_challenges",
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
  }
  const channels = [env.COMMUNITY_CHANNEL_ID, env.COMMUNITY_PUBLIC_CHANNEL_ID].filter(
    (v): v is string => Boolean(v),
  );
  for (const channel of new Set(channels)) {
    stage("garden");
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
    stage("membership");
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
    stage("prompts");
    try {
      const scheduleStore = new CommunityStore(new NeonStore(env.DATABASE_URL));
      await runCommunityPrompts(
        { ...env, COMMUNITY_CHANNEL_ID: channel, COMMUNITY_ADMIN_ID: env.COMMUNITY_ADMIN_ID },
        scheduleStore,
        new Date(scheduledTime),
      );
      if (
        channel === env.COMMUNITY_PUBLIC_CHANNEL_ID &&
        Math.floor(scheduledTime / 60_000) % 60 === 1
      ) {
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
      }),
    );
  }
}
