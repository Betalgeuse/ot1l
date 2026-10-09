import assert from "node:assert/strict";
import {mock} from "bun:test";
import {deliverEncouragement} from "../src/community-encouragement-delivery.ts";
const context={env:{SLACK_BOT_TOKEN:"fake"},scope:{channelId:"CDAILY",userId:"UMEMBER"},date:"2026-09-30",key:"interaction:VPAST",thread:"1791447850.001800"};
const original=globalThis.fetch,calls=[];let mode="valid",replies=[];
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url),method=u.pathname.split("/").at(-1),body=options.body?JSON.parse(options.body):Object.fromEntries(u.searchParams);calls.push({method,body});
 if(method==="conversations.replies"){
   if(mode==="missing")return Response.json({ok:false,error:"thread_not_found"});
   if(mode==="unavailable")return Response.json({ok:false,error:"ratelimited"});
   return Response.json({ok:true,messages:[{ts:context.thread},...replies]});
 }
 if(method==="chat.postMessage"){
   const message={...body,ts:"1791532806.437229",bot_id:"BBOT"};
   if(mode==="race")delete message.thread_ts;
   replies.push(message);
   if(mode==="lost")throw Error("response lost");
   return Response.json({ok:true,ts:message.ts,message});
 }
 if(method==="chat.delete")return Response.json({ok:true});
 throw Error(method);
};
try{
 assert.equal(await deliverEncouragement(context,"thanks"),true);
 assert.equal(calls.find(c=>c.method==="chat.postMessage").body.reply_broadcast,false);
 await deliverEncouragement(context,"thanks");assert.equal(calls.filter(c=>c.method==="chat.postMessage").length,1);
 for(const scenario of ["missing","unavailable"]){mode=scenario;calls.length=0;replies=[];
   if(scenario==="missing")assert.equal(await deliverEncouragement(context,"thanks"),false);
   else await assert.rejects(()=>deliverEncouragement(context,"thanks"));
   assert.equal(calls.some(c=>c.method==="chat.postMessage"),false);
 }
 mode="race";calls.length=0;replies=[];await assert.rejects(()=>deliverEncouragement(context,"thanks"),/parent disappeared/);
 assert.deepEqual(calls.find(c=>c.method==="chat.delete").body,{channel:"CDAILY",ts:"1791532806.437229"});
 mode="lost";calls.length=0;replies=[];assert.equal(await deliverEncouragement(context,"thanks"),true);
 assert.equal(calls.filter(c=>c.method==="chat.postMessage").length,1);
 calls.length=0;assert.equal(await deliverEncouragement({...context,thread:""},"thanks"),false);assert.equal(calls.length,0);
 mock.module("../src/community-record-publication.ts",()=>({publishStatus:async()=>"delivery",undoChange:async()=>{}}));
 mock.module("../src/community-milestones.ts",()=>({emitMilestones:async()=>{}}));
 mock.module("../src/community-emoji.ts",()=>({randomCustomEmoji:async()=>[],customBotEmoji:async(_token,text)=>text}));
 mock.module("../src/community-language.ts",()=>({generateEncouragement:async()=>"thanks"}));
 const {applyChange}=await import("../src/community-records.ts");
 const records=[];let saved=0;
 const applied={...context,source:context.thread,env:{...context.env,AI:{}},store:{
   async change(){saved++;return{changed:true,conflict:false,undoKey:"undo",day:{date:context.date,outcome:"complete",revision:2}};},
   async putRecord(r){records.push(r);},async listRecords(){return[];},
 }};
 mode="missing";calls.length=0;replies=[];
 // Ignore reactions to the vanished source in this regression fixture.
 const transport=globalThis.fetch;globalThis.fetch=(url,opts)=>new URL(url).pathname.endsWith("reactions.add")?Promise.resolve(Response.json({ok:true})):transport(url,opts);
 await applyChange(applied,{action:"reflection",text:"saved review"});
 assert.equal(saved,1,"missing optional reply must not undo or retry the saved member review");
 assert.equal(calls.some(c=>c.method==="chat.postMessage"),false);
 assert.equal(records.some(r=>r.kind==="encouragement"),false,"a skipped message is not recorded as sent");
 console.log("PASS encouragement stays in live thread; deleted parent, API failure, vanished-parent race and lost response never intentionally repost at channel root");
}finally{globalThis.fetch=original;}
