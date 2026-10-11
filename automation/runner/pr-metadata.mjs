import {createHash,randomUUID} from 'node:crypto';

export class PrMetadataError extends Error {
 constructor(code,retryable=false,retryAfterSeconds=60){super(code);this.code=code;this.retryable=retryable;this.retryAfterSeconds=retryAfterSeconds;}
}

export function readPrMetadata(prNumber,run) {
 if(!Number.isSafeInteger(prNumber)||prNumber<1)throw new PrMetadataError('pr_invalid_metadata');
 const api=path=>{
  try{return JSON.parse(run('gh',['api',path],{timeout:20000}));}
  catch(e){
   const diagnostic=String(e.stderr??'')+'\n'+String(e.stdout??'');
   if(/rate limit|HTTP 429/i.test(diagnostic)){
    const retry=Number(diagnostic.match(/retry-after:\s*(\d+)/i)?.[1]);
    const reset=Number(diagnostic.match(/x-ratelimit-reset:\s*(\d+)/i)?.[1]);
    const delay=Number.isFinite(retry)&&retry>0?retry:Number.isFinite(reset)&&reset>0?Math.max(60,Math.ceil(reset-Date.now()/1000)):3600;
    throw new PrMetadataError('github_rate_limited',true,Math.min(delay,86400));
   }
   if(/HTTP 404/.test(diagnostic))throw new PrMetadataError('pr_missing');
   if(/HTTP 401/.test(diagnostic))throw new PrMetadataError('github_auth_required');
   if(/HTTP 403/.test(diagnostic))throw new PrMetadataError('github_forbidden');
   throw new PrMetadataError('github_unavailable',true,120);
  }
 };
 const path=`repos/Betalgeuse/ot1l/pulls/${prNumber}`;
 const check=p=>{
  if(p.state!=='open')throw new PrMetadataError('pr_not_open');
  if(p.base?.ref!=='main'||p.base?.repo?.full_name!=='Betalgeuse/ot1l')throw new PrMetadataError('pr_wrong_base');
  if(!/^[a-f0-9]{40}$/.test(p.head?.sha??'')||!/^[-\w.]+\/[-\w.]+$/.test(p.head?.repo?.full_name??''))throw new PrMetadataError('pr_invalid_metadata');
  if(!Number.isSafeInteger(p.changed_files)||p.changed_files<1)throw new PrMetadataError('pr_invalid_metadata');
  if(p.changed_files>100)throw new PrMetadataError('pr_too_large');
 };
 const before=api(path);check(before);
 if(before.draft)return {draft:true};
 const files=api(`${path}/files?per_page=100`);
 if(!Array.isArray(files)||files.length!==before.changed_files||files.some(f=>typeof f.filename!=='string'||!f.filename))throw new PrMetadataError('pr_changed',true);
 const after=api(path);check(after);
 if(after.draft||after.head.sha!==before.head.sha||after.base.sha!==before.base.sha||after.changed_files!==before.changed_files||after.head.repo.full_name!==before.head.repo.full_name)throw new PrMetadataError('pr_changed',true);
 const paths=[...new Set(files.flatMap(f=>f.previous_filename?[f.previous_filename,f.filename]:[f.filename]))].sort();
 if(paths.length>100)throw new PrMetadataError('pr_too_large');
 return {draft:false,headSha:before.head.sha,headRepository:before.head.repo.full_name,title:String(before.title??`PR #${prNumber}`).slice(0,1000),paths,pathsDigest:createHash('sha256').update(JSON.stringify(paths)).digest('hex')};
}

export async function processPrMetadata(db,config,workerId,run){
 const leaseToken=randomUUID();
 const row=await db('bug_runner_claim_pr_metadata',{teamId:config.SLACK_TEAM_ID,workerId,leaseToken});
 if(!row)return false;
 const identity={teamId:config.SLACK_TEAM_ID,requestId:Number(row.request_id),workerId,leaseToken};
 let result;
 try{const metadata=readPrMetadata(Number(row.pr_number),run);result={...identity,outcome:metadata.draft?'draft':'ready',metadata};}
 catch(error){result={...identity,outcome:'failed',errorCode:error instanceof PrMetadataError?error.code:'github_unavailable',retryable:error instanceof PrMetadataError?error.retryable:true,retryAfterSeconds:error instanceof PrMetadataError?error.retryAfterSeconds:120};}
 // Do not turn a lost DB acknowledgement into a second, contradictory finish.
 await db('bug_runner_finish_pr_metadata',result);
 return true;
}
