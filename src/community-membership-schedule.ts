import { runApplicantRetention } from "./community-applicant-retention";
import { nextMembershipDue } from "./community-membership-due";
import { runRetentionQueues } from "./community-retention-schedule";
import type { CommunityEnv } from "./community-runtime";
import { runtimeFailureCode } from "./runtime-failure";
import type { NeonStore } from "./store";
import { StoreError } from "./store-types";

export async function runMembershipDue(
  env: CommunityEnv,
  db: NeonStore,
  channelId: string,
  now: number,
  observeFailure?: () => void,
): Promise<{ readonly possiblyMore: boolean; readonly nextDue: number | null }> {
  if (channelId !== env.COMMUNITY_PUBLIC_CHANNEL_ID || env.DATABASE_MAINTENANCE === "true")
    return { possiblyMore: false, nextDue: null };
  let failed = false;
  const retention = await runRetentionQueues(db, env.SLACK_TEAM_ID, now);
  let nextDue: number | null = null;
  try {
    nextDue = await nextMembershipDue(env, db, channelId, now);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    failed = true;
    console.error(
      JSON.stringify({
        event: "community.membership.queue.failed",
        queue: "next_due",
        errorType: error.name,
        errorCode: error instanceof StoreError ? error.code : runtimeFailureCode(error),
      }),
    );
  }
  const applicants = await runApplicantRetention(env, db, now);
  failed ||= retention.failed || applicants.failed;
  if (failed) observeFailure?.();
  return {
    possiblyMore: retention.possiblyMore || applicants.possiblyMore,
    nextDue: failed ? Math.min(nextDue ?? now + 60_000, now + 60_000) : nextDue,
  };
}
