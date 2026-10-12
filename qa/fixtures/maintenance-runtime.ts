import { communityMaintenanceCron } from "../../src/community-cron";
export { CommunityClock } from "../../src/community-clock";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const at = Date.parse(url.searchParams.get("at") ?? "2026-10-12T10:56:00Z");
    let status = 200;
    try { await communityMaintenanceCron(env, at); } catch { status = 500; }
    const state = await env.COMMUNITY_CLOCK.getByName("maintenance-task:TQA:chapter_math:team").inspect();
    return Response.json(state, { status });
  },
};
