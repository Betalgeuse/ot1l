import assert from 'node:assert/strict';
import { mock } from 'bun:test';
mock.module('cloudflare:workers',()=>({DurableObject:class{}}));
const profiles=[];const active=new Set();const effects=[];let inviteFailure=false;
mock.module('../src/community-store.ts',()=>({CommunityStore:class{
 async maintainerStatus(){return null}
 async syncMaintainerProfile(team,actor){profiles.push(actor)}
 async activateMaintainer(team,actor){const changed=!active.has(actor);active.add(actor);return{userId:actor,state:'active',changed}}
}}));
const {communityInteraction}=await import('../src/community-interactions.ts');
const env={COMMUNITY_ENABLED:'true',SLACK_TEAM_ID:'TQA',SLACK_BOT_TOKEN:'fake',DATABASE_URL:'postgresql://test:test@test.neon.tech/db',COMMUNITY_FEEDBACK_CHANNEL_ID:'CFEEDBACK',COMMUNITY_WELCOME_CHANNEL_ID:'CWELCOME',COMMUNITY_PUBLIC_CHANNEL_ID:'CPUBLIC',COMMUNITY_RELEASE_CHANNEL_ID:'CTOWN',COMMUNITY_MAINTAINERS_CHANNEL_ID:'CMAIN',COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS:'CEVENT,CWEB,CMAINWELCOME',COMMUNITY_SYS_ALERT_CHANNEL_ID:'CALERT'};
const original=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{const u=new URL(url);const method=u.pathname.split('/').at(-1);const body=options.body?JSON.parse(options.body):{};effects.push({method,body});if(method==='users.info')return Response.json({ok:true,user:{id:u.searchParams.get('user'),team_id:'TQA',is_bot:false,is_app_user:false,deleted:false}});if(method==='conversations.invite'&&inviteFailure)return Response.json({ok:false,error:'missing_scope'});return Response.json({ok:true,ts:'1.000001',message_ts:'1.000002'})};
async function click(channel,user){const pending=[];const response=await communityInteraction({type:'block_actions',team:{id:'TQA'},user:{id:user},container:{channel_id:channel,message_ts:'1.000001'},message:{ts:'1.000001'},actions:[{action_id:'community_maintainer_activate',action_ts:'1790000000.000001',value:JSON.stringify({ownerId:'actor',key:'maintainer-self-activate'})}]},env,p=>pending.push(p));assert.equal(response.status,200);await Promise.all(pending)}
try{
 await click('CFEEDBACK','UMEMBER');
 assert.deepEqual(profiles,['UMEMBER']);assert.ok(active.has('UMEMBER'));
 assert.deepEqual(effects.filter(e=>e.method==='conversations.invite').map(e=>e.body.channel),['CMAIN','CEVENT','CWEB','CMAINWELCOME','CALERT']);
 const activation=effects.find(e=>e.method==='chat.postEphemeral').body.text;
 assert.match(activation,/Product Owner가 활성화됐어요/);
 assert.match(activation,/Codex가 수정·검사·PR 생성을 맡아요/);
 assert.match(activation,/직접 PR을 만들었을 때만/);
 inviteFailure=true;await click('CWELCOME','UNEW');assert.equal(active.has('UNEW'),false);
 const errorNotice=effects.filter(e=>e.method==='chat.postEphemeral').at(-1);assert.equal(errorNotice.body.user,'UNEW');assert.match(errorNotice.body.text,/완료하지 못했어요/);
 console.log('PASS ordinary-member feedback button reaches activation, and invite failure returns a private result');
}finally{globalThis.fetch=original}
