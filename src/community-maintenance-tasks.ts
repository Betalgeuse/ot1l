import { sendAgentNotifications } from "./community-agent-notifications";
import { armBugDeliveryClock } from "./community-bug-clock-client";
import { runDailyChallenges } from "./community-challenges";
import { reconcileCommunityChapters } from "./community-chapters";
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
import { InputError } from "./input";
import { NeonStore } from "./store";

export const TEAM_MAINTENANCE_TASKS = [
  "clock_recovery",
  "po_membership",
  "feedback",
  "events",
  "pr_metadata",
  "agent_notifications",
  "share_info",
  "chapter_dev",
  "chapter_math",
] as const;
export const CHANNEL_MAINTENANCE_TASKS = ["garden", "membership", "prompts"] as const;

export const MAINTENANCE_CADENCE_MINUTES: Readonly<Record<string, number>> = {
  clock_recovery: 5,
  po_membership: 30,
  feedback: 30,
  events: 5,
  pr_metadata: 30,
  agent_notifications: 30,
  share_info: 30,
  chapter_dev: 5,
  chapter_math: 5,
  garden: 30,
  membership: 30,
  prompts: 5,
};

export function maintenanceCadenceDue(task: string, at: number): boolean {
  const cadence = MAINTENANCE_CADENCE_MINUTES[task];
  if (!cadence) throw new InputError("Invalid maintenance task scope");
  const minute = new Date(at).getUTCMinutes();
  return cadence === 30 ? minute === 1 || minute === 31 : minute % cadence === 1 % cadence;
}

export function validateMaintenanceTask(
  env: CommunityEnv,
  task: string,
  at: number,
  channel?: string,
): void {
  const teamTask = TEAM_MAINTENANCE_TASKS.some((t) => t === task);
  const channelTask = CHANNEL_MAINTENANCE_TASKS.some((t) => t === task);
  if (
    !Number.isFinite(at) ||
    (!teamTask && !channelTask) ||
    (teamTask && channel !== undefined) ||
    (channelTask &&
      (!channel || ![env.COMMUNITY_PUBLIC_CHANNEL_ID, env.COMMUNITY_CHANNEL_ID].includes(channel)))
  )
    throw new InputError("Invalid maintenance task scope");
}

// Each call owns one bounded RPC invocation. Never concatenate these handlers
// inside a shared external-request budget. Cron remains the only trigger owner.
export async function runMaintenanceTask(
  env: CommunityEnv,
  task: string,
  at: number,
  channel?: string,
): Promise<void> {
  validateMaintenanceTask(env, task, at, channel);
  if (task !== "clock_recovery" && !maintenanceCadenceDue(task, at)) return;
  if (task === "clock_recovery") {
    let failed = false;
    try {
      await armBugDeliveryClock(env, { reason: "cron", observedAt: at });
    } catch {
      failed = true;
    }
    if (failed) throw new Error("Clock recovery failed; independent clocks continued");
    return;
  }
  if (
    env.COMMUNITY_ENABLED !== "true" ||
    env.DATABASE_MAINTENANCE === "true" ||
    !env.COMMUNITY_ADMIN_ID
  )
    return;
  const store = new CommunityStore(new NeonStore(env.DATABASE_URL));
  switch (task) {
    case "po_membership":
      if (poMembershipChannels(env).length) await reconcilePoMembership(env);
      return;
    case "feedback":
      await reconcileNativeFeedback(env);
      return;
    case "events":
      await runTownhallEventDue({ env, store }, new Date(at).toISOString());
      return;
    case "pr_metadata":
      if (env.BUG_RUNNER_ENABLED === "true") await syncPrMetadataResults(env);
      return;
    case "agent_notifications":
      if (env.BUG_RUNNER_ENABLED === "true") await sendAgentNotifications(env, new Date(at));
      return;
    case "share_info":
      await reconcileCommunityChapters(env, store);
      await reconcileShareInfoChannels(env, at, store);
      return;
    case "chapter_dev":
    case "chapter_math": {
      const delivered = await runDailyChallenges(
        env,
        store,
        new Date(at),
        task === "chapter_dev" ? "dev" : "math",
      );
      console.log(JSON.stringify({ event: "community.chapter.delivery", task, delivered }));
      return;
    }
    case "garden":
      if (channel) await runDueGardenDeliveries(env, channel, at);
      return;
    case "membership": {
      if (!channel) return;
      const result = await runMembershipDue(env, new NeonStore(env.DATABASE_URL), channel, at);
      if ((result.possiblyMore || result.nextCursor) && channel === env.COMMUNITY_PUBLIC_CHANNEL_ID)
        await env.COMMUNITY_CLOCK?.getByName(`${env.SLACK_TEAM_ID}:${channel}`).armMembershipScan(
          channel,
          result.nextCursor,
        );
      return;
    }
    case "prompts":
      if (!channel) return;
      await runCommunityPrompts(
        { ...env, COMMUNITY_CHANNEL_ID: channel, COMMUNITY_ADMIN_ID: env.COMMUNITY_ADMIN_ID },
        store,
        new Date(at),
      );
      if (channel === env.COMMUNITY_PUBLIC_CHANNEL_ID && Math.floor(at / 60_000) % 60 === 1) {
        const snapshot = await collectCurrentChannelMembers(
          env.SLACK_BOT_TOKEN,
          channel,
          env.COMMUNITY_BOT_USER_ID ?? "",
          new Date(at).toISOString(),
        );
        await store.reconcileChannelMembers(
          { teamId: env.SLACK_TEAM_ID, channelId: channel, userId: env.COMMUNITY_ADMIN_ID },
          snapshot,
        );
      }
      return;
  }
}
