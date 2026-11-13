// Deploy approval path: a Founder or active Product Owner approves the exact verified PR SHA in
// Slack, and the Deployment Broker deploys only after this approval is recorded. This module and
// its Slack actions are core. They must not depend on the feedback intake or maintainer prompt
// files, so those can be deleted without breaking production deploys.

import { assignMaintainerWork } from "./community-maintainer-work";
import { reconcilePoMembership } from "./community-po-membership";
import {
  openPullRequestBindingModal,
  pullRequestFormErrors,
  submitPullRequestBinding,
} from "./community-pull-request";
import { type CommunityContext, ephemeral } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, object, string } from "./input";
import { NeonStore } from "./store";

export const DEPLOY_APPROVAL_ACTION_IDS = [
  "community_feedback_merge_approve",
  "community_feedback_dri_select",
  "community_pull_request_open",
  "community_pull_request_submit",
  "community_linear_open",
] as const;

type WaitUntil = (promise: Promise<unknown>) => void;

export async function approveCodexMerge(
  context: CommunityContext,
  input: {
    readonly feedbackId: string;
    readonly packetRevision: number;
    readonly prNumber: number;
    readonly changeClass: string;
    readonly headSha: string;
    readonly classificationDigest: string;
  },
): Promise<void> {
  const database = new NeonStore(context.env.DATABASE_URL);
  const approvalContext = object(
    await database.queryJson("SELECT otl.bug_merge_approval_context($1::jsonb)", [
      JSON.stringify({
        teamId: context.scope.teamId,
        bugId: input.feedbackId,
        actorId: context.scope.userId,
        packetRevision: input.packetRevision,
        prNumber: input.prNumber,
      }),
    ]),
  );
  if (
    approvalContext.classified !== true ||
    approvalContext.changeClass !== input.changeClass ||
    approvalContext.headSha !== input.headSha ||
    approvalContext.classificationDigest !== input.classificationDigest
  )
    throw new InputError("변경 분류나 승인 SHA가 바뀌었어요. 최신 검증 결과를 다시 확인해 주세요.");
  if (
    approvalContext.changeClass === "core" &&
    context.scope.userId !== context.env.COMMUNITY_ADMIN_ID
  )
    throw new InputError("Core 변경은 Founder만 승인할 수 있어요.");
  if (
    approvalContext.changeClass === "open" &&
    approvalContext.maintainer !== true &&
    context.scope.userId !== context.env.COMMUNITY_ADMIN_ID
  )
    throw new InputError("활성 Product Owner 또는 Founder만 Open 변경을 승인할 수 있어요.");
  const approved = object(
    await database.queryJson("SELECT otl.bug_actor_approve_merge($1::jsonb)", [
      JSON.stringify({
        teamId: context.scope.teamId,
        bugId: input.feedbackId,
        actorId: context.scope.userId,
        founderId: context.env.COMMUNITY_ADMIN_ID,
        packetRevision: input.packetRevision,
        prNumber: input.prNumber,
        headSha: input.headSha,
        classificationDigest: input.classificationDigest,
        idempotencyKey: `merge-approval:${input.feedbackId}:${input.prNumber}:${context.scope.userId}`,
      }),
    ]),
  );
  if (approved.accepted !== true) throw new InputError("이 수정안은 지금 병합할 수 없어요.");
  const repository = context.env.COMMUNITY_CODEX_REPOSITORY;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new InputError("GenQuant 작업 저장소 연결을 확인해 주세요.");
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.update", {
    channel: context.scope.channelId,
    ts: context.source,
    text: `병합 승인됨 · PR #${input.prNumber} 반영 중`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*병합 승인됨*\n<https://github.com/${repository}/pull/${input.prNumber}|변경 내용 보기> · 반영 중`,
        },
      },
    ],
  });
}

export async function handleDeployApprovalAction(
  id: string,
  context: CommunityContext,
  key: string,
  value: Record<string, unknown>,
  triggerId: unknown,
  waitUntil: WaitUntil,
): Promise<Response | null> {
  if (id === "community_feedback_merge_approve") {
    const packetRevision = value.packetRevision;
    const prNumber = value.prNumber;
    if (
      typeof packetRevision !== "number" ||
      !Number.isSafeInteger(packetRevision) ||
      typeof prNumber !== "number" ||
      !Number.isSafeInteger(prNumber)
    )
      throw new InputError("병합 승인 대상을 확인할 수 없어요.");
    waitUntil(
      (async () => {
        if (context.scope.userId !== context.env.COMMUNITY_ADMIN_ID)
          await reconcilePoMembership(context.env);
        await approveCodexMerge(context, {
          feedbackId: string(value.feedbackId),
          packetRevision,
          prNumber,
          changeClass: string(value.changeClass),
          headSha: string(value.headSha),
          classificationDigest: string(value.classificationDigest),
        });
      })().catch(async (error: unknown) => {
        await ephemeral(context, {
          text:
            error instanceof InputError
              ? error.message
              : "PO 권한과 승인 상태를 확인하지 못했어요. 잠시 후 다시 눌러 주세요.",
        });
      }),
    );
    return new Response(null, { status: 200 });
  }
  if (id === "community_pull_request_open") {
    await openPullRequestBindingModal(
      context,
      string(triggerId),
      key.startsWith("BUG-") ? key : undefined,
    );
    return new Response(null, { status: 200 });
  }
  if (id === "community_feedback_dri_select") {
    waitUntil(
      assignMaintainerWork(context, key, string(value.driUserId)).catch(async (error: unknown) => {
        console.error(
          JSON.stringify({
            event: "community.maintainer.dri_assignment_failed",
            errorType: error instanceof Error ? error.name : "Unknown",
          }),
        );
        await ephemeral(context, {
          text:
            error instanceof InputError
              ? error.message
              : "DRI 변경을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        });
      }),
    );
    return new Response(null, { status: 200 });
  }
  if (id === "community_linear_open") return new Response(null, { status: 200 });
  return null;
}

export function handleDeployApprovalView(
  id: string,
  view: Record<string, unknown>,
  context: CommunityContext,
  waitUntil: WaitUntil,
): Response | null {
  if (id !== "community_pull_request_submit") return null;
  const errors = pullRequestFormErrors(view);
  if (errors) return Response.json({ response_action: "errors", errors });
  waitUntil(
    submitPullRequestBinding(context, view).catch(async (error: unknown) => {
      await ephemeral(context, {
        text:
          error instanceof InputError
            ? error.message
            : "PR 연결을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    }),
  );
  return Response.json({ response_action: "clear" });
}
