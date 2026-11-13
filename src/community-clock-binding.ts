export const COMMUNITY_SCHEDULE_CLOCK_ROLE = "community_schedule" as const;

export type GardenRequest = {
  readonly userId: string;
  readonly channelId: string;
  readonly date: string;
  readonly source: string;
  readonly thread: string;
  readonly key: string;
  readonly undoKey: string | null;
  readonly deliveryKey?: string;
};

export type ClockInspection = {
  readonly next: number | null;
  readonly role: string | null;
  readonly lastRun: Readonly<Record<string, unknown>> | null;
  readonly alarmCycle?: Readonly<Record<string, unknown>> | null;
};

export interface ClockBinding {
  getByName(name: string): {
    refresh(channelId: string): Promise<{ readonly next: number | null }>;
    armMembershipScan(channelId: string): Promise<void>;
    inspect(): Promise<ClockInspection>;
    publishGarden(input: GardenRequest): Promise<string>;
    runScrum(
      channelId: string,
      scheduledTime: number,
    ): Promise<{ readonly common: number; readonly personal: number }>;
    invalidateScrumSchedule(channelId: string): Promise<void>;
    runMaintenance(scheduledTime: number): Promise<void>;
    runMaintenanceTask(task: string, scheduledTime: number, channelId?: string): Promise<void>;
  };
}
