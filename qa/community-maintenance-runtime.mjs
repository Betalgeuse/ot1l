import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
const temp=await mkdtemp(join(tmpdir(),'otl1-maintenance-runtime-'));
const scriptPath=join(temp,'worker.js');
execFileSync('bun',['build','qa/fixtures/maintenance-runtime.ts','--target=browser','--external=cloudflare:workers',`--outfile=${scriptPath}`]);
const records=new Map(),posts=[],queries=[];
const mf=new Miniflare({modules:true,scriptPath,modulesRoot:temp,compatibilityDate:'2026-01-01',durableObjects:{COMMUNITY_CLOCK:{className:'CommunityClock',useSQLite:true}},
 bindings:{DATABASE_URL:'postgresql://qa:qa@example.neon.tech/test',SLACK_TEAM_ID:'TQA',SLACK_BOT_TOKEN:'test',COMMUNITY_ENABLED:'true',COMMUNITY_ADMIN_ID:'UADMIN',COMMUNITY_PUBLIC_CHANNEL_ID:'CPUBLIC',COMMUNITY_CHANNEL_ID:'CPUBLIC',BUG_RUNNER_ENABLED:'true'},
 outboundService:async request=>{
  const u=new URL(request.url);
  if(u.hostname==='example.neon.tech'){
   const {query,params}=await request.json();queries.push(query);
   const reply=value=>Response.json({rows:[[value===null?null:JSON.stringify(value)]]});
   // Reject any unexpected DB operation outside the task's isolated RPC path.
   if(!query.includes('community_execute'))return new Response('unrelated lane unavailable',{status:503});
   const op=params[0],p=JSON.parse(params.at(-1)),key=`${p.channelId}:${p.key}`;
   if(op==='get_record')return reply(p.key==='chapter-daily-challenges:v1'?{...p,kind:'settings',status:'pending',body:{enabled:true,startDate:'2026-10-12',targets:[{track:'dev',channelId:'CDEV'},{track:'math',channelId:'CMATH'}]}}:records.get(key)??null);
   if(op==='put_record'){if(!records.has(key))records.set(key,{...p,status:'pending'});return reply(records.get(key));}
   if(op==='claim_record'){const r=records.get(key);if(r?.status!=='pending')return reply(false);r.status='claimed';return reply(true);}
   if(op==='finish_record'){records.get(key).status=p.status;return reply(true);}
   throw Error(`unexpected record operation ${op}`);
  }
  if(u.hostname==='atcoder.jp')return new Response('dev source offline',{status:503});
  if(u.hostname==='mensa.org.uk')return new Response(u.pathname==='/puzzle/'?'<article><h3><a href="https://mensa.org.uk/puzzle/9-10-26/">9/10/26</a></h3><div class="elementor-post__excerpt">How many coins?</div></article>':'Show Answer<div class="ee-toggle-element__element">fixture</div>',{headers:{'content-type':'text/html'}});
  if(u.hostname==='slack.com'){
   const p=request.method==='GET'?Object.fromEntries(u.searchParams):await request.json();
   assert.equal(p.channel,'CMATH','only math owns successful fixture I/O');
   const method=u.pathname.split('/').at(-1);
   if(method==='conversations.info')return Response.json({ok:true,channel:{name:'chapter-math',is_private:false,is_archived:false}});
   if(method==='conversations.history'||method==='conversations.replies')return Response.json({ok:true,messages:posts,has_more:false,response_metadata:{next_cursor:''}});
   if(method==='chat.postMessage'){const m={...p,ts:`1791802800.${posts.length+1}`,bot_id:'BQA'};posts.push(m);return Response.json({ok:true,ts:m.ts,message:m});}
  }
  throw Error('unexpected external request');
 }
});
try{
 const r=await mf.dispatchFetch('https://test/');
 assert.equal(r.status,200,'clock recovery no longer opens Neon');
 const state=await r.json();assert.equal(state.role,'maintenance_task:chapter_math');assert.equal(state.lastRun.status,'finished');assert.equal(state.next,null,'no second alarm scheduler');
 assert.equal(posts.length,2,'unrelated failures and dev source outage do not suppress math problem and solution');
 assert.equal(posts[1].thread_ts,posts[0].ts);
 assert.match(posts[0].text,/British Mensa/);assert.doesNotMatch(posts[0].text,/공식 Mensa|IQ 검사/);
 await mf.dispatchFetch('https://test/?at=2026-10-12T11:01:00Z');
 assert.equal(posts.length,2,'next real RPC pass consumes persisted receipts without reposting');
 assert.ok(queries.length > 0,'chapter task exercised its isolated Neon RPC');
 console.log('PASS workerd: isolated math RPC posts once and clock recovery performs no Neon query');
}finally{await mf.dispose();await rm(temp,{recursive:true,force:true});}
