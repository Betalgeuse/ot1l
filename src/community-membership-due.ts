import { nextRetentionDue } from "./community-retention-schedule";
import type { CommunityEnv } from "./community-runtime";
import { InputError, string } from "./input";
import type { NeonStore } from "./store";

function millis(value: string | null): number | null {
  if (value === null) return null;
  const due = Date.parse(value);
  if (!Number.isFinite(due)) throw new InputError("Invalid membership due time");
  return due;
}

export async function nextMembershipDue(
  env: CommunityEnv,
  db: NeonStore,
  channelId: string,
  now = Date.now(),
): Promise<number | null> {
  if (channelId !== env.COMMUNITY_PUBLIC_CHANNEL_ID || env.DATABASE_MAINTENANCE === "true")
    return null;
  const retention = await nextRetentionDue(db, env.SLACK_TEAM_ID, now);
  return retention === null ? now + 5 * 60_000 : Math.min(retention, now + 5 * 60_000);
}

export async function nextGardenDue(
  db: NeonStore,
  teamId: string,
  channelId: string,
  includeRetirements: boolean,
): Promise<number | null> {
  const raw = await db.queryJson(
    `SELECT coalesce(to_jsonb(min(due_at)), 'null'::jsonb) FROM (
      SELECT CASE WHEN status='claimed' THEN lease_expires_at
        ELSE coalesce(retry_after,created_at) END AS due_at
      FROM otl.community_garden_deliveries
      WHERE team_id=$1 AND channel_id=$2 AND status IN ('pending','failed','claimed') AND attempts<3
      UNION ALL
      SELECT CASE WHEN status IN ('claimed','restore_claimed') THEN lease_expires_at
        ELSE coalesce(retry_after,created_at) END
      FROM otl.community_garden_retirements
      WHERE team_id=$1 AND channel_id=$2 AND $3::boolean
        AND status IN ('pending','failed','claimed','restore_claimed')
        AND attempts<3
    ) due`,
    [teamId, channelId, String(includeRetirements)],
  );
  return millis(raw === null ? null : string(raw));
}
