import assert from "node:assert/strict";
import {mock} from "bun:test";
mock.module("cloudflare:workers",()=>({DurableObject:class{}}));
import {poMembershipChannels,reconcilePoMembership} from "../src/community-po-membership.ts";
const {handleCommunityEvent}=await import("../src/community-events.ts");
import {handleBugAction} from "../src/community-bug-interactions.ts";
const env={SLACK_TEAM_ID:"TQA",SLACK_BOT_TOKEN:"fake",DATABASE_URL:"postgresql://t:t@test.neon.tech/db",
  COMMUNITY_ENABLED:"true",COMMUNITY_ADMIN_ID:"UFOUNDER",COMMUNITY_MAINTAINERS_CHANNEL_ID:"CPO",
  COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS:"CDEV,CPO,CALERT",COMMUNITY_SYS_ALERT_CHANNEL_ID:"CALERT",
  COMMUNITY_CODEX_REPOSITORY:"Betalgeuse/ot1l"};
assert.deepEqual(poMembershipChannels(env),["CPO","CDEV"]);
const original=globalThis.fetch,calls=[];let failPage=false,cycle=false,badProfile=false,roster=true,active=false,approvals=0;
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url),method=u.pathname.split("/").at(-1),body=options.body?JSON.parse(options.body):Object.fromEntries(u.searchParams);calls.push({method,body});
  if(method==="conversations.members"){
    if(failPage&&body.cursor)return Response.json({ok:false,error:"ratelimited"});
    if(body.channel==="CDEV")return Response.json({ok:true,members:roster?["UONE"]:[]});
    return Response.json({ok:true,members:roster?(body.cursor?["UTWO","UBOT","UGONE","UEXTERNAL"]:["UONE"]):[],
      response_metadata:{next_cursor:cycle?"page2":body.cursor?"":"page2"}});
  }
  if(method==="users.info")return Response.json({ok:true,user:{id:badProfile?"UWRONG":body.user,
    team_id:body.user==="UEXTERNAL"?"TOTHER":"TQA",is_bot:body.user==="UBOT",deleted:body.user==="UGONE",real_name:body.user}});
  if(method==="sql"){
    const p=JSON.parse(body.params[0]);let result;
    if(body.query.includes("community_po_reconcile")){active=p.members.some(m=>m.userId==="UONE");result={applied:true};}
    else if(body.query.includes("bug_merge_approval_context"))result={classified:true,changeClass:"open",headSha:"a".repeat(40),classificationDigest:"b".repeat(64),maintainer:active};
    else if(body.query.includes("bug_actor_approve_merge")){approvals++;result={accepted:true};}
    else throw Error("unexpected SQL");
    return Response.json({rows:[[JSON.stringify(result)]]});
  }
  if(["chat.update","chat.postEphemeral"].includes(method))return Response.json({ok:true,message_ts:"1.000002"});
  throw Error("unexpected "+method);
};
try{
  await reconcilePoMembership(env);
  const snapshot=JSON.parse(calls.find(c=>c.method==="sql").body.params[0]);
  assert.deepEqual(snapshot.members.map(m=>m.userId),["UONE","UTWO"]);
  assert.equal(snapshot.complete,true);
  for(const mode of ["page","cycle","profile"]){
    calls.length=0;failPage=mode==="page";cycle=mode==="cycle";badProfile=mode==="profile";
    await assert.rejects(()=>reconcilePoMembership(env));
    assert.equal(calls.some(c=>c.method==="sql"),false,"partial Slack reads never change roles");
  }
  failPage=cycle=badProfile=false;
  for(const event of [{type:"member_joined_channel",channel:"CDEV"},{type:"message",subtype:"channel_leave",channel:"CPO"}]){
    calls.length=0;assert.equal(await handleCommunityEvent({type:"event_callback",team_id:"TQA",event},env),true);
    assert(calls.some(c=>c.method==="sql"));
  }
  const context={env,scope:{teamId:"TQA",channelId:"CPO",userId:"UONE"},source:"1.000001",thread:"1.000001"};
  const input={packetRevision:2,prNumber:136,feedbackId:"BUG-TEST1234",changeClass:"open",headSha:"a".repeat(40),classificationDigest:"b".repeat(64)};
  const pending=[];
  await handleBugAction("community_feedback_merge_approve",null,context,"BUG-TEST1234",input,null,p=>pending.push(p));
  await Promise.all(pending);assert.equal(approvals,1,"fresh member can approve without Slack admin role");
  roster=false;pending.length=0;
  await handleBugAction("community_feedback_merge_approve",null,context,"BUG-TEST1234",input,null,p=>pending.push(p));
  await Promise.all(pending);assert.equal(approvals,1,"departed member cannot reuse old role");
  assert.match(calls.at(-1).body.text,/활성 Product Owner/);
  console.log("PASS PO roster pagination, identity filtering, partial-read fail-closed, events and fresh approval authorization");
}finally{globalThis.fetch=original;}
