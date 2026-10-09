// Explicit local visual QA: fake Core, no secrets and no live membership writes.
import {resolve} from 'node:path';
import siteWorker from '../src/index.ts';
const root=resolve('site/dist');
const env={ASSETS:{async fetch(request){const path=resolve(root,'.'+new URL(request.url).pathname);if(!path.startsWith(root+'/'))return new Response('not found',{status:404});const file=Bun.file(path);return await file.exists()?new Response(file):new Response('not found',{status:404});}},CORE:{async fetch(){return Response.json({available:true,inviterName:'테스트 초대자'});}},RATE_LIMITER:{async limit(){return{success:true};}},PUBLIC_INTEREST_ENABLED:'true',TURNSTILE_SITE_KEY:'test',TURNSTILE_SECRET:'test',SITE_CORE_HMAC_SECRET:'test-secret',SLACK_SHARED_INVITE_URL:'https://join.slack.com/t/test/shared_invite/local-qa-only'};
Bun.serve({hostname:'127.0.0.1',port:8789,fetch:request=>siteWorker.fetch(request,env)});
console.log('Local landing QA ready: http://127.0.0.1:8789');
