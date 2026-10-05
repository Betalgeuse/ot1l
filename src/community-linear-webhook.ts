import { configuredLinearTeam } from "./community-linear-client";
import { MaintainerOpsStore } from "./community-maintainer-store";
import { refreshMaintainerWorkSurfaces } from "./community-maintainer-work";
import type { CommunityEnv } from "./community-runtime";
import { list, object, string } from "./input";
import { verify } from "./signing";

type LinearWebhookEnv = Pick<
  CommunityEnv,
  | "DATABASE_URL"
  | "SLACK_TEAM_ID"
  | "SLACK_BOT_TOKEN"
  | "COMMUNITY_ADMIN_ID"
  | "COMMUNITY_FEEDBACK_CHANNEL_ID"
  | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
  | "MAINTAINER_LINEAR_ENABLED"
  | "LINEAR_API_KEY"
  | "LINEAR_ADMIN_API_KEY"
  | "LINEAR_WEBHOOK_SECRET"
  | "LINEAR_TEAM_ID"
  | "LINEAR_ORGANIZATION_ID"
  | "LINEAR_GUEST_SEAT_LIMIT"
>;

async function boundedBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? "0") > 65_536) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > 65_536) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function stage(state: Record<string, unknown>): string {
  if (state.type === "completed") return "운영 확인 대기";
  if (state.type === "canceled" || state.type === "duplicate") return "종료";
  if (state.name === "In Review") return "검토·승인 중";
  if (state.name === "In Progress" || state.type === "started") return "작업 중";
  if (state.type === "unstarted") return "담당자 지정됨";
  return "접수됨";
}

export async function handleLinearWebhook(
  request: Request,
  env: LinearWebhookEnv,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  if (request.method !== "POST" || env.MAINTAINER_LINEAR_ENABLED !== "true")
    return new Response("Unavailable", { status: 503 });
  const raw = await boundedBody(request);
  if (raw === null) return new Response("Invalid request", { status: 413 });
  const signature = request.headers.get("linear-signature") ?? "";
  if (!env.LINEAR_WEBHOOK_SECRET || !(await verify(raw, signature, env.LINEAR_WEBHOOK_SECRET)))
    return new Response("Unauthorized", { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = object(JSON.parse(raw));
  } catch {
    return new Response("Invalid request", { status: 400 });
  }
  const timestamp = Number(payload.webhookTimestamp);
  const delivery = request.headers.get("linear-delivery") ?? string(payload.webhookId ?? "");
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() - timestamp) > 60_000 ||
    !/^[a-f0-9-]{36}$/i.test(delivery) ||
    payload.organizationId !== env.LINEAR_ORGANIZATION_ID
  )
    return new Response("Unauthorized", { status: 401 });
  if (payload.type !== "Issue") return new Response(null, { status: 200 });
  try {
    const data = object(payload.data);
    const teamId = data.teamId ?? (data.team ? object(data.team).id : undefined);
    if (teamId !== configuredLinearTeam(env)) return new Response(null, { status: 200 });
    const store = new MaintainerOpsStore(env);
    if ((await store.execute("receipt_claim", { receiptKey: `linear:${delivery}` })) !== true)
      return new Response(null, { status: 200 });
    const issueId = string(data.id);
    const workValue = await store.execute("work_by_issue", { issueId });
    if (workValue === null) return new Response(null, { status: 200 });
    const work = object(workValue);
    const members = list(await store.execute("members", {})).map(object);
    const assignee = data.assignee ? object(data.assignee) : null;
    const dri = assignee
      ? members.find((member) => member.linearUserId === assignee.id)?.userId
      : null;
    const state = object(data.state);
    await store.execute("work_sync", {
      workKey: string(work.work_key),
      linearTeamId: configuredLinearTeam(env),
      identifier: string(data.identifier),
      url: string(data.url),
      issueState: stage(state),
      driUserId: typeof dri === "string" ? dri : null,
      linearUpdatedAt: string(data.updatedAt),
    });
    waitUntil(
      refreshMaintainerWorkSurfaces(env, string(work.work_key)).catch((error: unknown) =>
        console.error(
          JSON.stringify({
            event: "community.linear.surface_refresh_failed",
            errorType: error instanceof Error ? error.name : "Unknown",
          }),
        ),
      ),
    );
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "community.linear.webhook_failed",
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
    return new Response("Retry", { status: 500 });
  }
}
