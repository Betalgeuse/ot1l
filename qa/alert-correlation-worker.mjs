import {handleLogAlerts} from "../src/log-alert-worker";
export {AlarmIncident} from "../src/log-alert-incident";
export default {async fetch(request,env){
  // Test-only ingress; the deployed entry exports tail(), not this HTTP route.
  return Response.json({writes:await handleLogAlerts(await request.json(),env)});
}};
