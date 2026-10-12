import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Miniflare} from "miniflare";
const temp=await mkdtemp(join(tmpdir(),"otl1-alert-runtime-"));
const scriptPath=join(temp,"worker.js");
execFileSync("bun",["build","qa/alert-correlation-worker.mjs","--target=browser","--external=cloudflare:workers",`--outfile=${scriptPath}`]);
const posts=[],updates=[];
const options={name:"alert-qa",modules:true,scriptPath,modulesRoot:temp,compatibilityDate:"2026-01-01",
 durableObjects:{ALARM_INCIDENTS:{className:"AlarmIncident",useSQLite:true}},durableObjectsPersist:join(temp,"state"),
 bindings:{SLACK_BOT_TOKEN:"fake",COMMUNITY_SYS_ALERT_CHANNEL_ID:"CSYS"},
 outboundService:async req=>{
  const method=new URL(req.url).pathname.split("/").at(-1),body=await req.json();
  assert.equal(new URL(req.url).host,"slack.com");
  if(method==="chat.postMessage"){posts.push(body);return Response.json({ok:true,ts:`123.${posts.length}`});}
  if(method==="chat.update"){updates.push(body);return Response.json({ok:true,ts:body.ts});}
  throw new Error(`unexpected test outbound ${method}`);
 }};
const now=Date.now(),cycle="11111111-1111-4111-8111-111111111111";
const trace=(outcome,phase,extra={})=>({scriptName:"otl1-onething-garden",durableObjectId:"a".repeat(64),
 event:{scheduledTime:now},eventTimestamp:now,outcome,truncated:false,exceptions:[],
 logs:[{level:"log",message:[JSON.stringify({event:"community.alarm.observation",cycleId:cycle,role:"community_schedule",phase,completedAt:now+1})]}],...extra});
let mf=new Miniflare(options);
const send=async events=>{const r=await mf.dispatchFetch("https://test/",{method:"POST",body:JSON.stringify(events)});assert.equal(r.status,200);return r.json();};
try{
 assert.deepEqual(await send([trace("canceled","start"),trace("canceled","start")]),{writes:1});
 assert.equal(posts.length,1);assert.match(posts[0].text,/確認|확인 중/);
 await mf.dispose();mf=new Miniflare(options);
 assert.deepEqual(await send([trace("ok","complete")]),{writes:1});
 assert.equal(posts.length,1);assert.equal(updates.length,1);assert.match(updates[0].text,/완료 확인/);
 assert.deepEqual(await send([trace("canceled","start")]),{writes:0});
 assert.equal(updates.length,1);
 assert.deepEqual(await send([trace("ok","complete",{durableObjectId:"b".repeat(64)})]),{writes:0});
 assert.equal(posts.length,1,"different object completion cannot create or resolve an incident");
 console.log("PASS workerd Tail parser -> SQLite incident RPC -> Slack card update across restart and reordered delivery");
}finally{await mf.dispose();await rm(temp,{recursive:true,force:true});}
