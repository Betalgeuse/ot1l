import { CommunityClock } from "../../src/community-clock";
// Test-only controls. Production exports CommunityClock, never this subclass.
export class InterruptedClock extends CommunityClock {
  async armTest() {
    await this.ctx.storage.put("role", "community_schedule");
    await this.ctx.storage.put("channel", "CQA");
    await this.ctx.storage.setAlarm(Date.now() + 20);
  }
  interruptTest() { this.ctx.abort("synthetic alarm interruption"); }
}
export default {
  async fetch(request, env) {
    const stub=env.COMMUNITY_CLOCK.getByName("alarm-recovery-test");
    const path=new URL(request.url).pathname;
    if(path==="/arm") {await stub.armTest();return new Response("armed");}
    if(path==="/interrupt") {
      try {await stub.interruptTest();} catch {return new Response("interrupted");}
    }
    return Response.json(await stub.inspect());
  },
};
