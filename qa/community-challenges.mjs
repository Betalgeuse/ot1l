import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceChallenge, sourcedChallengePayload, mensaCandidates, allowedChallengeUrl } from '../src/community-challenge-sources.ts';
import { runDailyChallenges, challengeConfig, CHALLENGE_CONFIG_KEY } from '../src/community-challenges.ts';
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
let lost=false,mismatch=false,blocked=false,sourceBlocked=false,sourceReads=0;
const sourceFixture={id:'mensa-test',title:'British Mensa · Test',publisher:'British Mensa',url:'https://mensa.org.uk/puzzle/test/',solutionUrl:'https://mensa.org.uk/puzzle/test/',solutionLabel:'Show Answer'};
globalThis.fetch=async(url,options)=>{
 const parsed=new URL(url);
 if(parsed.hostname!=='slack.com'){
  sourceReads++;
  if(sourceBlocked)return new Response('Unavailable',{status:503});
  assert.equal(options.headers?.Authorization,undefined,'Slack token never sent to source');
  const html=parsed.hostname==='atcoder.jp'
   ?parsed.pathname.endsWith('editorial')?'<span>Official</span><a>Editorial</a>':`<title>${parsed.pathname.endsWith('_c')?'C':'B'} - Verified fixture</title><time class='fixtime'>2022-07-17 21:00:00+0900</time><time class='fixtime'>2022-07-17 22:40:00+0900</time>Problem Statement Sample Input<a href="${parsed.pathname}/editorial">Editorial</a>`
   :parsed.pathname==='/puzzle/'?Array.from({length:12},(_,i)=>`<article><h3><a href="https://mensa.org.uk/puzzle/${12-i}-10-26/">${12-i}/10/26</a></h3><div class="elementor-post__excerpt"><p>How many cars wait in the grid?</p></div></article>`).join(''):'Show Answer<div class="ee-toggle-element__element">Answer on original site</div>';
  return new Response(html,{headers:{'content-type':'text/html'}});
 }
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
assert.equal(allowedChallengeUrl('https://mensa.org.uk.evil.example/puzzle/test/'),false);
assert.equal(allowedChallengeUrl('https://user:password@mensa.org.uk/puzzle/test/'),false);
assert.doesNotMatch(sourcedChallengePayload('math','2026-10-12',sourceFixture).text,/공식 Mensa|IQ 검사|자동 가입/);
assert.equal(mensaCandidates('<article><h3><a href="https://mensa.org.uk/puzzle/word/">1/10/26</a></h3><div class="elementor-post__excerpt">Rearrange letters to form a word</div></article>','2026-10-12').length,0);
assert.equal(await runDailyChallenges(env,store,now('08:59')),0);assert.equal(calls.length,0);
assert.equal(await runDailyChallenges(env,store,new Date('2026-10-11T09:00:00+09:00')),0);
lost=true;
await Promise.all([runDailyChallenges(env,store,now('09:00')),runDailyChallenges(env,store,now('09:00'))]);
assert.equal(messages.length,2,'one root per channel despite overlapping cron');
const readsAfterSelection=sourceReads;
assert.equal(await runDailyChallenges(env,store,now('09:05')),1,'lost receipt recovered');assert.equal(messages.length,2);
assert.equal(sourceReads,readsAfterSelection,'retry uses persisted source snapshot');
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
sourceBlocked=true;
await runDailyChallenges(env,store,new Date('2026-10-18T09:00:00+09:00'));assert.equal(messages.length,7,'no fabricated fallback on source failure');
sourceBlocked=false;
const seen=new Set();const a=await sourceChallenge('math',0,'2026-10-12',async s=>{if(seen.has(s.id))return false;seen.add(s.id);return true;});
const b=await sourceChallenge('math',1,'2026-10-13',async s=>{if(seen.has(s.id))return false;seen.add(s.id);return true;});assert.notEqual(a.id,b.id);
await assert.rejects(sourceChallenge('dev',0,'2026-10-12',async()=>true,async()=>new Response('<title>B - Missing solution</title>',{headers:{'content-type':'text/html'}})));
await assert.rejects(sourceChallenge('math',0,'2026-10-12',async()=>false),/pool_empty/);
assert.match(readFileSync(new URL('../src/community-cron.ts',import.meta.url),'utf8'),/await runDailyChallenges\(/);
console.log('PASS daily challenges: content, timing, overlap, uncertain acceptance, threads and failures');
