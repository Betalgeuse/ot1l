import assert from "node:assert/strict";
import { mock } from "bun:test";
import {readFileSync} from "node:fs";
mock.module("cloudflare:workers",()=>({DurableObject:class {constructor(ctx,env){this.ctx=ctx;this.env=env;}}}));
const {AlarmIncident,incidentStatus}=await import("../src/log-alert-incident.ts");
const {alarmSignals}=await import("../src/log-alert-observation.ts");
const {prepareLogAlertConfig}=await import("../scripts/deploy-log-alert-worker.mjs");
const manifest=JSON.parse(readFileSync(new URL("../log-alerts/wrangler.jsonc",import.meta.url),"utf8"));
const config={name:"otl1-log-alerts",main:"src/log-alert-worker.ts",vars:{COMMUNITY_SYS_ALERT_CHANNEL_ID:"CSYS"},ratelimits:[{name:"ALERT_RATE_LIMITER",simple:{limit:1,period:60}}]};
assert.equal(prepareLogAlertConfig(config,manifest).durable_objects.bindings[0].class_name,"AlarmIncident");
assert.throws(()=>prepareLogAlertConfig({...config,durable_objects:{bindings:[{name:"ALARM_INCIDENTS",class_name:"Other"}]}},manifest),/conflict/);
let now=Date.parse("2026-10-12T05:27:03Z");const originalNow=Date.now;Date.now=()=>now;
const cycle="11111111-1111-4111-8111-111111111111";
const trace=(outcome,phase,extra={})=>({scriptName:"otl1-onething-garden",durableObjectId:"a".repeat(64),
 event:{scheduledTime:new Date(now)},eventTimestamp:now,outcome,truncated:false,exceptions:[],
 logs:[{level:"log",message:[JSON.stringify({event:"community.alarm.observation",cycleId:cycle,role:"community_schedule",phase,completedAt:now+1000,secret:"must-not-leak"})]}],...extra});
const [cancel]=await alarmSignals(trace("canceled","start"));const [complete]=await alarmSignals(trace("ok","complete"));
assert.doesNotMatch(JSON.stringify(cancel),/must-not-leak/);
assert.notEqual((await alarmSignals(trace("canceled","start",{durableObjectId:"b".repeat(64)})))[0].key,cancel.key);
assert.deepEqual(await alarmSignals(trace("ok","complete",{truncated:true})),[]);
assert.deepEqual(await alarmSignals(trace("ok","complete",{exceptions:[{name:"Error"}]})),[]);
assert.deepEqual(await alarmSignals(trace("ok","complete",{logs:[{level:"error",message:["do not log secrets"]}]})),[]);
class Storage {data=new Map();next=null;async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){return this.data.delete(k);}async getAlarm(){return this.next;}async setAlarm(t){this.next=t;}async deleteAlarm(){this.next=null;}}
const env={SLACK_BOT_TOKEN:"test",COMMUNITY_SYS_ALERT_CHANNEL_ID:"CSYS"};
const posts=[],updates=[];let lostResponse=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 const method=new URL(url).pathname.split("/").at(-1),body=options.body?JSON.parse(options.body):{};
 if(method==="auth.test")return Response.json({ok:true,user_id:"UBOT"});
 if(method==="conversations.history")return Response.json({ok:true,messages:posts,has_more:false});
 if(method==="chat.postMessage"){
  const msg={...body,user:"UBOT",ts:`123.${posts.length+1}`};posts.push(msg);
  if(lostResponse){lostResponse=false;throw new Error("synthetic lost response");}
  return Response.json({ok:true,ts:msg.ts});
 }
 if(method==="chat.update"){updates.push(body);return Response.json({ok:true,ts:body.ts});}
 throw new Error(`unexpected ${method}`);
};
try{
 const s=new Storage(),d=new AlarmIncident({storage:s},env);
 await Promise.all([d.observe(cancel),d.observe(cancel)]);
 assert.equal(posts.length,1);assert.match(posts[0].text,/확인 중/);
 now+=1000;await new AlarmIncident({storage:s},env).observe(complete);
 assert.equal(posts.length,1);assert.match(updates.at(-1).text,/완료 확인/);
 await d.observe(cancel);assert.equal(updates.length,1,"late cancellation never downgrades a matching completion");
 await assert.rejects(d.observe({...cancel,key:"b".repeat(64)}),/identity/);
 const reverse=new Storage();await new AlarmIncident({storage:reverse},env).observe(complete);
 const before=posts.length;await new AlarmIncident({storage:reverse},env).observe(cancel);
 assert.equal(posts.length,before+1);assert.match(posts.at(-1).text,/완료 확인/);
 const waiting=new Storage(),w=new AlarmIncident({storage:waiting},env);await w.observe(cancel);
 now+=10*60_000;await w.alarm();assert.match(updates.at(-1).text,/복구 미확인/);
 assert.equal(incidentStatus({canceledAt:now,completedAt:now-1},now),"waiting");
 const uncertain=new Storage();lostResponse=true;const count=posts.length;
 await assert.rejects(new AlarmIncident({storage:uncertain},env).observe({...cancel,key:"c".repeat(64)}));
 await new AlarmIncident({storage:uncertain},env).observe({...complete,key:"c".repeat(64),at:now+1});
 assert.equal(posts.length,count+1,"lost Slack response reconciles accepted marker instead of reposting");
 assert.equal(updates.at(-1).ts,posts[count].ts);
 console.log("PASS exact object/cycle correlation, reordered events, restart, escalation, privacy and uncertain Slack receipt");
}finally{globalThis.fetch=originalFetch;Date.now=originalNow;mock.restore();}
