import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
const temp=await mkdtemp(join(tmpdir(),'otl1-maintenance-runtime-'));
const scriptPath=join(temp,'worker.js');
execFileSync('bun',['build','qa/fixtures/maintenance-runtime.ts','--target=browser','--external=cloudflare:workers',`--outfile=${scriptPath}`]);
const queries=[],acked=[];
const mf=new Miniflare({modules:true,scriptPath,modulesRoot:temp,compatibilityDate:'2026-01-01',durableObjects:{COMMUNITY_CLOCK:{className:'CommunityClock',useSQLite:true}},
 bindings:{DATABASE_URL:'postgresql://qa:qa@example.neon.tech/test',SLACK_TEAM_ID:'TQA',SLACK_BOT_TOKEN:'test',COMMUNITY_ENABLED:'true',COMMUNITY_ADMIN_ID:'UADMIN',COMMUNITY_PUBLIC_CHANNEL_ID:'CPUBLIC',COMMUNITY_CHANNEL_ID:'CPUBLIC',BUG_RUNNER_ENABLED:'true'},
 outboundService:async request=>{
  const u=new URL(request.url);
  if(u.hostname==='example.neon.tech'){
   const {query,params}=await request.json();queries.push(query);
   // Reject any DB operation outside the task's own pr_metadata RPC.
   if(!query.includes('community_pr_metadata_results'))return new Response('unrelated lane unavailable',{status:503});
   const p=JSON.parse(params.at(-1));
   if(p.operation==='ack'){acked.push(p);return Response.json({rows:[[null]]});}
   // A bound row with no head SHA needs no Slack or release-stage call, only the ack.
   return Response.json({rows:[[JSON.stringify([{status:'bound',work_key:'WORK-1',request_id:'REQ-1',revision:3,pr_number:17}])]]});
  }
  throw Error('unexpected external request');
 }
});
try{
 const r=await mf.dispatchFetch('https://test/');
 assert.equal(r.status,200,'pr_metadata task finishes inside its own Durable Object');
 const state=await r.json();assert.equal(state.role,'maintenance_task:pr_metadata');assert.equal(state.lastRun.status,'finished');assert.equal(state.next,null,'no second alarm scheduler');
 assert.equal(acked.length,1,'the RPC read one result row and acknowledged it');
 assert.deepEqual([acked[0].requestId,acked[0].revision],['REQ-1',3]);
 assert.ok(queries.every(q=>q.includes('community_pr_metadata_results')),'the task touched no other lane');
 const off=await mf.dispatchFetch('https://test/?at=2026-10-12T10:16:00Z');
 assert.equal(off.status,200);
 assert.equal(acked.length,1,'off-cadence pass performs no Neon query');
 console.log('PASS workerd: isolated pr_metadata RPC acknowledges once and off-cadence passes stay silent');
}finally{await mf.dispose();await rm(temp,{recursive:true,force:true});}
