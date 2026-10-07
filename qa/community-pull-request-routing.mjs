import assert from 'node:assert/strict';
import { mock } from 'bun:test';
mock.module('cloudflare:workers',()=>({DurableObject:class{}}));
mock.module('../src/community-store.ts',()=>({CommunityStore:class{
  async maintainerStatus(_team,user){return user==='UPO'?{state:'active'}:null;}
}}));
const {communityInteraction}=await import('../src/community-interactions.ts');
const env={COMMUNITY_ENABLED:'true',SLACK_TEAM_ID:'TQA',SLACK_BOT_TOKEN:'fake',DATABASE_URL:'postgresql://test:test@test.neon.tech/db',COMMUNITY_FEEDBACK_CHANNEL_ID:'CFEEDBACK',COMMUNITY_PUBLIC_CHANNEL_ID:'CPUBLIC',COMMUNITY_MAINTAINERS_CHANNEL_ID:'CPO',COMMUNITY_ADMIN_ID:'UFOUNDER'};
const original=globalThis.fetch, effects=[];
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url),body=options.body?JSON.parse(options.body):{};
  effects.push({url:u,body});
  if(u.hostname==='api.github.com') {
    if(u.pathname.endsWith('/files')) return Response.json([{filename:'event-site/src/index.ts'}]);
    return Response.json({state:'open',base:{ref:'main',repo:{full_name:'Betalgeuse/ot1l'}},head:{sha:'a'.repeat(40),repo:{full_name:'contributor/ot1l'}}});
  }
  if(u.pathname==='/sql') return Response.json({rows:[[JSON.stringify({accepted:true,bindingId:1})]]});
  return Response.json({ok:true,message_ts:'2.000001'});
};
const click=user=>({type:'block_actions',team:{id:'TQA'},user:{id:user},container:{channel_id:'CPO',message_ts:'1.000001'},message:{ts:'1.000001'},trigger_id:'qa-trigger',actions:[{action_id:'community_pull_request_open',action_ts:'1790000000.000001',value:JSON.stringify({ownerId:'actor',key:'pull-request-bind'})}]});
const pending=[];
try {
  await assert.rejects(()=>communityInteraction(click('UMEMBER'),env,p=>pending.push(p)),/활성 Product Owner/);
  assert.equal(effects.length,0);
  assert.equal((await communityInteraction(click('UPO'),env,p=>pending.push(p))).status,200);
  const opened=effects.find(e=>e.url.pathname.endsWith('views.open')).body.view;
  assert.equal(opened.callback_id,'community_pull_request_submit');
  assert.equal(JSON.parse(opened.private_metadata).userId,'UPO');
  const submission={type:'view_submission',team:{id:'TQA'},user:{id:'UPO'},view:{...opened,id:'VQA',state:{values:{work_key:{value:{value:'BUG-BOUNDTEST01'}},pull_url:{value:{value:'https://github.com/Betalgeuse/ot1l/pull/17'}}}}}};
  await assert.rejects(()=>communityInteraction({...submission,user:{id:'UOTHER'}},env,p=>pending.push(p)),/본인이 연 화면/);
  const response=await communityInteraction(submission,env,p=>pending.push(p));
  assert.equal((await response.json()).response_action,'clear');
  await Promise.all(pending);
  const bound=effects.find(e=>e.body.query?.includes('community_bind_pull_request'));
  const payload=JSON.parse(bound.body.params[0]);
  assert.equal(payload.actorId,'UPO');
  assert.equal(payload.workKey,'BUG-BOUNDTEST01');
  assert.equal(payload.headRepository,'contributor/ot1l');
  const receipt=effects.find(e=>e.url.pathname.endsWith('chat.postEphemeral')).body;
  assert.equal(receipt.user,'UPO');
  assert.equal(receipt.channel,'CPO');
  assert.match(receipt.text,/승인 버튼/);
  console.log('PASS real interaction router: PO button, actor-bound modal, fork PR submit and private receipt; ordinary and forged actors denied');
} finally {globalThis.fetch=original;}
