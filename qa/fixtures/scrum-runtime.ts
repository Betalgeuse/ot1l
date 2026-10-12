// Local workerd harness only. This route is not exported by the production entry.
import { createWorkerHandler } from "../../src/worker-entry";
export { CommunityClock } from "../../src/community-clock";
const worker = createWorkerHandler(async () => new Response("unused"));
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let status = 200;
    try {
      await worker.scheduled({ cron: url.searchParams.get("cron") ?? "*/5 * * * *",
        scheduledTime: Date.parse(url.searchParams.get("at") ?? "2026-10-12T01:00:00Z") }, env, ctx);
    } catch { status = 500; }
    return Response.json(await env.COMMUNITY_CLOCK.getByName("scrum:TQA:CPUBLIC").inspect(), {status});
  },
};
