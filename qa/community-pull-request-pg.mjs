import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "otl-bound-pg-"));
const socket = join(temp, "socket"), data = join(temp, "data");
mkdirSync(socket);
const env = { ...process.env, PGHOST: socket, PGPORT: "55483", PGDATABASE: "postgres" };
const run = (b, args) => execFileSync(b, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sql = q => run("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", q]).trim();
const call = (fn, p) => JSON.parse(sql(`SELECT otl.${fn}(convert_from(decode('${Buffer.from(JSON.stringify(p)).toString("base64")}','base64'),'UTF8')::jsonb)`));
let started = false;
try {
  run("initdb", ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  run("pg_ctl", ["-D", data, "-o", `-F -k ${socket} -p 55483 -h ''`, "-l", join(temp,"pg.log"), "-w", "start"]);
  started = true;
  for (const f of readdirSync("migrations").filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()) {
    if (f.startsWith("007_")) continue;
    const args = ["-Xq", "-v", "ON_ERROR_STOP=1"];
    if (f.startsWith("006_")) args.push("--single-transaction", "-f", `migrations/${f}`, "-f", "migrations/007_normalized_legacy.sql");
    else args.push("-f", `migrations/${f}`);
    try { run("psql", args); } catch (error) { throw new Error(`${f}: ${error.stderr}`); }
  }
  sql(`INSERT INTO otl.bug_reports(bug_id,team_id,state,revision,packet_revision,public_alias,reporter_id,source,source_opaque_ref,source_channel_id,source_thread,title,actual,expected,confirmed_packet_digest,confirmed_evidence_digest)
    VALUES('BUG-BOUNDTEST01','TQA','triaged',1,1,'B-BOUNDTEST01','UQA','slack','slack:bound:qa','CPO','1.000001','PR QA','actual','expected',repeat('a',64),repeat('b',64));
    INSERT INTO otl.bug_report_revisions(bug_id,packet_revision,schema_version,status,sanitized_fields,opaque_ref,object_digest,envelope_dek,kek_version,nonce,evidence_digest,packet_digest,confirmed_packet,reporter_confirmed,confirmed_at,evidence_object_digest)
    VALUES('BUG-BOUNDTEST01',1,'feedback_packet.v1','confirmed','{"actual":"actual","expected":"expected"}','object/bound/qa',repeat('c',64),repeat('e',32),'v1','nonce-boundtest',repeat('b',64),repeat('a',64),'{"schemaVersion":"feedback_packet.v1","status":"confirmed","fields":{"actual":"actual","expected":"expected"}}',true,clock_timestamp(),repeat('c',64));
    INSERT INTO otl.bug_jobs(bug_id,kind,payload,payload_digest) VALUES('BUG-BOUNDTEST01','reproduce','{}',repeat('a',64));`);
  const input = { teamId:"TQA", actorId:"UQA", founderId:"UQA", workKey:"BUG-BOUNDTEST01", headRepository:"contributor/ot1l", number:17, pullUrl:"https://github.com/Betalgeuse/ot1l/pull/17", headSha:"a".repeat(40), paths:["event-site/src/index.ts"], pathsDigest:"b".repeat(64) };
  assert.throws(() => call("community_bind_pull_request", { ...input, actorId:"UNOTPO" }));
  sql("UPDATE otl.bug_jobs SET status='leased',worker_id='worker',lease_token='lease',lease_expires_at=clock_timestamp()+interval '1 minute' WHERE bug_id='BUG-BOUNDTEST01'");
  assert.equal(call("community_bind_pull_request", input).reason,"automatic_work_running");
  sql("UPDATE otl.bug_jobs SET status='queued',worker_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE bug_id='BUG-BOUNDTEST01'");
  const bound = call("community_bind_pull_request", input);
  assert.equal(bound.accepted, true);
  assert.equal(sql("SELECT state FROM otl.bug_reports WHERE bug_id='BUG-BOUNDTEST01'"), "reviewing");
  assert.equal(sql("SELECT status FROM otl.bug_jobs WHERE bug_id='BUG-BOUNDTEST01'"), "cancelled");
  assert.equal(call("community_bind_pull_request", input).reason,"duplicate");
  const identity = {teamId:"TQA",workerId:"worker",leaseToken:"bound-lease"};
  let claimed = call("bug_runner_claim_bound_pull", identity);
  assert.equal(call("bug_runner_fail_bound_pull", {...identity,bindingId:claimed.binding_id}).accepted,true);
  assert.equal(sql("SELECT count(*) FROM otl.bug_runner_notifications WHERE bug_id='BUG-BOUNDTEST01' AND kind='task_failed'"),"1");
  assert.equal(call("community_bind_pull_request",input).accepted,true);
  claimed = call("bug_runner_claim_bound_pull", identity);
  const finish = {...identity,bindingId:claimed.binding_id,headSha:input.headSha,changedPaths:input.paths,changeClass:"open",classificationDigest:"c".repeat(64)};
  assert.throws(() => call("bug_runner_finish_bound_pull", {...finish, teamId:"TOTHER"}));
  assert.equal(call("bug_runner_finish_bound_pull",finish).accepted,true);
  assert.equal(sql("SELECT state FROM otl.bug_reports WHERE bug_id='BUG-BOUNDTEST01'"),"merge_eligible");
  assert.equal(sql("SELECT count(*) FROM otl.bug_events WHERE bug_id='BUG-BOUNDTEST01' AND variant IN('external_pull','external_pull_verified')"),"3");
  assert.equal(sql("SELECT count(*) FROM otl.git_changes WHERE bug_id='BUG-BOUNDTEST01'"),"1");
  assert.throws(() => call("bug_runner_finish_bound_pull",finish));
  const approval = {teamId:"TQA",bugId:input.workKey,packetRevision:1,prNumber:17,actorId:"UQA",founderId:"UQA",headSha:input.headSha,classificationDigest:finish.classificationDigest,idempotencyKey:"qa-bound-approval"};
  assert.throws(() => call("bug_actor_approve_merge",{...approval,headSha:"e".repeat(40)}));
  assert.equal(call("bug_actor_approve_merge",approval).accepted,true);
  const merge = call("bug_runner_claim_merge",{...identity,leaseToken:"merge-lease"});
  assert.equal(merge.prNumber,17);
  assert.equal(merge.headSha,input.headSha);
  assert.equal(merge.runId,`bound-pr-${claimed.binding_id}`);
  console.log("PASS real PostgreSQL: role/team guards, running-job rejection, queued-job cancellation, transition ledger, exact one change");
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(temp, { recursive:true,force:true });
}
