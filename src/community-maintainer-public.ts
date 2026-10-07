import { MaintainerOpsStore } from "./community-maintainer-store";
import { authenticateReferralServiceRequest } from "./community-referral-service-auth";
import type { CommunityEnv } from "./community-runtime";
import { list, object, string } from "./input";

type PublicEnv = Pick<
  CommunityEnv,
  | "DATABASE_URL"
  | "SLACK_TEAM_ID"
  | "COMMUNITY_ADMIN_ID"
  | "SITE_CORE_HMAC_SECRET"
  | "COMMUNITY_FEEDBACK_CHANNEL_ID"
  | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
>;

const PUBLIC_STAGE = {
  inbox: {
    lane: "proposed",
    statusLabel: "제안됨",
    progressSummary: "의견을 확인하고 다음 행동을 정하는 단계예요.",
    nextActionLabel: "DRI와 작업 범위 정하기",
  },
  in_progress: {
    lane: "doing",
    statusLabel: "진행 중",
    progressSummary: "담당자가 해결안을 만들고 있어요.",
    nextActionLabel: "해결안 검증하기",
  },
  review: {
    lane: "review_release",
    statusLabel: "검토 중",
    progressSummary: "변경 내용과 실제 동작을 확인하고 있어요.",
    nextActionLabel: "승인과 반영 여부 확인하기",
  },
  blocked: {
    lane: "needs_help",
    statusLabel: "도움 필요",
    progressSummary: "추가 논의나 도움이 필요한 상태예요.",
    nextActionLabel: "Slack에서 의견 보태기",
  },
  deploying: {
    lane: "review_release",
    statusLabel: "반영 중",
    progressSummary: "승인된 변경을 운영에 반영하고 있어요.",
    nextActionLabel: "운영 확인 기다리기",
  },
  done: {
    lane: "done",
    statusLabel: "완료",
    progressSummary: "운영 반영과 실제 동작 확인을 마쳤어요.",
    nextActionLabel: "결과 확인하기",
  },
} as const;

export async function handleMaintainerPublicRequest(
  request: Request,
  env: PublicEnv,
): Promise<Response> {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/internal/maintainers/status")
    return new Response("Not found", { status: 404 });
  if (Number(request.headers.get("content-length") ?? "0") > 128)
    return new Response("Request too large", { status: 413 });
  const body = await request.text();
  if (
    !(await authenticateReferralServiceRequest({
      request,
      body,
      secret: env.SITE_CORE_HMAC_SECRET,
      store: { claimServiceNonce: async () => true },
      persistNonce: false,
    }))
  )
    return new Response("Unauthorized", { status: 401 });
  if (body !== "{}") return new Response("Invalid request", { status: 400 });
  const items = list(await new MaintainerOpsStore(env).execute("public_work_list", {})).map(
    (value) => {
      const item = object(value);
      const stage = string(item.stage);
      if (!Object.hasOwn(PUBLIC_STAGE, stage))
        throw new TypeError("invalid public Product Owner stage");
      const status = PUBLIC_STAGE[stage as keyof typeof PUBLIC_STAGE];
      const sourceChannel = string(item.sourceChannel);
      const sourceLabel =
        sourceChannel === env.COMMUNITY_MAINTAINERS_CHANNEL_ID
          ? "PO 제안"
          : sourceChannel === env.COMMUNITY_FEEDBACK_CHANNEL_ID
            ? "회원 피드백"
            : "커뮤니티 제안";
      return {
        title: string(item.title),
        ...status,
        hasDri: item.hasDri === true,
        sourceLabel,
        slackUrl: `https://app.slack.com/client/${env.SLACK_TEAM_ID}/${sourceChannel}/thread/${sourceChannel}-${string(item.sourceThread)}`,
        updatedAt: string(item.updatedAt),
      };
    },
  );
  return Response.json({ items }, { headers: { "cache-control": "public, max-age=30" } });
}
