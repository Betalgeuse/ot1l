import { handleCommunityAction } from "./community-action-interactions";
import { authorizeCommunityAction } from "./community-permissions";
import { actionIdentity, type CommunityContext, type CommunityEnv } from "./community-runtime";
import { CommunityStore } from "./community-store";
import { handleCommunityView } from "./community-view-interactions";
import { date, InputError, koreaDate, object, string } from "./input";
import { NeonStore } from "./store";

export async function communityInteraction(
  data: Record<string, unknown>,
  env: CommunityEnv,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response | null> {
  if (env.COMMUNITY_ENABLED !== "true") return null;
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const action = actions[0] ? object(actions[0]) : null;
  const view = data.view ? object(data.view) : null;
  const id = string(action?.action_id ?? view?.callback_id ?? "");
  if (!id.startsWith("community_")) return null;
  const scope = actionIdentity(data, env, id);
  authorizeCommunityAction(id, scope, env);
  if (
    (data.type === "view_submission") !== id.endsWith("_submit") ||
    !["view_submission", "block_actions"].includes(string(data.type))
  )
    throw new InputError("지원하지 않는 요청 형식입니다.");
  if (id === "community_guide_open") return new Response(null, { status: 200 });
  const metadata = view ? object(JSON.parse(string(view.private_metadata))) : null;
  if (metadata && metadata.userId !== scope.userId)
    throw new InputError("본인이 연 화면에서 다시 시도해 주세요.");
  const store = new CommunityStore(new NeonStore(env.DATABASE_URL));
  const message = data.message ? object(data.message) : null;
  const container = data.container ? object(data.container) : null;
  const source = metadata ? string(metadata.source) : string(message?.ts ?? container?.message_ts);
  const thread = metadata
    ? string(metadata.thread)
    : string(message?.thread_ts ?? container?.thread_ts ?? message?.ts ?? container?.message_ts);
  const context: CommunityContext = {
    env,
    scope,
    store,
    source,
    thread,
    date: metadata ? date(metadata.date) : koreaDate(Date.now() / 1000),
    key: `interaction:${action?.action_ts ?? view?.id}`,
  };
  if (view) {
    if (!metadata) throw new InputError("화면 정보를 확인할 수 없어요.");
    return handleCommunityView({
      id,
      view,
      metadata,
      context,
      store,
      scope,
      env,
      thread,
      waitUntil,
    });
  }
  if (!action) throw new InputError("동작 정보를 확인할 수 없어요.");
  return handleCommunityAction({
    id,
    action,
    data,
    scope,
    context,
    waitUntil,
  });
}
