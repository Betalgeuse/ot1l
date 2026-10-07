import assert from 'node:assert/strict';
import { activateMaintainer, maintainerButton } from '../src/community-maintainers.ts';
const calls=[]; const transitions=[]; let changed=true; let failInvite=false; let revoked=false;
const context={env:{SLACK_BOT_TOKEN:'fake',COMMUNITY_MAINTAINERS_CHANNEL_ID:'CMAIN',COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS:'CEVENT, CWEB,CWELCOME,CEVENT',COMMUNITY_SYS_ALERT_CHANNEL_ID:'CALERT'},scope:{teamId:'TQA',channelId:'CFEEDBACK',userId:'UMEMBER'},store:{
 async maintainerStatus(){return revoked?{state:'revoked'}:null},
 async syncMaintainerProfile(team,actor,name){transitions.push(['profile',team,actor,name])},
 async activateMaintainer(team,actor){transitions.push(['activate',team,actor]);const was=changed;changed=false;return{userId:actor,changed:was,state:'active'}},
}};
const original=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{const method=new URL(url).pathname.split('/').at(-1);const body=options.body?JSON.parse(options.body):{};calls.push({method,body});
 if(method==='users.info')return Response.json({ok:true,user:{id:'UMEMBER',team_id:'TQA',is_bot:false,is_app_user:false,deleted:false,real_name:'Member'}});
 if(method==='conversations.invite'&&failInvite)return Response.json({ok:false,error:'missing_scope'});
 return Response.json({ok:true,ts:'1.000001',message_ts:'1.000002'});
};
try{
 assert.equal(JSON.parse(maintainerButton().value).ownerId,'actor');
 assert.equal(maintainerButton().text.text,'Product Owner 되기');
 await activateMaintainer(context);
 assert.deepEqual(transitions,[['profile','TQA','UMEMBER','Member'],['activate','TQA','UMEMBER']]);
 assert.deepEqual(calls.filter(c=>c.method==='conversations.invite').map(c=>c.body.channel),['CMAIN','CEVENT','CWEB','CWELCOME','CALERT']);
 assert.ok(calls.filter(c=>c.method==='conversations.invite').every(c=>c.body.users==='UMEMBER'));
 await activateMaintainer(context);
 assert.equal(calls.filter(c=>c.method==='chat.postMessage').length,1);
 assert.match(calls.filter(c=>c.method==='chat.postEphemeral').at(-1).body.text,/이미 Product Owner/);
 failInvite=true; const before=transitions.filter(t=>t[0]==='activate').length;
 await assert.rejects(()=>activateMaintainer(context),/missing_scope/);
 assert.equal(transitions.filter(t=>t[0]==='activate').length,before);
 revoked=true; const invitesBefore=calls.filter(c=>c.method==='conversations.invite').length;
 await assert.rejects(()=>activateMaintainer(context),/제한된 계정/);
 assert.equal(calls.filter(c=>c.method==='conversations.invite').length,invitesBefore);
 console.log('PASS verified member activation, five-channel invitations, repair retry and failure boundaries');
}finally{globalThis.fetch=original}
