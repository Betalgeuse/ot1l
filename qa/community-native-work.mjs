import assert from "node:assert/strict";
import {nativeWorkCard,assignMaintainerWork,connectMaintainerToLinear} from "../src/community-maintainer-work.ts";
const env={SLACK_TEAM_ID:"TQA",SLACK_BOT_TOKEN:"fake",DATABASE_URL:"postgresql://t:t@test.neon.tech/db",COMMUNITY_ADMIN_ID:"UADMIN",COMMUNITY_MAINTAINERS_CHANNEL_ID:"CPO"};
const work={work_key:"BUG-NATIVE01",title:"디자인 의견",actual:"시안을 함께 검토하고 싶어요",expected:"",reporter_id:"UONE",desired_dri:"UONE",dri_user_id:"UONE",source_channel:"CPO",source_thread:"1.000001",issue_state:"의견 모으는 중"};
const members=[{userId:"UONE",displayName:"One"},{userId:"UTWO",displayName:"Two"}];
const card=nativeWorkCard(env,work,members);
assert.doesNotMatch(JSON.stringify(card),/Linear|연결 대기|현재 상태 확인 필요|원하는 상태 확인 필요/);
assert.equal(card.blocks[1].elements[1].action_id,"community_pull_request_open");
assert.equal(JSON.parse(card.blocks[1].elements[1].value).key,work.work_key);
assert.equal(JSON.parse(card.blocks[1].elements[0].initial_option.value).driUserId,"UONE");
const original=globalThis.fetch,calls=[];
globalThis.fetch=async(url,options)=>{
  const u=new URL(url),body=JSON.parse(options.body??"{}");calls.push({url:u,body});
  assert.notEqual(u.hostname,"api.linear.app");
  if(u.pathname==="/sql") {
    const op=body.params[0],p=JSON.parse(body.params[1]);let result;
    if(op==="members") result=members;
    else if(op==="work_assignment"){work.dri_user_id=p.driUserId;work.desired_dri=p.driUserId;result=work;}
    else if(op==="work_get") result=work;
    else if(op==="surface_get"||op==="surface_put")result="1.000001";
    else throw Error("unexpected "+op);
    return Response.json({rows:[[JSON.stringify(result)]]});
  }
  return Response.json({ok:true,ts:"1.000001",message_ts:"2.000001"});
};
try {
  const ctx={env,scope:{teamId:"TQA",channelId:"CPO",userId:"UONE"},store:{async maintainerStatus(){return {state:"active"};}}};
  await assignMaintainerWork(ctx,work.work_key,"UTWO");
  assert.equal(work.dri_user_id,"UTWO");
  const updated=calls.find(c=>c.url.pathname.endsWith("chat.update")).body;
  assert.equal(JSON.parse(updated.blocks[1].elements[0].initial_option.value).driUserId,"UTWO");
  assert(updated.blocks[1].elements.some(e=>e.action_id==="community_pull_request_open"));
  await connectMaintainerToLinear(ctx);
  assert.match(calls.at(-1).body.text,/이제 Slack에서 관리/);
  console.log("PASS native PO ownership readback, contextual PR control and retired Linear actions");
}finally {globalThis.fetch=original;}
