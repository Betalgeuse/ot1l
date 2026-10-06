import { deliverWelcomeGuide } from "./community-guide";
import { welcomeIntroductionMember } from "./community-introduction-channel";
import { collectCurrentChannelMembers, parseChannelMember } from "./community-membership";
import type { CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { welcomeTownhallMember } from "./community-welcome";
import { type Json, object, string } from "./input";
import { NeonStore } from "./store";

type OnboardingKind = "guide" | "introduction" | "reminder" | "townhall";

type OnboardingEnv = Pick<
  CommunityEnv,
  | "SLACK_TEAM_ID"
  | "SLACK_BOT_TOKEN"
  | "DATABASE_URL"
  | "COMMUNITY_BOT_USER_ID"
  | "COMMUNITY_WELCOME_CHANNEL_ID"
  | "COMMUNITY_INTRO_CHANNEL_ID"
  | "COMMUNITY_PUBLIC_CHANNEL_ID"
  | "COMMUNITY_RELEASE_CHANNEL_ID"
  | "COMMUNITY_GUIDE_CANVAS_ID"
  | "COMMUNITY_GUIDE_CANVAS_URL"
  | "COMMUNITY_GUIDE_ANCHOR_TS"
  | "GUIDE_DATABASE_URL"
>;

type OnboardingCandidate = {
  readonly userId: string;
  readonly displayName: string;
  readonly isBot: boolean;
  readonly isAppUser: boolean;
  readonly deleted: boolean;
};

type OnboardingClaim = {
  readonly userId: string;
  readonly kind: OnboardingKind;
  readonly eventTs: string;
  readonly attempt: number;
};

export class MemberOnboardingStore {
  constructor(
    private readonly db: Pick<NeonStore, "queryJson">,
    private readonly teamId: string,
  ) {}

  private execute(op: string, payload: Record<string, Json>): Promise<Json> {
    return this.db.queryJson("SELECT otl.member_onboarding_execute($1,$2::jsonb)", [
      op,
      JSON.stringify({ ...payload, teamId: this.teamId }),
    ]);
  }

  async enqueue(
    candidate: OnboardingCandidate,
    input: {
      readonly channelId: string;
      readonly sourceKind: "team_join" | "reconcile";
      readonly eventId: string;
      readonly eventTs: string;
    },
  ): Promise<number> {
    const result = object(await this.execute("enqueue", { ...candidate, ...input }));
    const count = Number(result.enqueued);
    if (!Number.isSafeInteger(count) || count < 0 || count > 4)
      throw new TypeError("invalid onboarding enqueue receipt");
    return count;
  }

  async claim(now: string, workerId: string, leaseToken: string): Promise<OnboardingClaim | null> {
    const value = await this.execute("claim", { now, workerId, leaseToken });
    if (value === null) return null;
    const result = object(value);
    const kind = string(result.kind);
    const attempt = Number(result.attempt);
    if (
      !["guide", "introduction", "reminder", "townhall"].includes(kind) ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      attempt > 5
    )
      throw new TypeError("invalid onboarding claim");
    return {
      userId: string(result.userId),
      kind: kind as OnboardingKind,
      eventTs: string(result.eventTs),
      attempt,
    };
  }

  async finish(input: {
    readonly userId: string;
    readonly kind: OnboardingKind;
    readonly leaseToken: string;
    readonly status: "sent" | "failed";
    readonly errorCode?: string;
    readonly now: string;
  }): Promise<void> {
    if ((await this.execute("finish", input)) !== true)
      throw new TypeError("onboarding finish receipt missing");
  }
}

async function candidateForUser(userId: string, env: OnboardingEnv): Promise<OnboardingCandidate> {
  return parseChannelMember(
    await callSlack(env.SLACK_BOT_TOKEN, "users.info", { user: userId }),
    userId,
  );
}

export async function enqueueTeamJoinOnboarding(
  data: Record<string, unknown>,
  env: OnboardingEnv,
  store = new MemberOnboardingStore(new NeonStore(env.DATABASE_URL), env.SLACK_TEAM_ID),
): Promise<number> {
  const event = object(data.event);
  const userId = string(object(event.user).id);
  const eventTs = String(event.event_ts ?? data.event_time ?? "");
  return store.enqueue(await candidateForUser(userId, env), {
    channelId: string(env.COMMUNITY_PUBLIC_CHANNEL_ID),
    sourceKind: "team_join",
    eventId: string(data.event_id),
    eventTs,
  });
}

export async function reconcileMemberOnboarding(
  env: OnboardingEnv,
  store: MemberOnboardingStore,
  now: number,
): Promise<number> {
  const channelId = env.COMMUNITY_PUBLIC_CHANNEL_ID;
  const botUserId = env.COMMUNITY_BOT_USER_ID;
  if (!channelId || !botUserId) return 0;
  const observedAt = new Date(now).toISOString();
  const eventTs = String(now / 1_000);
  const snapshot = await collectCurrentChannelMembers(
    env.SLACK_BOT_TOKEN,
    channelId,
    botUserId,
    observedAt,
  );
  let enqueued = 0;
  for (const member of snapshot.members) {
    if (!snapshot.eligibleHumanIds.includes(member.userId)) continue;
    enqueued += await store.enqueue(member, {
      channelId,
      sourceKind: "reconcile",
      eventId: `reconcile:${observedAt}:${member.userId}`,
      eventTs,
    });
  }
  return enqueued;
}

async function deliverClaim(claim: OnboardingClaim, env: OnboardingEnv): Promise<void> {
  if (claim.kind === "reminder") return;
  const channel =
    claim.kind === "guide"
      ? env.COMMUNITY_WELCOME_CHANNEL_ID
      : claim.kind === "introduction"
        ? env.COMMUNITY_INTRO_CHANNEL_ID
        : env.COMMUNITY_RELEASE_CHANNEL_ID;
  if (!channel) throw new TypeError("onboarding channel missing");
  const event = {
    type: "member_joined_channel",
    channel,
    user: claim.userId,
    event_ts: claim.eventTs,
  };
  if (claim.kind === "guide") await deliverWelcomeGuide(event, env as CommunityEnv);
  else if (claim.kind === "introduction")
    await welcomeIntroductionMember(event, env as CommunityEnv);
  else await welcomeTownhallMember(event, env as CommunityEnv);
}

export async function runMemberOnboardingDeliveries(
  env: OnboardingEnv,
  store: MemberOnboardingStore,
  now: number,
  limit = 10,
): Promise<{
  readonly processed: number;
  readonly failed: number;
  readonly possiblyMore: boolean;
}> {
  let processed = 0;
  let failed = 0;
  const workerId = `onboarding-${crypto.randomUUID()}`;
  for (let index = 0; index < limit; index += 1) {
    const leaseToken = crypto.randomUUID();
    const claim = await store.claim(new Date(now).toISOString(), workerId, leaseToken);
    if (!claim) return { processed, failed, possiblyMore: false };
    try {
      await deliverClaim(claim, env);
      await store.finish({
        userId: claim.userId,
        kind: claim.kind,
        leaseToken,
        status: "sent",
        now: new Date(now).toISOString(),
      });
      processed += 1;
    } catch (error) {
      await store.finish({
        userId: claim.userId,
        kind: claim.kind,
        leaseToken,
        status: "failed",
        errorCode: error instanceof Error ? error.name.slice(0, 120) : "Unknown",
        now: new Date(now).toISOString(),
      });
      failed += 1;
    }
  }
  return { processed, failed, possiblyMore: true };
}
