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
  method: "conversations.invite",
): Promise<void> {
  for (const channel of maintainerChannels(context))
    try {
      await callSlack(context.env.SLACK_BOT_TOKEN, method, {
        channel,
        users: context.scope.userId,
      });
    } catch (error) {
      if (error instanceof CommunitySlackError && error.code === "already_in_channel") continue;
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
    text: `Maintainer가 활성화됐어요. 공개 GitHub 저장소를 fork해 본인 환경에서 개발하고 PR을 올려 주세요. Open 변경은 Slack에서 정확한 SHA를 승인하면 Deployment Broker가 병합·배포하고, Core 변경은 Founder 승인이 필요해요. <https://github.com/Betalgeuse/ot1l/blob/main/CONTRIBUTING.md|개발 시작 안내>${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID ? ` · <#${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID}>` : ""}`,
  });
  if (context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID)
    await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel: context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
      text: `<@${maintainer.userId}>님이 OT1L Maintainer로 참여했어요. 함께 만들고 운영해요!`,
    });
}

export async function deactivateMaintainer(context: CommunityContext): Promise<void> {
  await context.store.deactivateMaintainer(context.scope.teamId, context.scope.userId);
  await ephemeral(context, {
    text: "Maintainer 승인 권한을 내려놓았어요. 공개 채널은 그대로 볼 수 있고, 언제든 다시 활성화할 수 있어요.",
  });
}
