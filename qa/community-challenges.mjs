import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { challengeFor, algorithmChallenges } from '../src/community-challenge-content.ts';
import { runDailyChallenges, challengePayload, challengeConfig, CHALLENGE_CONFIG_KEY } from '../src/community-challenges.ts';
const env={SLACK_TEAM_ID:'TQA',SLACK_BOT_TOKEN:'test',COMMUNITY_ADMIN_ID:'UFOUNDER',COMMUNITY_PUBLIC_CHANNEL_ID:'CPUBLIC'};
const config={enabled:true,startDate:'2026-10-12',targets:[{track:'dev',channelId:'CDEV'},{track:'math',channelId:'CMATH'}]};
const now=s=>new Date(`2026-10-12T${s}:00+09:00`), records=new Map(), messages=[], calls=[];
const key=s=>`${s.channelId}:${s.key}`;
const store={
 async getRecord(s){return s.key===CHALLENGE_CONFIG_KEY?{body:config}:records.get(key(s))??null;},
 async putRecord(s){if(!records.has(key(s)))records.set(key(s),{...s,status:'pending'});return records.get(key(s));},
 async claimRecord(s){const r=records.get(key(s));if(r?.status!=='pending')return false;r.status='claimed';return true;},
 async finishRecord(s,status){records.get(key(s)).status=status;return true;},
};
let lost=false,mismatch=false,blocked=false;
globalThis.fetch=async(url,options)=>{
 const u=new URL(url),method=u.pathname.split('/').at(-1),p=options.method==='GET'?Object.fromEntries(u.searchParams):JSON.parse(options.body);calls.push({method,p});
 if(method==='conversations.info')return Response.json({ok:true,channel:{name:mismatch?'wrong':p.channel==='CDEV'?'chapter-dev':'chapter-math',is_archived:false,is_private:false}});
 if(method==='conversations.history'||method==='conversations.replies'){
  if(blocked)throw Error('history unavailable');
  return Response.json({ok:true,has_more:false,messages:messages.filter(m=>m.channel===p.channel&&(!p.ts||m.thread_ts===p.ts||m.ts===p.ts)),response_metadata:{next_cursor:''}});
 }
 if(method==='chat.postMessage'){
  const m={...p,ts:`1791750000.${String(messages.length+1).padStart(6,'0')}`,bot_id:'BQA'};messages.push(m);
  if(lost&&p.channel==='CDEV'){lost=false;throw Error('accepted then response lost');}
  return Response.json({ok:true,ts:m.ts,message:m});
 }
 throw Error(`unexpected API ${method}`);
};
assert.throws(()=>challengeConfig({...config,targets:[config.targets[0],config.targets[0]]}));
assert.throws(()=>challengeFor('math',-1));
assert.equal(await runDailyChallenges(env,store,now('08:59')),0);assert.equal(calls.length,0);
assert.equal(await runDailyChallenges(env,store,new Date('2026-10-11T09:00:00+09:00')),0);
lost=true;
await Promise.all([runDailyChallenges(env,store,now('09:00')),runDailyChallenges(env,store,now('09:00'))]);
assert.equal(messages.length,2,'one root per channel despite overlapping cron');
assert.equal(await runDailyChallenges(env,store,now('09:05')),1,'lost receipt recovered');assert.equal(messages.length,2);
assert.equal(await runDailyChallenges(env,store,now('17:59')),0);
assert.equal(await runDailyChallenges(env,store,now('18:00')),2);assert.equal(messages.length,4);
for(const m of messages){assert.equal(m.blocks[0].type,'section');assert.ok(m.blocks[0].block_id.startsWith('otl1_challenge_'));assert.doesNotMatch(m.text,/<!channel>|<!here>/);}
for(const m of messages.slice(2)){assert.ok(m.thread_ts);assert.equal(m.reply_broadcast,false);}
await runDailyChallenges(env,store,now('18:05'));assert.equal(messages.length,4);
config.enabled=false;assert.equal(await runDailyChallenges(env,store,new Date('2026-10-13T09:00:00+09:00')),0);config.enabled=true;
records.delete('CDEV:chapter-challenge:2026-10-12:solution');messages.splice(0,1);
await runDailyChallenges(env,store,now('18:10'));assert.equal(messages.length,3,'deleted parent never becomes an orphan reply');
mismatch=true;await runDailyChallenges(env,store,new Date('2026-10-13T09:00:00+09:00'));assert.equal(messages.length,3);mismatch=false;
blocked=true;await runDailyChallenges(env,store,new Date('2026-10-13T09:05:00+09:00'));assert.equal(messages.length,3);blocked=false;
await runDailyChallenges(env,store,new Date('2026-10-13T09:10:00+09:00'));assert.equal(messages.length,5);
await runDailyChallenges(env,store,new Date('2026-10-17T09:00:00+09:00'));assert.equal(messages.length,7,'weekends included');
assert.match(challengeFor('dev',algorithmChallenges.length).title,/복습/);
for(let i=0;i<365;i++){
 for(const track of ['dev','math']){const p=challengePayload(track,'2026-10-12',i);assert.ok(p.text.length<3000);assert.ok(p.solution.length<3000);}
 const round=Math.floor(i/7),n=3+round%17,c=challengeFor('math',i);
 if(i%7===0){const s=[];for(let a=0;a<60;a++)for(let b=0;b<60;b++)if(2*a+3*b===5*n+8&&3*a+2*b===5*n+12)s.push([a,b]);assert.deepEqual(s,[[n+4,n]]);}
 if(i%7===1){const a=2+round%7,s=[];for(let x=10;x<100;x++)if(Math.floor(x/10)+x%10===2*a-1&&x-(x%10*10+Math.floor(x/10))===9)s.push(x);assert.deepEqual(s,[11*a-1]);}
 if(i%7===4){const s=[];for(let x=1;x<=34;x++)if(x%5===2+round%3&&x%7===1+round%5)s.push(x);assert.equal(s.length,1);assert.ok(c.solution.startsWith(`${s[0]}.`));}
}
assert.match(readFileSync(new URL('../src/community-cron.ts',import.meta.url),'utf8'),/await runDailyChallenges\(/);
console.log('PASS daily challenges: content, timing, overlap, uncertain acceptance, threads and failures');
