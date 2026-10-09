import { notificationThread } from "./community-notification-thread";
import type { CommunityContext } from "./community-runtime";
import { callSlack } from "./community-social";
import { object, string } from "./input";

// Encouragement is an optional reply, never a channel announcement. In
// particular, old review modals can refer to a deleted garden/prompt message.
export async function deliverEncouragement(
  context: CommunityContext,
  text: string,
): Promise<boolean> {
  const channel = context.scope.channelId;
  const thread = context.thread;
  if (!/^\d+[.]\d{6}$/.test(thread)) return false;
  const key = `${context.scope.userId}:${context.date}:${context.key}`;
  const accepted = (messages: Record<string, unknown>[]) =>
    messages.some((message) => {
      const metadata = object(message.metadata ?? {});
      const receipt = object(metadata.event_payload ?? {});
      return (
        Boolean(message.bot_id || message.app_id) &&
        message.thread_ts === thread &&
        message.ts !== thread &&
        metadata.event_type === "otl1_encouragement" &&
        receipt.delivery_key === key
      );
    });
  const before = await notificationThread(context.env.SLACK_BOT_TOKEN, channel, thread);
  if (!before) return false;
  if (accepted(before)) return true;
  let posted: Record<string, unknown>;
  try {
    posted = await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel,
      thread_ts: thread,
      reply_broadcast: false,
      text,
      metadata: { event_type: "otl1_encouragement", event_payload: { delivery_key: key } },
    });
  } catch (error) {
    // Do not repost after a lost response without reconciling Slack acceptance.
    const after = await notificationThread(context.env.SLACK_BOT_TOKEN, channel, thread);
    if (after && accepted(after)) return true;
    throw error;
  }
  if (object(posted.message ?? {}).thread_ts !== thread) {
    // Slack can turn an invalid thread_ts into a top-level post. Reclaim only
    // this exact newly-created bot message; never delete the parent or replies.
    await callSlack(context.env.SLACK_BOT_TOKEN, "chat.delete", { channel, ts: string(posted.ts) });
    throw new Error("encouragement parent disappeared");
  }
  return true;
}
