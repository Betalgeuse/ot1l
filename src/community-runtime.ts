import type { ClockBinding } from "./community-clock-binding";
import { callSlack } from "./community-social";
import type { CommunityStore } from "./community-store";
import type { CommunityScope } from "./community-types";
import { InputError, type Json, object, string } from "./input";
import type { IntentAI } from "./intent";

export type CommunityEnv = {
  readonly SLACK_TEAM_ID: string;
  readonly SLACK_BOT_TOKEN: string;
  readonly DATABASE_URL: string;
  readonly GUIDE_DATABASE_URL?: string;
  readonly BOARD_SIGNING_SECRET: string;
  readonly PUBLIC_BASE_URL: string;
  readonly COMMUNITY_ENABLED?: string;
  readonly LIFECYCLE_MODE?: string;
  readonly REVIEW_THREAD_V2?: string;
  readonly GARDEN_RECONCILIATION?: string;
  readonly REFERRALS_ENABLED?: string;
  readonly PUBLIC_APPLICATIONS_ENABLED?: string;
  readonly PUBLIC_INTEREST_ENABLED?: string;
  readonly INTEREST_RUNTIME_DATABASE_URL?: string;
  readonly INTEREST_ADMIN_DATABASE_URL?: string;
  readonly INTEREST_MEMBER_DATABASE_URL?: string;
  readonly INTEREST_ADMIN_CHANNEL_ID?: string;
  readonly INTEREST_ACTION_SECRET?: string;
  readonly SITE_CORE_HMAC_SECRET?: string;
  readonly EVENT_CORE_HMAC_SECRET?: string;
  readonly INVITE_EMAIL_PEPPER?: string;
  readonly LIFECYCLE_ACTION_SECRET?: string;
  readonly LIFECYCLE_ADMIN_DATABASE_URL?: string;
  readonly REFERRAL_ADMIN_DATABASE_URL?: string;
  readonly INVITE_PRIVATE_KEK?: string;
  readonly INVITE_PRIVATE_KEK_VERSION?: string;
  readonly REFERRAL_TOKEN_SECRET?: string;
  readonly PUBLIC_APPLICATION_ORIGIN?: string;
  readonly EVENT_PUBLIC_BASE_URL?: string;
  readonly EVENT_SIGNING_SECRET?: string;
  readonly INVITE_PRIVATE_OBJECTS?: R2Bucket;
  readonly COMMUNITY_BOT_USER_ID?: string;
  readonly DATABASE_MAINTENANCE?: string;
  readonly COMMUNITY_CLOCK?: ClockBinding;
  readonly COMMUNITY_CHANNEL_ID?: string;
  readonly COMMUNITY_ADMIN_ID?: string;
  readonly COMMUNITY_PUBLIC_CHANNEL_ID?: string;
  readonly COMMUNITY_FEEDBACK_CHANNEL_ID?: string;
  readonly COMMUNITY_CODEX_REPOSITORY?: string;
  readonly COMMUNITY_CODEX_BRANCH?: string;
  readonly BUG_RUNNER_ENABLED?: string;
  readonly COMMUNITY_SHAREINFO_CHANNEL_ID?: string;
  readonly COMMUNITY_CHAPTER_CHANNEL_IDS?: string;
  readonly COMMUNITY_RELEASE_CHANNEL_ID?: string;
  readonly COMMUNITY_MAINTAINERS_CHANNEL_ID?: string;
  readonly COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS?: string;
  readonly COMMUNITY_SYS_ALERT_CHANNEL_ID?: string;
  readonly COMMUNITY_RETENTION_CHANNEL_ID?: string;
  readonly MAINTAINER_LINEAR_ENABLED?: string;
  readonly LINEAR_API_KEY?: string;
  readonly LINEAR_ADMIN_API_KEY?: string;
  readonly LINEAR_APP_CLIENT_ID?: string;
  readonly LINEAR_APP_CLIENT_SECRET?: string;
  readonly LINEAR_WEBHOOK_SECRET?: string;
  readonly LINEAR_TEAM_ID?: string;
  readonly LINEAR_ORGANIZATION_ID?: string;
  readonly LINEAR_GUEST_SEAT_LIMIT?: string;
  readonly COMMUNITY_WELCOME_CHANNEL_ID?: string;
  readonly COMMUNITY_GUIDE_FILE_IDS?: string;
  readonly COMMUNITY_GUIDE_CHAPTER_CHANNEL_IDS?: string;
  readonly COMMUNITY_GUIDE_CANVAS_ID?: string;
  readonly COMMUNITY_GUIDE_CANVAS_URL?: string;
  readonly COMMUNITY_GUIDE_ANCHOR_TS?: string;
  readonly COMMUNITY_INTRO_CHANNEL_ID?: string;
  readonly COMMUNITY_INTRO_CANVAS_ID?: string;
  readonly COMMUNITY_INTRO_CANVAS_URL?: string;
  readonly AI?: IntentAI;
  readonly INTENT_RATE_LIMITER?: {
    limit(input: { readonly key: string }): Promise<{ readonly success: boolean }>;
  };
  readonly BUG_PRIVATE_KEK?: string;
  readonly BUG_PRIVATE_KEK_VERSION?: string;
  readonly BUG_PRIVATE_OBJECTS?: {
    put(key: string, value: ArrayBuffer): Promise<unknown>;
    get?(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    delete(key: string): Promise<void>;
  };
};
export type CommunityContext = {
  readonly env: CommunityEnv;
  readonly store: CommunityStore;
  readonly scope: CommunityScope;
  readonly date: string;
  readonly thread: string;
  readonly source: string;
  readonly key: string;
  readonly sourceIsWorkRoot?: boolean;
};
export function scopedValue(scope: CommunityScope, key: string): string {
  return JSON.stringify({ ownerId: scope.userId, key });
}
export function actionIdentity(data: Record<string, unknown>, env: CommunityEnv, actionId = "") {
  const teamId = string(object(data.team).id);
  const userId = string(object(data.user).id);
  const channelId = data.container
    ? string(object(data.container).channel_id)
    : string(object(JSON.parse(string(object(data.view).private_metadata))).channelId);
  const approvalAction = [
    "community_feedback_merge_approve",
    "community_feedback_dri_select",
    "community_pull_request_open",
    "community_pull_request_submit",
    "community_linear_open",
  ].includes(actionId);
  const introductionAction = [
    "community_introduction",
    "community_introduction_submit",
    "community_introduction_directory",
  ].includes(actionId);
  const guideAction = actionId === "community_guide_open";
  const founderApprovalInDm =
    actionId === "community_feedback_merge_approve" &&
    /^D[A-Z0-9]+$/.test(channelId) &&
    userId === env.COMMUNITY_ADMIN_ID;
  const communityActionChannels = [
    env.COMMUNITY_CHANNEL_ID,
    env.COMMUNITY_PUBLIC_CHANNEL_ID,
    env.COMMUNITY_RELEASE_CHANNEL_ID,
    env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
    ...(env.COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS?.split(",").map((id) => id.trim()) ?? []),
    env.COMMUNITY_SYS_ALERT_CHANNEL_ID,
    env.COMMUNITY_INTRO_CHANNEL_ID,
    env.COMMUNITY_FEEDBACK_CHANNEL_ID,
    env.COMMUNITY_WELCOME_CHANNEL_ID,
  ];
  const expandedChannelAllowed =
    (approvalAction && communityActionChannels.includes(channelId)) ||
    founderApprovalInDm ||
    (introductionAction &&
      [
        env.COMMUNITY_RELEASE_CHANNEL_ID,
        env.COMMUNITY_INTRO_CHANNEL_ID,
        env.COMMUNITY_PUBLIC_CHANNEL_ID,
      ].includes(channelId)) ||
    (guideAction &&
      [
        env.COMMUNITY_WELCOME_CHANNEL_ID,
        env.COMMUNITY_PUBLIC_CHANNEL_ID,
        env.COMMUNITY_RELEASE_CHANNEL_ID,
        env.COMMUNITY_INTRO_CHANNEL_ID,
      ].includes(channelId));
  const feedbackActionDenied = channelId === env.COMMUNITY_FEEDBACK_CHANNEL_ID && !approvalAction;
  if (
    teamId !== env.SLACK_TEAM_ID ||
    feedbackActionDenied ||
    (guideAction &&
      ![
        env.COMMUNITY_WELCOME_CHANNEL_ID,
        env.COMMUNITY_PUBLIC_CHANNEL_ID,
        env.COMMUNITY_RELEASE_CHANNEL_ID,
        env.COMMUNITY_INTRO_CHANNEL_ID,
      ].includes(channelId)) ||
    (![env.COMMUNITY_CHANNEL_ID, env.COMMUNITY_PUBLIC_CHANNEL_ID].includes(channelId) &&
      !expandedChannelAllowed) ||
    (channelId === env.COMMUNITY_CHANNEL_ID && userId !== env.COMMUNITY_ADMIN_ID) ||
    !/^[UW][A-Z0-9]+$/.test(userId)
  )
    throw new InputError("이 동작은 사용할 수 없습니다.");
  return { teamId, channelId, userId };
}
export async function post(context: CommunityContext, message: Json): Promise<string> {
  const payload = payloadRecord(message);
  const result = await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
    ...payload,
    channel: context.scope.channelId,
    thread_ts: context.thread,
  });
  return string(result.ts);
}
export async function textReply(context: CommunityContext, text: string): Promise<void> {
  await post(context, { text });
}

export async function ephemeral(context: CommunityContext, message: Json): Promise<string> {
  const result = await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postEphemeral", {
    ...payloadRecord(message),
    channel: context.scope.channelId,
    user: context.scope.userId,
  });
  return string(result.message_ts);
}

export function payloadRecord(value: Json): { readonly [key: string]: Json } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InputError("메시지 형식이 올바르지 않습니다.");
  return Object.fromEntries(Object.entries(value));
}
