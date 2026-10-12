import type { CommunityEnv } from "./community-runtime";
import { NeonStore } from "./store";

// A clean scheduler return is not evidence that an interrupted leased delivery
// finished. Keep the completion gate read-only and conservative: any outstanding
// due work, uncertain claim, failed/dead delivery or failed purge prevents green.
export const BUG_ALARM_CLEAR = `SELECT to_jsonb(NOT EXISTS(SELECT 1 FROM otl.bug_deliveries
 WHERE team_id=$1 AND (status IN ('claimed','failed') OR (status='pending' AND not_before<=$2::timestamptz))))`;
export const COMMUNITY_ALARM_CLEAR = `SELECT to_jsonb(NOT EXISTS(
 SELECT 1 FROM otl.community_garden_deliveries WHERE team_id=$1 AND channel_id=$2 AND status IN ('pending','claimed','failed')
 UNION ALL SELECT 1 FROM otl.community_garden_retirements WHERE team_id=$1 AND channel_id=$2 AND $7::boolean
   AND status IN ('pending','claimed','failed','restore_claimed','restore_failed')
 UNION ALL SELECT 1 FROM otl.referral_outbox WHERE team_id=$1 AND $4::boolean
   AND (status IN ('claimed','failed') OR (status='pending' AND available_at<=$3::timestamptz))
 UNION ALL SELECT 1 FROM otl.lifecycle_notice_outbox WHERE team_id=$1 AND channel_id=$2 AND $5::boolean
   AND (status IN ('claimed','failed','dead') OR (status='pending' AND scheduled_at<=$3::timestamptz))
 UNION ALL SELECT 1 FROM otl.interest_outbox WHERE team_id=$1 AND $6::boolean
   AND (status IN ('claimed','failed','dead') OR (status='pending' AND available_at<=$3::timestamptz))
 UNION ALL SELECT 1 FROM otl.referral_private_payloads p JOIN otl.referral_requests r USING(team_id,request_id)
   WHERE p.team_id=$1 AND $8::boolean AND (p.purge_status IN ('claimed','failed') OR (p.purge_status='pending' AND r.payload_purge_after<=$3::timestamptz))
 UNION ALL SELECT 1 FROM otl.interest_private_payloads p JOIN otl.interest_requests r USING(team_id,interest_id)
   WHERE p.team_id=$1 AND $8::boolean AND (p.purge_status IN ('claimed','failed','dead') OR (p.purge_status='pending' AND r.payload_purge_after<=$3::timestamptz))
))`;
export async function alarmWorkIsClear(
  env: CommunityEnv,
  role: string,
  channelId?: string,
): Promise<boolean> {
  try {
    if (
      role !== "bug_delivery" &&
      (role !== "community_schedule" ||
        !channelId ||
        ![env.COMMUNITY_CHANNEL_ID, env.COMMUNITY_PUBLIC_CHANNEL_ID].includes(channelId))
    )
      return false;
    const db = new NeonStore(env.DATABASE_URL);
    if (role === "bug_delivery")
      return (
        (await db.queryJson(BUG_ALARM_CLEAR, [env.SLACK_TEAM_ID, new Date().toISOString()])) ===
        true
      );
    const publicChannel = channelId === env.COMMUNITY_PUBLIC_CHANNEL_ID;
    return (
      (await db.queryJson(COMMUNITY_ALARM_CLEAR, [
        env.SLACK_TEAM_ID,
        channelId ?? "",
        new Date().toISOString(),
        String(publicChannel && env.REFERRALS_ENABLED === "true"),
        String(publicChannel && env.LIFECYCLE_MODE === "enforce"),
        String(publicChannel && env.PUBLIC_INTEREST_ENABLED === "true"),
        String(env.GARDEN_RECONCILIATION === "true"),
        String(publicChannel),
      ])) === true
    );
  } catch {
    console.warn(JSON.stringify({ event: "community.alarm.proof_unavailable" }));
    return false; // Missing permissions or unavailable evidence is not success.
  }
}
