import { DurableObject } from "cloudflare:workers";
import { isOptionalDay } from "./calendar";
import { dbAlarmRetryDelayMinutes } from "./community-alarm-backoff";
import { beginAlarmObservation, finishAlarmObservation } from "./community-alarm-observation";
import { alarmWorkIsClear } from "./community-alarm-proof";
import {
  type ClockInspection,
  COMMUNITY_SCHEDULE_CLOCK_ROLE,
  type GardenRequest,
} from "./community-clock-binding";
import { publishGardenRequest } from "./community-clock-garden";
import { refreshCommunityQueueClock } from "./community-clock-schedule";
import { communityMaintenanceCron } from "./community-cron";
import { runDueGardenDeliveries } from "./community-garden-delivery";
import {
  MAINTENANCE_CADENCE_MINUTES,
  maintenanceCadenceDue,
  runMaintenanceTask,
  validateMaintenanceTask,
} from "./community-maintenance-tasks";
import { runMembershipDue } from "./community-membership-schedule";
import type { CommunityEnv } from "./community-runtime";
import { parseCommunitySchedule, runCommunitySchedule } from "./community-scheduler";
import { CommunityStore } from "./community-store";
import { InputError } from "./input";
import { runtimeFailureCode } from "./runtime-failure";
import { NeonStore } from "./store";
import { refreshWeeklyRecorders, type WeeklyRecordersSnapshot } from "./weekly-recorders";

export { armCommunityClock, nextAlarmTime } from "./community-clock-client";

// Role name of the retired bug delivery clock, kept only to drain its last alarm.
const LEGACY_BUG_DELIVERY_ROLE = "bug_delivery";

