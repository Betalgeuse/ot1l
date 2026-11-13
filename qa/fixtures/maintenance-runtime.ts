export { CommunityClock } from "../../src/community-clock";
// Drives one live maintenance task through its own Durable Object, the way the cron coordinator does.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const at = Date.parse(url.searchParams.get("at") ?? "2026-10-12T10:01:00Z");
    const stub = env.COMMUNITY_CLOCK.getByName("maintenance-task:TQA:pr_metadata:team");
    let status = 200;
    try { await stub.runMaintenanceTask("pr_metadata", at, undefined); } catch { status = 500; }
    return Response.json(await stub.inspect(), { status });
  },
};
