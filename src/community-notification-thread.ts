import { CommunitySlackError, callSlack } from "./community-social";
import { type Json, list, object, string } from "./input";

export async function notificationThread(token: string, channel: string, ts: string) {
  const messages: Record<string, unknown>[] = [];
  let cursor = "";
  do {
    let page: Record<string, unknown>;
    try {
      page = await callSlack(token, "conversations.replies", {
        channel,
        ts,
        limit: 100,
        include_all_metadata: "true",
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      if (
        error instanceof CommunitySlackError &&
        ["thread_not_found", "message_not_found"].includes(error.code)
      )
        return null;
      throw error;
    }
    messages.push(...list(page.messages).map(object));
    cursor =
      typeof object(page.response_metadata ?? {}).next_cursor === "string"
        ? String(object(page.response_metadata).next_cursor)
        : "";
    if (page.has_more === true && !cursor) throw new Error("notification thread incomplete");
  } while (cursor);
  return messages.some((message) => message.ts === ts && message.subtype !== "tombstone")
    ? messages
    : null;
}

// Reconcile external acceptance before retrying any notification side effect.
export async function postNotificationReply(
  token: string,
  channel: string,
  threadTs: string,
  notificationId: number,
  message: { text: string; blocks?: Json[] },
): Promise<boolean> {
  const thread = await notificationThread(token, channel, threadTs);
  if (!thread) return false;
  if (
    thread.some((reply) => {
      const metadata = object(reply.metadata ?? {});
      const receipt = object(metadata.event_payload ?? {});
      return (
        (metadata.event_type === "otl1_agent_notification" &&
          receipt.notification_id === String(notificationId)) ||
        ((reply.bot_id || reply.app_id) &&
          reply.ts !== threadTs &&
          String(reply.text).replaceAll(":white_check_mark:", "✅") === message.text)
      );
    })
  )
    return true;
  const posted = await callSlack(token, "chat.postMessage", {
    channel,
    thread_ts: threadTs,
    reply_broadcast: false,
    ...message,
    metadata: {
      event_type: "otl1_agent_notification",
      event_payload: { notification_id: String(notificationId) },
    },
  });
  // Slack may accept a vanished parent as a new root. Remove that exact new post.
  if (object(posted.message ?? {}).thread_ts !== threadTs) {
    await callSlack(token, "chat.delete", { channel, ts: string(posted.ts) });
    throw new Error("notification parent disappeared");
  }
  return true;
}
