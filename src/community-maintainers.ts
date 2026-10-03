import { type CommunityContext, ephemeral } from "./community-runtime";
import { CommunitySlackError, callSlack } from "./community-social";
import type { Json } from "./input";

export function maintainerButton(label = "Maintainer 되기"): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    style: "primary",
    action_id: "community_maintainer_activate",
    value: JSON.stringify({ ownerId: "actor", key: "maintainer-self-activate" }),
    accessibility_label: "OT1L 공동 운영자 Maintainer로 참여하기",
  };
}

function maintainerChannels(context: CommunityContext): readonly string[] {
  return [
    context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
    ...(context.env.COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS?.split(",") ?? []),
  ].filter((channel): channel is string => Boolean(channel && /^[CG][A-Z0-9]+$/.test(channel)));
}

async function changeMaintainerChannels(
  context: CommunityContext,
  method: "conversations.invite" | "conversations.kick",
): Promise<void> {
  for (const channel of maintainerChannels(context))
    try {
      await callSlack(context.env.SLACK_BOT_TOKEN, method, {
        channel,
        ...(method === "conversations.invite"
          ? { users: context.scope.userId }
          : { user: context.scope.userId }),
      });
    } catch (error) {
      if (
        error instanceof CommunitySlackError &&
        ["already_in_channel", "not_in_channel"].includes(error.code)
      )
        continue;
      throw error;
    }
}

export async function activateMaintainer(context: CommunityContext): Promise<void> {
  const maintainer = await context.store.activateMaintainer(
    context.scope.teamId,
    context.scope.userId,
  );
  await changeMaintainerChannels(context, "conversations.invite");
  await ephemeral(context, {
    text: `Maintainer가 활성화됐어요. Open 변경은 검증 뒤 직접 승인·병합·배포할 수 있어요.${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID ? ` <#${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID}>에서 운영 논의를 이어가 주세요.` : ""}`,
  });
  if (context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID)
    await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel: context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
      text: `<@${maintainer.userId}>님이 OT1L Maintainer로 참여했어요. 함께 만들고 운영해요!`,
    });
}

export async function deactivateMaintainer(context: CommunityContext): Promise<void> {
  await context.store.deactivateMaintainer(context.scope.teamId, context.scope.userId);
  await changeMaintainerChannels(context, "conversations.kick");
  await ephemeral(context, {
    text: "Maintainer 역할을 내려놓았어요. 언제든 다시 활성화할 수 있어요.",
  });
}
