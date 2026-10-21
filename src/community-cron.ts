import { CHANNEL_MAINTENANCE_TASKS, TEAM_MAINTENANCE_TASKS } from "./community-maintenance-tasks";
import type { CommunityEnv } from "./community-runtime";
import { runtimeFailureCode } from "./runtime-failure";

// Workers Free permits five cron triggers per account, shared by every Worker.
export const CRON_TRIGGERS = ["*/5 * * * *", "1-59/5 * * * *"] as const;
export const SCRUM_CRON = CRON_TRIGGERS[0];
// Keep this wake-window definition aligned with automation/runner/wake-window.mjs.
export const MAINTENANCE_WINDOW = "1,31 * * * *";
export const CLOCK_RECOVERY_CRON = CRON_TRIGGERS[1];
export const NEON_WAKE_WINDOW_BUDGET = 60;

export async function communityCron(
  env: CommunityEnv,
  scheduledTime: number,
  cron = "*/5 * * * *",
): Promise<void> {
  if (cron === CLOCK_RECOVERY_CRON) {
    if (!env.COMMUNITY_CLOCK) throw new Error("Scheduled work binding missing");
    const tasks = ["clock_recovery", "events"] as const;
    let failed = false;
    for (const task of tasks) {
      try {
        await env.COMMUNITY_CLOCK.getByName(
          `maintenance-task:${env.SLACK_TEAM_ID}:${task}:team`,
        ).runMaintenanceTask(task, scheduledTime);
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
    const minute = new Date(scheduledTime).getUTCMinutes();
    if (minute === 1 || minute === 31) {
      try {
        await env.COMMUNITY_CLOCK.getByName(`maintenance:${env.SLACK_TEAM_ID}`).runMaintenance(
          scheduledTime,
        );
      } catch (error) {
        failed = true;
        console.error(
          JSON.stringify({
            event: "community.cron.queue.failed",
            queue: "maintenance",
            errorType: error instanceof Error ? error.name : "Unknown",
            code: runtimeFailureCode(error),
          }),
        );
      }
    }
    if (failed) throw new Error("Clock recovery or maintenance task failed");
    return;
  }
  if (
    env.COMMUNITY_ENABLED !== "true" ||
    env.DATABASE_MAINTENANCE === "true" ||
    !env.COMMUNITY_ADMIN_ID
  )
    return;
  if (cron === SCRUM_CRON) {
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
      { task: "community_clock_recovery" },
      ...TEAM_MAINTENANCE_TASKS.filter(
        (task) => !["clock_recovery", "community_clock_recovery", "events"].includes(task),
      ).map((task) => ({
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
