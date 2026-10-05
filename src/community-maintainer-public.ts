import { MaintainerOpsStore } from "./community-maintainer-store";
import { authenticateReferralServiceRequest } from "./community-referral-service-auth";
import type { CommunityEnv } from "./community-runtime";
import { list, object, string } from "./input";

type PublicEnv = Pick<
  CommunityEnv,
  "DATABASE_URL" | "SLACK_TEAM_ID" | "COMMUNITY_ADMIN_ID" | "SITE_CORE_HMAC_SECRET"
>;

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
      return {
        key: string(item.key),
        title: string(item.title),
        stage: string(item.stage),
        identifier: item.identifier === null ? null : string(item.identifier),
        sourceChannel: string(item.sourceChannel),
        sourceThread: string(item.sourceThread),
        slackUrl: `https://app.slack.com/client/${env.SLACK_TEAM_ID}/${string(item.sourceChannel)}/thread/${string(item.sourceChannel)}-${string(item.sourceThread)}`,
        updatedAt: string(item.updatedAt),
      };
    },
  );
  return Response.json({ items }, { headers: { "cache-control": "public, max-age=30" } });
}
