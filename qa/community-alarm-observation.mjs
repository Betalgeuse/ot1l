import assert from "node:assert/strict";
import {beginAlarmObservation,finishAlarmObservation} from "../src/community-alarm-observation.ts";
import {alarmSignals} from "../src/log-alert-observation.ts";
const values=new Map(),logs=[];
const storage={async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));}};
const originalLog=console.log;console.log=line=>logs.push(JSON.parse(line));
try{
 const first=await beginAlarmObservation(storage,"community_schedule",1000);
 const retry=await beginAlarmObservation(storage,"community_schedule",2000);
 assert.equal(retry.id,first.id);assert.equal(retry.attempt,2);
 await finishAlarmObservation(storage,retry,"community_schedule",false);
 const again=await beginAlarmObservation(storage,"community_schedule",3000);
 assert.equal(again.id,first.id,"incomplete queue cannot become another successful run");
 await finishAlarmObservation(storage,again,"community_schedule",true);
 const next=await beginAlarmObservation(storage,"community_schedule",4000);
 assert.notEqual(next.id,first.id);
 assert.ok(logs.some(l=>l.phase==="complete"&&l.cycleId===first.id));
 assert.equal(logs.at(-2).phase,"complete","completed receipt is replayed before starting a different cycle");
 assert.ok(logs.every(l=>!JSON.stringify(l).includes("UADMIN")));
 const emitted=await alarmSignals({scriptName:"otl1-onething-garden",durableObjectId:"a".repeat(64),event:{scheduledTime:new Date()},eventTimestamp:Date.now(),outcome:"ok",truncated:false,exceptions:[],logs:logs.map(row=>({level:"log",message:[JSON.stringify(row)]}))});
 assert.ok(emitted.some(s=>s.cycleId===first.id&&s.phase==="complete"),"actual producer receipts must reach the Tail parser");
}finally{console.log=originalLog;}
console.log("PASS alarm cycle survives retries, never completes a failed run, and replays durable completion");
