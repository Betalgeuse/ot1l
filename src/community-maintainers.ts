import { type CommunityContext, ephemeral } from "./community-runtime";
import { CommunitySlackError, callSlack } from "./community-social";
import { InputError, type Json, object } from "./input";
import { PRODUCT_OWNER_BUTTON } from "./slack-presentation/product-owner-actions";

export function maintainerButton(label: string = PRODUCT_OWNER_BUTTON.label): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    style: PRODUCT_OWNER_BUTTON.style,
    action_id: "community_maintainer_activate",
    value: JSON.stringify({ ownerId: "actor", key: "maintainer-self-activate" }),
    accessibility_label: PRODUCT_OWNER_BUTTON.accessibilityLabel,
  };
}

function maintainerChannels(context: CommunityContext): readonly string[] {
  return [
    ...new Set(
      [
        context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
        ...(context.env.COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS?.split(",").map((id) =>
          id.trim(),
        ) ?? []),
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
      text: `이미 Product Owner예요. 공개 채널 가입 상태를 다시 확인했습니다.${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID ? ` <#${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID}>에서 이어가 주세요.` : ""}`,
    });
    return;
  }
  await ephemeral(context, {
    text: `Product Owner가 활성화됐어요. 보통은 ‘피드백·AI 수정 요청’에 문제와 원하는 결과를 적으면 Codex가 수정·검사·PR 생성을 맡아요. 결과를 확인하고 승인하면 병합·배포됩니다. 본인 개발환경에서 직접 PR을 만들었을 때만 ‘직접 만든 PR 검토 요청’을 사용하세요. 보호 영역 변경은 Founder 승인이 필요해요. <https://github.com/Betalgeuse/ot1l/blob/main/CONTRIBUTING.md|참여 안내>${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID ? ` · <#${context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID}>` : ""}${context.env.COMMUNITY_SYS_ALERT_CHANNEL_ID ? ` · 운영 알림 <#${context.env.COMMUNITY_SYS_ALERT_CHANNEL_ID}>` : ""}`,
  });
  if (context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID)
    await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel: context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
      text: `<@${maintainer.userId}>님이 OT1L Product Owner로 참여했어요. 함께 만들고 운영해요!`,
    });
}

export async function deactivateMaintainer(context: CommunityContext): Promise<void> {
  await ephemeral(context, {
    text: "PO 권한은 PO 채널 참여와 연결돼 있어요. 참여 중인 PO 채널에서 모두 나가면 권한도 해제됩니다. sys-alert 가입 여부는 PO 권한에 영향을 주지 않습니다.",
  });
}
