import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
const temp=await mkdtemp(join(tmpdir(),"otl1-alarm-recovery-"));
const scriptPath=join(temp,"worker.js");
execFileSync("bun",["build","qa/fixtures/alarm-recovery-runtime.ts","--target=browser","--external=cloudflare:workers",`--outfile=${scriptPath}`]);
let sawRequest;
const started=new Promise(resolve=>{sawRequest=resolve;});
let releaseRequest;
const gate=new Promise(resolve=>{releaseRequest=resolve;});
const mf=new Miniflare({modules:true,scriptPath,modulesRoot:temp,compatibilityDate:"2026-01-01",
  durableObjects:{COMMUNITY_CLOCK:{className:"InterruptedClock",useSQLite:true}},
  bindings:{DATABASE_URL:"postgresql://qa:qa@example.neon.tech/test",SLACK_TEAM_ID:"TQA",COMMUNITY_ENABLED:"true",
    COMMUNITY_ADMIN_ID:"UADMIN",COMMUNITY_CHANNEL_ID:"CQA",COMMUNITY_PUBLIC_CHANNEL_ID:"CPUBLIC"},
  outboundService:async req=>{
    assert.equal(new URL(req.url).host,"example.neon.tech","all external traffic is local fake Neon");
    sawRequest();await gate;return Response.json({rows:[[null]]});
  },
});
try {
  await mf.dispatchFetch("https://test/arm");
  let timer;
  try {await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("alarm did not execute")),5000);})]);}
  finally{clearTimeout(timer);}
  const running=await(await mf.dispatchFetch("https://test/inspect")).json();
  assert.equal(running.lastRun.status,"running");
  assert.ok(running.next>Date.now(),"alarm must be persisted before the pending external request");
  await mf.dispatchFetch("https://test/interrupt");
  const restarted=await(await mf.dispatchFetch("https://test/inspect")).json();
  assert.equal(restarted.role,"community_schedule");
  assert.equal(restarted.lastRun.status,"running","interruption is not falsely recorded as finished");
  assert.ok(restarted.next!==null,"pending retry survives a real workerd Durable Object reset");
  console.log("PASS workerd alarm interrupted during I/O retains durable retry and incomplete-run evidence");
} finally {releaseRequest();await mf.dispose();await rm(temp,{recursive:true,force:true});}
