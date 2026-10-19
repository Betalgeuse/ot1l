import { CHANNEL_MAINTENANCE_TASKS, TEAM_MAINTENANCE_TASKS } from "./community-maintenance-tasks";
import type { CommunityEnv } from "./community-runtime";
import { runtimeFailureCode } from "./runtime-failure";

export const SCRUM_CRONS = ["0 1 * * *", "0 9 * * *", "*/5 * * * *"] as const;
export const MAINTENANCE_CRON = "1,31 * * * *";
export const CLOCK_RECOVERY_CRON = "1-59/5 * * * *";
export const NEON_WAKE_WINDOW_BUDGET = 60;

export async function communityCron(
  env: CommunityEnv,
  scheduledTime: number,
  cron = "*/5 * * * *",
): Promise<void> {
  if (cron === CLOCK_RECOVERY_CRON) {
    if (!env.COMMUNITY_CLOCK) throw new Error("Scheduled work binding missing");
    await env.COMMUNITY_CLOCK.getByName(
      `maintenance-task:${env.SLACK_TEAM_ID}:clock_recovery:team`,
    ).runMaintenanceTask("clock_recovery", scheduledTime);
    return;
  }
  if (cron === MAINTENANCE_CRON) {
    if (!env.COMMUNITY_CLOCK) throw new Error("Scheduled work binding missing");
    await env.COMMUNITY_CLOCK.getByName(`maintenance:${env.SLACK_TEAM_ID}`).runMaintenance(
      scheduledTime,
    );
    return;
  }
  if (
    env.COMMUNITY_ENABLED !== "true" ||
    env.DATABASE_MAINTENANCE === "true" ||
    !env.COMMUNITY_ADMIN_ID
  )
    return;
  if (SCRUM_CRONS.some((value) => value === cron)) {
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
            code: runtimeFailureCode(error),
          }),
        );
      }
    }
    if (failed) throw new Error("Daily scrum dispatch failed");
    return;
  }
  throw new Error("Unknown community cron");
}

// The coordinator performs RPC only; each task owns its external request budget.
// Failure in one task cannot suppress the remaining independent tasks.
export async function communityMaintenanceCron(
  env: CommunityEnv,
  scheduledTime: number,
): Promise<void> {
  if (!env.COMMUNITY_CLOCK) throw new Error("Scheduled work binding missing");
  const tasks: { task: string; channel?: string }[] = [{ task: "clock_recovery" }];
  if (
    env.COMMUNITY_ENABLED === "true" &&
    env.DATABASE_MAINTENANCE !== "true" &&
    env.COMMUNITY_ADMIN_ID
  ) {
    tasks.push(
      ...TEAM_MAINTENANCE_TASKS.filter((task) => task !== "clock_recovery").map((task) => ({
        task,
      })),
    );
    for (const channel of new Set([env.COMMUNITY_PUBLIC_CHANNEL_ID, env.COMMUNITY_CHANNEL_ID]))
      if (channel) for (const task of CHANNEL_MAINTENANCE_TASKS) tasks.push({ task, channel });
  }
  let failed = false;
  for (const { task, channel } of tasks) {
    console.log(
      JSON.stringify({ event: "community.maintenance.stage", queue: task, scheduledTime }),
    );
    try {
      await env.COMMUNITY_CLOCK.getByName(
        `maintenance-task:${env.SLACK_TEAM_ID}:${task}:${channel ?? "team"}`,
      ).runMaintenanceTask(task, scheduledTime, channel);
    } catch (error) {
      failed = true;
      console.error(
        JSON.stringify({
          event: "community.cron.queue.failed",
          queue: task,
          errorType: error instanceof Error ? error.name : "Unknown",
          code: runtimeFailureCode(error),
        }),
      );
    }
  }
  if (failed) throw new Error("Maintenance task failed; independent tasks continued");
}
