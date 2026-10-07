import { type CommunityContext, ephemeral } from "./community-runtime";
import { CommunitySlackError, callSlack } from "./community-social";
import { InputError, type Json, object } from "./input";

export function maintainerButton(label = "Product Owner 되기"): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    style: "primary",
    action_id: "community_maintainer_activate",
    value: JSON.stringify({ ownerId: "actor", key: "maintainer-self-activate" }),
    accessibility_label: "OT1L Product Owner로 참여하기",
  };
}

function maintainerChannels(context: CommunityContext): readonly string[] {
  return [
    ...new Set(
      [
        context.env.COMMUNITY_PO_CHANNEL_ID,
        context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
        ...(context.env.COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS?.split(",")
          .map((id) => id.trim())
          .filter(Boolean)
          .slice(0, context.env.COMMUNITY_PO_CHANNEL_ID ? 2 : 3) ?? []),
        context.env.COMMUNITY_SYS_ALERT_CHANNEL_ID,
      ].filter((channel): channel is string => Boolean(channel && /^[CG][A-Z0-9]+$/.test(channel))),
    ),
  ];
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
  const profile = object(
    (await callSlack(context.env.SLACK_BOT_TOKEN, "users.info", { user: context.scope.userId }))
      .user,
  );
  if (
    profile.id !== context.scope.userId ||
    profile.is_bot !== false ||
    profile.is_app_user === true ||
    profile.deleted === true ||
    (profile.team_id !== undefined && profile.team_id !== context.scope.teamId)
  )
    throw new InputError("현재 워크스페이스의 회원 계정으로 참여해 주세요.");
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state ===
    "revoked"
  )
    throw new InputError("Product Owner 참여가 제한된 계정이에요. 운영자에게 문의해 주세요.");
  await context.store.syncMaintainerProfile(
    context.scope.teamId,
    context.scope.userId,
    typeof profile.real_name === "string" && profile.real_name.trim()
      ? profile.real_name.trim()
      : context.scope.userId,
  );
  await changeMaintainerChannels(context, "conversations.invite");
  const maintainer = await context.store.activateMaintainer(
    context.scope.teamId,
    context.scope.userId,
  );
  if (!maintainer.changed) {
    await ephemeral(context, {
      text: `이미 Product Owner예요. 다섯 PO 채널 가입 상태를 다시 확인했습니다.${context.env.COMMUNITY_PO_CHANNEL_ID ? ` <#${context.env.COMMUNITY_PO_CHANNEL_ID}>에서 대화를 이어가 주세요.` : ""}`,
    });
    return;
  }
  await ephemeral(context, {
    text: `Product Owner가 활성화됐어요. 대화는${context.env.COMMUNITY_PO_CHANNEL_ID ? ` <#${context.env.COMMUNITY_PO_CHANNEL_ID}>` : " #po"}, DRI·상태·승인·배포 작업의 정본은${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID ? ` <#${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID}>` : " #po-work"}에서 확인해 주세요. 공개 GitHub 저장소를 fork해 본인 환경에서 개발하고 PR을 올릴 수 있어요. <https://github.com/Betalgeuse/ot1l/blob/main/CONTRIBUTING.md|개발 시작 안내>`,
  });
  if (context.env.COMMUNITY_PO_CHANNEL_ID)
    await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel: context.env.COMMUNITY_PO_CHANNEL_ID,
      text: `<@${maintainer.userId}>님이 OT1L Product Owner로 참여했어요. 함께 만들고 운영해요!`,
    });
}

export async function deactivateMaintainer(context: CommunityContext): Promise<void> {
  await context.store.deactivateMaintainer(context.scope.teamId, context.scope.userId);
  await ephemeral(context, {
    text: "Product Owner 승인 권한을 내려놓았어요. 공개 채널은 그대로 볼 수 있고, 언제든 다시 활성화할 수 있어요.",
  });
}