export class CommunityClock extends DurableObject<CommunityEnv> {
  private queue: Promise<void> = Promise.resolve();

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // Cron is the sole trigger owner. These dedicated per-channel objects provide
  // serialization and a DO CPU budget, not a second daily alarm scheduler.
  runScrum(
    channelId: string,
    scheduledTime: number,
  ): Promise<{ readonly common: number; readonly personal: number }> {
    return this.serialize(async () => {
      if (
        !Number.isFinite(scheduledTime) ||
        ![this.env.COMMUNITY_PUBLIC_CHANNEL_ID, this.env.COMMUNITY_CHANNEL_ID].includes(channelId)
      )
        throw new InputError("Invalid scrum scope");
      await this.bindScheduledRole("daily_scrum", channelId);
      const adminId = this.env.COMMUNITY_ADMIN_ID;
      if (
        this.env.COMMUNITY_ENABLED !== "true" ||
        this.env.DATABASE_MAINTENANCE === "true" ||
        !adminId
      )
        return { common: 0, personal: 0 };
      await this.ctx.storage.put("lastRun", { scheduledTime, status: "running" });
      try {
        const local = new Date(scheduledTime + 9 * 60 * 60 * 1000).toISOString();
        const date = local.slice(0, 10);
        const minute = local.slice(11, 16);
        let scheduleCache = await this.ctx.storage.get<{
          readonly fetchedAt: number;
          readonly value: {
            readonly schedule: {
              readonly enabled: boolean;
              readonly goalTime: string;
              readonly reviewTime: string;
            } | null;
            readonly reminderTimes: {
              readonly goal: readonly string[];
              readonly review: readonly string[];
            };
          };
        }>("scrumSchedule");
        let cacheFresh = Boolean(
          scheduleCache &&
            scheduledTime >= scheduleCache.fetchedAt &&
            scheduledTime - scheduleCache.fetchedAt < 60 * 60_000,
        );
        if (!cacheFresh) {
          const settings = await new CommunityStore(new NeonStore(this.env.DATABASE_URL)).getRecord(
            {
              teamId: this.env.SLACK_TEAM_ID,
              channelId,
              userId: adminId,
              key: "group-schedule",
            },
          );
          const reminderTimes = await new CommunityStore(
            new NeonStore(this.env.DATABASE_URL),
          ).reminderDueTimes(this.env.SLACK_TEAM_ID, channelId);
          scheduleCache = {
            fetchedAt: scheduledTime,
            value: {
              schedule: settings ? parseCommunitySchedule(settings.body) : null,
              reminderTimes,
            },
          };
          await this.ctx.storage.put("scrumSchedule", scheduleCache);
          cacheFresh = true;
        }
        const cachedSchedule = scheduleCache?.value.schedule;
        const optionalDay = isOptionalDay(date);
        const dueKinds = cachedSchedule?.enabled
          ? (["goal", "review"] as const).filter((kind) => {
              if (optionalDay && kind === "review") return false;
              const due = optionalDay
                ? "10:00"
                : kind === "goal"
                  ? cachedSchedule.goalTime
                  : cachedSchedule.reviewTime;
              const end = optionalDay || kind === "review" ? "22:00" : cachedSchedule.reviewTime;
              return minute >= due && minute < end;
            })
          : [];
        const kindWindowOpen = cachedSchedule
          ? dueKinds.some(
              (kind) =>
                minute ===
                (kind === "goal"
                  ? optionalDay
                    ? "10:00"
                    : cachedSchedule.goalTime
                  : cachedSchedule.reviewTime),
            )
          : false;
        const reminderSeenThrough = await this.ctx.storage.get<string>(
          `reminderSeenThrough:${date}`,
        );
        const personalReminderDue =
          !optionalDay &&
          this.env.COMMUNITY_PUBLIC_CHANNEL_ID === channelId &&
          [
            ...(scheduleCache?.value.reminderTimes.goal ?? []),
            ...(scheduleCache?.value.reminderTimes.review ?? []),
          ].some((time) => time > (reminderSeenThrough ?? "00:00") && time <= minute);
        const hasDoneKind = await Promise.all(
          dueKinds.map((kind) => this.ctx.storage.get<boolean>(`done:${date}:${kind}`)),
        );
        if (
          cacheFresh &&
          !kindWindowOpen &&
          !personalReminderDue &&
          hasDoneKind.every((done) => done === true)
        ) {
          if (this.env.COMMUNITY_PUBLIC_CHANNEL_ID === channelId && !optionalDay) {
            await this.ctx.storage.put(`reminderSeenThrough:${date}`, minute);
            await this.pruneDailyKeys(date);
          }
          console.log(
            JSON.stringify({ event: "community.scrum.idle", date, minute, channel: channelId }),
          );
          await this.ctx.storage.put("lastRun", {
            scheduledTime,
            status: "idle",
            common: 0,
            personal: 0,
          });
          return { common: 0, personal: 0 };
        }
        const store = new CommunityStore(new NeonStore(this.env.DATABASE_URL));
        const result = await runCommunitySchedule(
          {
            ...this.env,
            COMMUNITY_CHANNEL_ID: channelId,
            COMMUNITY_ADMIN_ID: adminId,
          },
          store,
          new Date(scheduledTime),
          cachedSchedule ?? null,
        );
        const dispatchRecords = await Promise.all(
          dueKinds.map((kind) =>
            store.getRecord({
              teamId: this.env.SLACK_TEAM_ID,
              channelId,
              userId: adminId,
              key: `common:${date}:${kind}`,
            }),
          ),
        );
        for (let index = 0; index < dueKinds.length; index += 1) {
          if (dispatchRecords[index]?.status === "sent") {
            await this.ctx.storage.put(`done:${date}:${dueKinds[index]}`, true);
            await this.pruneDailyKeys(date);
          }
        }
        if (this.env.COMMUNITY_PUBLIC_CHANNEL_ID === channelId && !optionalDay) {
          await this.ctx.storage.put(`reminderSeenThrough:${date}`, minute);
          await this.pruneDailyKeys(date);
        }
        await this.ctx.storage.put("lastRun", { scheduledTime, status: "finished", ...result });
        return result;
      } catch (error) {
        await this.ctx.storage.put("lastRun", {
          scheduledTime,
          status: "failed",
          failure: error instanceof Error ? error.name : "Unknown",
        });
        throw error;
      }
    });
  }

