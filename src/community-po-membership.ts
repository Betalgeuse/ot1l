import type { CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, list, object, string } from "./input";
import { NeonStore } from "./store";

type PoEnv = Pick<
  CommunityEnv,
  | "SLACK_TEAM_ID"
  | "SLACK_BOT_TOKEN"
  | "DATABASE_URL"
  | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
  | "COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS"
  | "COMMUNITY_RETENTION_CHANNEL_ID"
  | "COMMUNITY_SYS_ALERT_CHANNEL_ID"
>;

export function poMembershipChannels(env: PoEnv): string[] {
  return [
    ...new Set(
      [
        env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
        ...(env.COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS?.split(",") ?? []),
        env.COMMUNITY_RETENTION_CHANNEL_ID,
      ]
        .map((id) => id?.trim())
        .filter((id): id is string =>
          Boolean(id && /^[CG][A-Z0-9]+$/.test(id) && id !== env.COMMUNITY_SYS_ALERT_CHANNEL_ID),
        ),
    ),
  ];
}

export async function reconcilePoMembership(env: PoEnv) {
  const channels = poMembershipChannels(env);
  if (!channels.length) throw new InputError("PO 권한 기준 채널을 확인해 주세요.");
  const observedAt = new Date().toISOString();
  const ids = new Set<string>();
  // Collect a complete snapshot before changing any permission. A missing page,
  // archived channel, rate limit or profile failure must not look like an exit.
  for (const channel of channels) {
    let cursor = "";
    const seen = new Set<string>();
    do {
      if (seen.has(cursor)) throw new InputError("PO 채널 목록을 끝까지 확인하지 못했어요.");
      seen.add(cursor);
      const result = await callSlack(env.SLACK_BOT_TOKEN, "conversations.members", {
        channel,
        limit: 200,
        cursor,
      });
      if (!Array.isArray(result.members))
        throw new InputError("PO 채널 회원 목록을 확인하지 못했어요.");
      for (const id of list(result.members)) {
        if (typeof id !== "string" || !/^[UW][A-Z0-9]+$/.test(id))
          throw new InputError("PO 회원 식별자를 확인하지 못했어요.");
        ids.add(id);
      }
      cursor = result.response_metadata
        ? string(object(result.response_metadata).next_cursor ?? "")
        : "";
    } while (cursor);
  }
  const members = [];
  for (const id of [...ids].sort()) {
    const profile = object((await callSlack(env.SLACK_BOT_TOKEN, "users.info", { user: id })).user);
    if (
      profile.id !== id ||
      typeof profile.is_bot !== "boolean" ||
      typeof profile.deleted !== "boolean"
    )
      throw new InputError("PO 회원 상태를 확인하지 못했어요.");
    if (
      profile.is_bot ||
      profile.is_app_user === true ||
      profile.deleted ||
      profile.team_id !== env.SLACK_TEAM_ID
    )
      continue;
    members.push({ userId: id, displayName: String(profile.real_name || id).slice(0, 200) });
  }
  return object(
    await new NeonStore(env.DATABASE_URL).queryJson(
      "SELECT otl.community_po_reconcile($1::jsonb)",
      [
        JSON.stringify({
          teamId: env.SLACK_TEAM_ID,
          observedAt,
          channels,
          members,
          complete: true,
        }),
      ],
    ),
  );
}
