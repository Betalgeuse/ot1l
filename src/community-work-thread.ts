import { MaintainerOpsStore } from "./community-maintainer-store";
import type { CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { list, object, string } from "./input";

type WorkThreadEnv = Pick<
  CommunityEnv,
  | "SLACK_TEAM_ID"
  | "SLACK_BOT_TOKEN"
  | "DATABASE_URL"
  | "COMMUNITY_ADMIN_ID"
  | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
>;

function isWorkRoot(message: Record<string, unknown>, key: string): boolean {
  if (!message.bot_id && !message.app_id) return false;
  if (message.thread_ts !== undefined && message.thread_ts !== message.ts) return false;
  if (typeof message.text !== "string") return false;
  return /버그 키:?\s+(BUG-[A-Z0-9-]+)\s*$/.exec(message.text)?.[1] === key;
}

export async function rememberWorkThread(
  env: WorkThreadEnv,
  key: string,
  ts: string,
): Promise<void> {
  if (!env.DATABASE_URL || !env.COMMUNITY_ADMIN_ID || !env.COMMUNITY_MAINTAINERS_CHANNEL_ID) return;
  await new MaintainerOpsStore(env).execute("surface_put", {
    workKey: key,
    channelId: env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
    messageTs: ts,
  });
}

export async function resolveWorkThread(env: WorkThreadEnv, key: string): Promise<string | null> {
  const channel = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
  if (!channel) return null;
  if (env.DATABASE_URL && env.COMMUNITY_ADMIN_ID) {
    const saved = await new MaintainerOpsStore(env).execute("surface_get", {
      workKey: key,
      channelId: channel,
    });
    if (typeof saved === "string") {
      const exact = await callSlack(env.SLACK_BOT_TOKEN, "conversations.history", {
        channel,
        oldest: saved,
        latest: saved,
        inclusive: true,
        limit: 1,
      });
      if (
        list(exact.messages)
          .map(object)
          .some((message) => message.ts === saved && isWorkRoot(message, key))
      )
        return saved;
    }
  }
  const history = await callSlack(env.SLACK_BOT_TOKEN, "conversations.history", {
    channel,
    limit: 200,
  });
  const root = list(history.messages)
    .map(object)
    .find((message) => isWorkRoot(message, key));
  if (!root) return null;
  const ts = string(root.ts);
  await rememberWorkThread(env, key, ts);
  return ts;
}