  private async pruneDailyKeys(today: string): Promise<void> {
    const yesterday = new Date(Date.parse(`${today}T00:00:00+09:00`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const prefix of ["done:", "reminderSeenThrough:"]) {
      const keys = await this.ctx.storage.list({ prefix });
      await Promise.all(
        [...keys.keys()]
          .filter((key) => {
            const date = key.slice(prefix.length).split(":")[0] ?? "";
            return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < yesterday;
          })
          .map((key) => this.ctx.storage.delete(key)),
      );
    }
  }

  invalidateScrumSchedule(channelId: string): Promise<void> {
    return this.serialize(async () => {
      if (
        ![this.env.COMMUNITY_PUBLIC_CHANNEL_ID, this.env.COMMUNITY_CHANNEL_ID].includes(channelId)
      )
        throw new InputError("Invalid scrum scope");
      await this.ctx.storage.delete("scrumSchedule");
      const doneKeys = await this.ctx.storage.list({ prefix: "done:" });
      await Promise.all([...doneKeys.keys()].map((key) => this.ctx.storage.delete(key)));
    });
  }

  runMaintenance(scheduledTime: number): Promise<void> {
    return this.serialize(async () => {
      if (!Number.isFinite(scheduledTime)) throw new InputError("Invalid maintenance time");
      await this.bindScheduledRole("community_maintenance");
      await communityMaintenanceCron(this.env, scheduledTime);
    });
  }

  runMaintenanceTask(task: string, scheduledTime: number, channelId?: string): Promise<void> {
    return this.serialize(async () => {
      validateMaintenanceTask(this.env, task, scheduledTime, channelId);
      await this.bindScheduledRole(`maintenance_task:${task}`, channelId);
      const cadence = MAINTENANCE_CADENCE_MINUTES[task];
      if (!cadence) throw new InputError("Invalid maintenance task scope");
      const cacheKey = `maintenanceNextDue:${task}`;
      const nextDue = await this.ctx.storage.get<number>(cacheKey);
      if (nextDue !== undefined && scheduledTime < nextDue) return;
      await this.ctx.storage.put("lastRun", { scheduledTime, status: "running" });
      try {
        if (task === "weekly_recorders") {
          if (maintenanceCadenceDue(task, scheduledTime))
            await refreshWeeklyRecorders(
              this.env,
              this.ctx.storage,
              new NeonStore(this.env.DATABASE_URL),
              scheduledTime,
            );
        } else await runMaintenanceTask(this.env, task, scheduledTime, channelId);
        await this.ctx.storage.put(cacheKey, scheduledTime + cadence * 60_000);
        await this.ctx.storage.put("lastRun", { scheduledTime, status: "finished" });
      } catch (error) {
        await this.ctx.storage.put("lastRun", {
          scheduledTime,
          status: "failed",
          code: runtimeFailureCode(error),
        });
        throw error;
      }
    });
  }

  weeklyRecorders(): Promise<WeeklyRecordersSnapshot | undefined> {
    return this.ctx.storage.get<WeeklyRecordersSnapshot>("weeklyRecorders");
  }

  private async bindScheduledRole(role: string, channel?: string): Promise<void> {
    const previous = await this.ctx.storage.get<string>("role");
    const bound = await this.ctx.storage.get<string>("channel");
    if ((previous && previous !== role) || (bound && bound !== channel))
      throw new InputError("Scheduled object role cannot change");
    await this.ctx.storage.put("role", role);
    if (channel) await this.ctx.storage.put("channel", channel);
  }

  publishGarden(input: GardenRequest): Promise<string> {
    return this.serialize(() => publishGardenRequest(this.env, this.ctx.storage, input));
  }

  refresh(channelId: string): Promise<{ readonly next: number | null }> {
    return this.serialize(() => this.refreshSchedule(channelId));
  }

  armMembershipScan(channelId: string): Promise<void> {
    return this.serialize(async () => {
      if (channelId !== this.env.COMMUNITY_PUBLIC_CHANNEL_ID)
        throw new InputError("Invalid membership scan scope");
      const role = await this.ctx.storage.get<string>("role");
      const bound = await this.ctx.storage.get<string>("channel");
      if (role && role !== COMMUNITY_SCHEDULE_CLOCK_ROLE)
        throw new InputError("Clock role cannot change");
      if (bound && bound !== channelId) throw new InputError("Clock channel cannot change");
      await this.ctx.storage.put("role", COMMUNITY_SCHEDULE_CLOCK_ROLE);
      await this.ctx.storage.put("channel", channelId);
      const due = Date.now() + 1_000;
      const previous = await this.ctx.storage.getAlarm();
      if (previous === null || previous < Date.now() || due < previous)
        await this.ctx.storage.setAlarm(due);
    });
  }

  private refreshSchedule(
    channelId: string,
    options: { readonly replaceAlarm?: boolean; readonly due?: number | null } = {},
  ): Promise<{ readonly next: number | null }> {
    return refreshCommunityQueueClock(this.env, this.ctx.storage, channelId, options);
  }

  async inspect(): Promise<ClockInspection> {
    return {
      next: await this.ctx.storage.getAlarm(),
      role: (await this.ctx.storage.get<string>("role")) ?? null,
      lastRun: (await this.ctx.storage.get<Readonly<Record<string, unknown>>>("lastRun")) ?? null,
      alarmCycle:
        (await this.ctx.storage.get<Readonly<Record<string, unknown>>>("alarmObservation")) ?? null,
    };
  }

  alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
    console.log(
      JSON.stringify({
        event: "community.clock.alarm.received",
        retryCount: alarmInfo?.retryCount ?? 0,
        isRetry: alarmInfo?.isRetry ?? false,
      }),
    );
    return this.serialize(async () => {
      const role = await this.ctx.storage.get<string>("role");
      const channelId = await this.ctx.storage.get<string>("channel");
      // The bug delivery clock is retired; a pending legacy alarm fires once and is not re-armed.
      if (role === LEGACY_BUG_DELIVERY_ROLE) return;
      if (role && role !== COMMUNITY_SCHEDULE_CLOCK_ROLE)
        throw new InputError("Unsupported clock role");
      if (this.env.DATABASE_MAINTENANCE === "true") {
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        return;
      }
      if (!channelId) return;
      if (!role) await this.ctx.storage.put("role", COMMUNITY_SCHEDULE_CLOCK_ROLE);
      const now = new Date(Date.now());
      const retryAt = now.getTime() + 60_000;
      // Persist recovery before external I/O. Platform cancellation cannot be
      // caught, and must not leave an alarm with no future execution scheduled.
      await this.ctx.storage.setAlarm(retryAt);
      const cycle = await beginAlarmObservation(
        this.ctx.storage,
        COMMUNITY_SCHEDULE_CLOCK_ROLE,
        now.getTime(),
      );
      let queueFailed = false;
      await this.ctx.storage.put("lastRun", { at: now.getTime(), status: "running", retryAt });
      console.log(
        JSON.stringify({
          event: "community.clock.alarm.start",
          role: COMMUNITY_SCHEDULE_CLOCK_ROLE,
          retryAt,
        }),
      );
      try {
        let garden: { readonly processed: number; readonly nextDue: number | null } = {
          processed: 0,
          nextDue: null,
        };
        try {
          garden = await runDueGardenDeliveries(
            this.env,
            channelId,
            now.getTime(),
            undefined,
            () => {
              queueFailed = true;
            },
          );
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          queueFailed = true;
          console.error(
            JSON.stringify({
              event: "community.clock.queue.failed",
              queue: "garden",
              errorType: error.name,
              code: runtimeFailureCode(error),
            }),
          );
          garden = { processed: 0, nextDue: now.getTime() + 60_000 };
        }
        let membership = { possiblyMore: false, nextDue: null as number | null };
        try {
          membership = await runMembershipDue(
            this.env,
            new NeonStore(this.env.DATABASE_URL),
            channelId,
            now.getTime(),
            () => {
              queueFailed = true;
            },
          );
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          queueFailed = true;
          console.error(
            JSON.stringify({
              event: "community.clock.queue.failed",
              queue: "membership",
              errorType: error.name,
              code: runtimeFailureCode(error),
            }),
          );
          membership = { ...membership, nextDue: now.getTime() + 60_000 };
        }
        await this.ctx.storage.delete(["referralReconcileCursor", "interestReconcileCursor"]);
        const immediate = garden.processed >= 10 || membership.possiblyMore;
        const candidates = [garden.nextDue, membership.nextDue].filter(
          (candidate): candidate is number => candidate !== null,
        );
        const due = immediate
          ? now.getTime() + 1_000
          : candidates.length
            ? Math.min(...candidates)
            : null;
        // Include membership-only retries, then atomically replace the temporary
        // safety alarm with the actual deadline. Do not delete it before I/O.
        const next = await this.refreshSchedule(channelId, { replaceAlarm: true, due });
        if (queueFailed) {
          const failures = (await this.ctx.storage.get<number>("dbFailureCount")) ?? 0;
          const minutes = dbAlarmRetryDelayMinutes(failures);
          const retryAt = now.getTime() + minutes * 60_000;
          await this.ctx.storage.put("dbFailureCount", failures + 1);
          await this.ctx.storage.setAlarm(retryAt);
        } else await this.ctx.storage.delete("dbFailureCount");
        await finishAlarmObservation(
          this.ctx.storage,
          cycle,
          COMMUNITY_SCHEDULE_CLOCK_ROLE,
          !queueFailed &&
            !immediate &&
            garden.nextDue === null &&
            (await alarmWorkIsClear(this.env, COMMUNITY_SCHEDULE_CLOCK_ROLE, channelId)),
        );
        await this.ctx.storage.put("lastRun", {
          at: now.getTime(),
          status: "finished",
          next: next.next,
        });
        console.log(
          JSON.stringify({
            event: "community.clock.alarm.end",
            role: COMMUNITY_SCHEDULE_CLOCK_ROLE,
            next: next.next,
          }),
        );
      } catch (error) {
        await this.ctx.storage.put("lastRun", {
          at: Date.now(),
          failure: error instanceof Error ? error.name : "UnknownError",
          status: "failed",
          code: runtimeFailureCode(error),
        });
        const failures = (await this.ctx.storage.get<number>("dbFailureCount")) ?? 0;
        const minutes = dbAlarmRetryDelayMinutes(failures);
        await this.ctx.storage.put("dbFailureCount", failures + 1);
        await this.ctx.storage.setAlarm(Date.now() + minutes * 60_000);
        console.error(
          JSON.stringify({
            event: "community.clock.alarm.failed",
            errorType: error instanceof Error ? error.name : "Unknown",
            code: runtimeFailureCode(error),
          }),
        );
      }
    });
  }
}
