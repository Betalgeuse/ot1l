import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
const exec=promisify(execFile),root=resolve(import.meta.dirname,".."),pg=process.env.PG_BIN??"/opt/homebrew/opt/postgresql@17/bin";
const temp=await mkdtemp(join(tmpdir(),"otl-deployer-pg-")),data=join(temp,"data"),socket=join(temp,"socket"),port=String(59000+Math.floor(Math.random()*5000));
const env={...process.env,PGHOST:socket,PGPORT:port,PGDATABASE:"postgres"};let started=false;
const run=(bin,args)=>exec(bin,args,{cwd:root,env,encoding:"utf8"});
try{
 await run("mkdir",["-p",socket]);await run(join(pg,"initdb"),["-D",data,"--no-locale","--encoding=UTF8","--auth=trust"]);await run(join(pg,"pg_ctl"),["-D",data,"-o",`-F -k ${socket} -p ${port}`,"-l",join(temp,"postgres.log"),"-w","start"]);started=true;
 const files=(await readdir(join(root,"migrations"))).filter(x=>/^\d{3}_.*\.sql$/.test(x)).sort();
 for(const file of files.filter(x=>Number(x.slice(0,3))<=5))await run(join(pg,"psql"),["-X","-v","ON_ERROR_STOP=1","-f",`migrations/${file}`]);
 await run(join(pg,"psql"),["-X","-v","ON_ERROR_STOP=1","--single-transaction","-f","migrations/006_normalized_foundation.sql","-f","migrations/007_normalized_legacy.sql"]);
 for(const file of files.filter(x=>Number(x.slice(0,3))>=8))await run(join(pg,"psql"),["-X","-v","ON_ERROR_STOP=1","-f",`migrations/${file}`]);
 const claim=(await run(join(pg,"psql"),["-XAtq","-v","ON_ERROR_STOP=1","-c",`SELECT otl.bug_runner_claim_deployment('{"teamId":"TQA","workerId":"deploy","leaseToken":"lease","now":"2026-09-29T00:00:00Z"}'::jsonb)`])).stdout.trim();
 assert.equal(claim,"null");
 const grants=(await run(join(pg,"psql"),["-XAtq","-c",`SELECT has_function_privilege('otl_bug_runner','otl.bug_runner_claim_deployment(jsonb)','EXECUTE') AND NOT has_function_privilege('public','otl.bug_runner_claim_deployment(jsonb)','EXECUTE')`])).stdout.trim();
 assert.equal(grants,"t");
 const repositoryContract=(await run(join(pg,"psql"),["-XAtq","-c",`SELECT position('p->>''prUrl''' in pg_get_functiondef('otl.bug_runner_finish_fix(jsonb)'::regprocedure))>0 AND position('Betalgeuse/otl1' in pg_get_functiondef('otl.bug_runner_finish_fix(jsonb)'::regprocedure))=0 AND EXISTS(SELECT 1 FROM otl.schema_migrations WHERE version='061-repository-identity')`])).stdout.trim();
 assert.equal(repositoryContract,"t");
 await run(join(pg,"psql"),["-XAtq","-v","ON_ERROR_STOP=1","-c",`SELECT otl.community_execute('change','{"teamId":"T-PROGRESS","channelId":"C-PROGRESS","userId":"U-PROGRESS","date":"2026-09-30","key":"goal","action":"goal","text":"탐색안 검증"}'::jsonb); UPDATE otl.workspaces SET primary_goal_channel_id='C-PROGRESS' WHERE team_id='T-PROGRESS'; SELECT otl.community_execute('change','{"teamId":"T-PROGRESS","channelId":"C-PROGRESS","userId":"U-PROGRESS","date":"2026-09-30","key":"progress","action":"progress"}'::jsonb);`]);
 const progressContract=(await run(join(pg,"psql"),["-XAtq","-c",`SELECT (SELECT outcome='progress' FROM otl.community_days WHERE team_id='T-PROGRESS' AND channel_id='C-PROGRESS' AND user_id='U-PROGRESS' AND day='2026-09-30') AND (SELECT completed FROM otl.goals WHERE team_id='T-PROGRESS' AND user_id='U-PROGRESS' AND goal_date='2026-09-30') AND EXISTS(SELECT 1 FROM otl.schema_migrations WHERE version='062-meaningful-progress')`])).stdout.trim();
 assert.equal(progressContract,"t");
 const fixFailureGrant=(await run(join(pg,"psql"),["-XAtq","-c",`SELECT has_function_privilege('otl_bug_runner','otl.bug_runner_fail_fix(jsonb)','EXECUTE') AND NOT has_function_privilege('public','otl.bug_runner_fail_fix(jsonb)','EXECUTE') AND EXISTS(SELECT 1 FROM otl.schema_migrations WHERE version='063-fix-runner-failure-recovery')`])).stdout.trim();
 assert.equal(fixFailureGrant,"t");
 await run(join(pg,"psql"),["-XAtq","-v","ON_ERROR_STOP=1","-c",`
   INSERT INTO otl.bug_reports(bug_id,team_id,state,public_alias,reporter_id,source,source_opaque_ref,source_channel_id,source_thread,title)
   VALUES('BUG-FIXRETRY0001','TQA','fixing','B-FIXRETRY0001','UREPORTER','slack','slack:TQA:CFEEDBACK:1','CFEEDBACK','1.1','retry fixture'),
         ('BUG-FIXFAILED001','TQA','fixing','B-FIXFAILED001','UREPORTER','slack','slack:TQA:CFEEDBACK:2','CFEEDBACK','2.2','failure fixture');
   WITH jobs AS (
     INSERT INTO otl.bug_jobs(bug_id,kind,status,payload,payload_digest,worker_id,lease_token,lease_expires_at,attempt)
     VALUES('BUG-FIXRETRY0001','fix','leased','{}','${"a".repeat(64)}','runner','lease-retry',clock_timestamp()+interval '10 minutes',1),
           ('BUG-FIXFAILED001','fix','leased','{}','${"b".repeat(64)}','runner','lease-failed',clock_timestamp()+interval '10 minutes',3)
     RETURNING bug_id,job_id
   )
   INSERT INTO otl.agent_runs(run_id,bug_id,job_id,account_alias,base_sha,prompt_digest,provider,provider_task_id,provider_task_url)
   SELECT CASE bug_id WHEN 'BUG-FIXRETRY0001' THEN 'run-retry' ELSE 'run-failed' END,bug_id,job_id,'primary','${"c".repeat(40)}','${"d".repeat(64)}','codex_cloud_cli',
     CASE bug_id WHEN 'BUG-FIXRETRY0001' THEN 'task_e_${"1".repeat(32)}' ELSE 'task_e_${"2".repeat(32)}' END,
     CASE bug_id WHEN 'BUG-FIXRETRY0001' THEN 'https://chatgpt.com/codex/tasks/task_e_${"1".repeat(32)}' ELSE 'https://chatgpt.com/codex/tasks/task_e_${"2".repeat(32)}' END
   FROM jobs;
   SELECT otl.bug_runner_fail_fix(jsonb_build_object('teamId','TQA','jobId',(SELECT job_id FROM otl.bug_jobs WHERE bug_id='BUG-FIXRETRY0001'),'workerId','runner','leaseToken','lease-retry','runId','run-retry','exitClass','fix_artifact_failed','elapsedMs',1000,'artifactDigest','${"e".repeat(64)}','resultDigest','${"f".repeat(64)}','errorCode','fix_artifact'));
   SELECT otl.bug_runner_fail_fix(jsonb_build_object('teamId','TQA','jobId',(SELECT job_id FROM otl.bug_jobs WHERE bug_id='BUG-FIXFAILED001'),'workerId','runner','leaseToken','lease-failed','runId','run-failed','exitClass','fix_artifact_failed','elapsedMs',1000,'artifactDigest','${"e".repeat(64)}','resultDigest','${"f".repeat(64)}','errorCode','fix_artifact'));
 `]);
 const fixFailureContract=(await run(join(pg,"psql"),["-XAtq","-c",`SELECT
   (SELECT status='queued' AND worker_id IS NULL AND lease_token IS NULL FROM otl.bug_jobs WHERE bug_id='BUG-FIXRETRY0001')
   AND (SELECT state='fixing' FROM otl.bug_reports WHERE bug_id='BUG-FIXRETRY0001')
   AND (SELECT status='failed' FROM otl.bug_jobs WHERE bug_id='BUG-FIXFAILED001')
   AND (SELECT state='fix_failed' FROM otl.bug_reports WHERE bug_id='BUG-FIXFAILED001')
   AND EXISTS(SELECT 1 FROM otl.bug_runner_notifications WHERE bug_id='BUG-FIXFAILED001' AND kind='task_failed')`])).stdout.trim();
 assert.equal(fixFailureContract,"t");
 console.log("PASS migrations 060-063 repository, progress, and fix failure recovery contracts");
}finally{if(started)await run(join(pg,"pg_ctl"),["-D",data,"-m","fast","-w","stop"]).catch(()=>{});await rm(temp,{recursive:true,force:true});}
