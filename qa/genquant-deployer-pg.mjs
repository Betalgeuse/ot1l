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
 console.log("PASS migrations 060-061 deploy claim and repository identity remain runner-only and configuration-bound");
}finally{if(started)await run(join(pg,"pg_ctl"),["-D",data,"-m","fast","-w","stop"]).catch(()=>{});await rm(temp,{recursive:true,force:true});}
