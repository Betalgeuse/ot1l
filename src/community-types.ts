import type { Json } from "./input";

export type CommunityScope = {
  readonly teamId: string;
  readonly channelId: string;
  readonly userId: string;
};
export type DayScope = CommunityScope & { readonly date: string };
export type Outcome = "pending" | "complete" | "progress" | "partial" | "not_done";
export type CommunityDay = DayScope & {
  readonly goal: string;
  readonly outcome: Outcome;
  readonly reflection: string;
  readonly resting: boolean;
  readonly revision: number;
};
export type GardenSeason = {
  readonly seasonId: number;
  readonly openedOn: string;
  readonly closedOn: string | null;
  readonly days: readonly CommunityDay[];
};
export type DayChange = DayScope & {
  readonly syncLegacy?: boolean;
  readonly preserveOutcome?: boolean;
  readonly reviewThreadV2?: boolean;
  readonly key: string;
  readonly action:
    | "goal"
    | "complete"
    | "progress"
    | "partial"
    | "not_done"
    | "reflection"
    | "rest"
    | "undo";
  readonly text?: string;
  readonly outcome?: Outcome;
  readonly expectedRevision?: number;
  readonly expectedLifecycleRevision?: number;
  readonly now?: string;
  readonly undoKey?: string;
  readonly delivery?: {
    readonly source: string;
    readonly thread: string;
    readonly undoKey: string | null;
  };
};
export type ChangeResult = {
  readonly day: CommunityDay;
  readonly changed: boolean;
  readonly conflict: boolean;
  readonly firstGoal: boolean;
  readonly firstRegistration?: boolean;
  readonly firstReflection: boolean;
  readonly undoKey: string;
  readonly gardenDeliveryKey?: string;
  readonly returnTransition?: {
    readonly kind: "welcome_back";
    readonly lifecycleRevision: number;
    readonly seasonId: number;
    readonly effectKey: string;
  };
};
export type SupportPreferences = CommunityScope & {
  readonly enabled: boolean;
  readonly goalTime: string;
  readonly reviewTime: string;
  readonly timezone: "Asia/Seoul";
};
export type PreferencePatch = {
  readonly enabled?: boolean;
  readonly goalTime?: string;
  readonly reviewTime?: string;
};
export type GroupSchedule = {
  readonly enabled: boolean;
  readonly goalTime: string;
  readonly reviewTime: string;
};
export type CommunityRecord = CommunityScope & {
  readonly key: string;
  readonly kind: string;
  readonly body: Json;
  readonly status: string;
};
export type RecordKey = CommunityScope & { readonly key: string };
export type ReminderJob = RecordKey & { readonly date: string; readonly kind: "goal" | "review" };
export type ReviewHighlight = {
  readonly userId: string;
  readonly outcome: Outcome;
  readonly reviewedAt: string;
};
export type ChannelMember = {
  readonly userId: string;
  readonly displayName: string;
  readonly isBot: boolean;
  readonly isAppUser: boolean;
  readonly deleted: boolean;
};
export type MemberJoinObservation = {
  readonly teamId: string;
  readonly channelId: string;
  readonly observedAt: string;
  readonly member: ChannelMember;
};
export type ChannelMembershipSnapshot = {
  readonly observedAt: string;
  readonly members: readonly ChannelMember[];
  readonly eligibleHumanIds: readonly string[];
};
export type ReminderBatch = {
  readonly leaseToken: string;
  readonly attempt: number;
  readonly firstAttemptAt: string;
  readonly threadTs?: string;
  readonly jobs: readonly ReminderJob[];
};
export type CommonDelivery = {
  readonly leaseToken: string;
  readonly attempt: number;
  readonly safeToPost: boolean;
  readonly firstAttemptAt: string;
  readonly key: string;
  readonly text: string;
  readonly date: string;
  readonly kind: "goal" | "review";
};
export type TownhallEventOption = {
  readonly startsAt: string;
  readonly position: number;
  readonly votes: number;
};
export type TownhallEvent = {
  readonly eventId: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly hostUserId: string;
  readonly activity: string;
  readonly location: string;
  readonly revision: number;
  readonly status: "draft" | "active";
  readonly messageTs: string | null;
  readonly options: readonly TownhallEventOption[];
  readonly selected: readonly string[];
  readonly poll: null | {
    readonly startDate: string;
    readonly endDate: string;
    readonly dayStart: string;
    readonly dayEnd: string;
    readonly stepMinutes: 30 | 60;
    readonly timezone: "Asia/Seoul";
  };
  readonly series: null | {
    readonly recurrenceEveryWeeks: 1 | 2;
    readonly occurrenceCount: number;
    readonly occurrences: readonly {
      readonly number: number;
      readonly startsAt: string;
      readonly status: "scheduled" | "completed" | "cancelled";
    }[];
  };
  readonly eventKind: "gathering" | "challenge" | "series";
  readonly phase:
    | "recruiting"
    | "scheduling"
    | "scheduled"
    | "confirmed"
    | "cancel_pending"
    | "cancelled"
    | "completed"
    | "paused";
  readonly minConfirmed: number;
  readonly capacity: number | null;
  readonly recruitmentDeadline: string | null;
  readonly graceHours: number;
  readonly autoCancel: boolean;
  readonly graceUntil: string | null;
  readonly finalStartAt: string | null;
  readonly finalEndAt: string | null;
  readonly durationMinutes: number;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
  readonly interestCount: number;
  readonly goingCount: number;
  readonly waitlistCount: number;
  readonly viewerState: "interested" | "going" | "waitlist" | "declined" | null;
  readonly participants: readonly {
    readonly userId: string;
    readonly state: "going" | "waitlist";
  }[];
};
export type CommunityMaintainer = {
  readonly teamId: string;
  readonly userId: string;
  readonly state: "active" | "inactive" | "revoked";
  readonly revision: number;
};
export type ReminderBatchFinish = {
  readonly teamId: string;
  readonly channelId: string;
  readonly leaseToken: string;
  readonly status: "sent" | "failed" | "cancelled";
  readonly errorCode?: string;
  readonly retryAfterSeconds?: number;
};
export type MemberIntroduction = {
  readonly teamId: string;
  readonly userId: string;
  readonly confirmedName: string | null;
  readonly intro: string;
  readonly linkedin: string | null;
  readonly details: string | null;
  readonly channelId: string | null;
  readonly messageTs: string | null;
  readonly revision: number;
};
