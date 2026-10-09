import assert from "node:assert/strict";
import {resolveWorkThread} from "../src/community-work-thread.ts";
const env={SLACK_TEAM_ID:"TQA",SLACK_BOT_TOKEN:"fake",DATABASE_URL:"postgresql://t:t@test.neon.tech/db",COMMUNITY_ADMIN_ID:"UADMIN",COMMUNITY_MAINTAINERS_CHANNEL_ID:"CPO"};
const original=globalThis.fetch,calls=[];
let saved="1.000001";
const messages=[
  {ts:"4.000001",bot_id:"BQA",text:"관련 버그 키: BUG-ABCDEF123456\n버그 키: BUG-OTHER123456"},
  {ts:"3.000001",user:"UHUMAN",text:"버그 키: BUG-ABCDEF123456"},
  {ts:"2.000001",thread_ts:"2.000001",bot_id:"BQA",text:"제안 카드\n버그 키: BUG-ABCDEF123456"},
  {ts:"1.000001",thread_ts:"1.000001",bot_id:"BQA",text:"오늘 어떤 제안을 해볼까요?"},
];
globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  if(new URL(url).pathname==="/sql") {
    const op=body.params[0],p=JSON.parse(body.params[1]);
    if(op==="surface_put") saved=p.messageTs;
    return Response.json({rows:[[JSON.stringify(saved)]]});
  }
  assert(url.endsWith("conversations.history"));
  return Response.json({ok:true,messages:body.oldest ? messages.filter(m=>m.ts===body.oldest) : messages});
};
try {
  assert.equal(await resolveWorkThread(env,"BUG-ABCDEF123456"),"2.000001");
  assert.equal(saved,"2.000001","repair a stale daily-prompt pointer");
  const before=calls.length;
  assert.equal(await resolveWorkThread(env,"BUG-ABCDEF123456"),"2.000001");
  assert.equal(calls.slice(before).filter(c=>c.url.endsWith("conversations.history")).length,1);
  assert.equal(calls.some(c=>c.url.includes("chat.")),false,"resolver is not a message publisher");
  console.log("PASS canonical work root: saved mapping, stale daily pointer, human/other-work rejection and root-with-replies");
} finally {globalThis.fetch=original;}
