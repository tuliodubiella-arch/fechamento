import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inviteHandler} from '../supabase/functions/fiscal-invite-member/index.ts';
const origin='https://tuliodubiella-arch.github.io';
test('convites: autenticação, administrador, envio, senha existente e respostas vazias',async()=>{
 let role='admin',known=null,confirmed=false,mailError=false,onboardingPending=false;const calls=[];
 const handler=inviteHandler(k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'service-test'})[k],async(url,opts)=>{
  calls.push({url,...opts});let status=200,data={};
  if(url.endsWith('/auth/v1/user'))data={id:'admin-id'};
  else if(url.includes('/fs_members?select=*&id='))data=[{role,active:true,name:'Administrador',department_id:'own-department'}];
  else if(url.includes('/fs_members?select=id&email='))data=[];
  else if(url.endsWith('/rpc/fs_find_auth_user'))data=known;
  else if(url.includes('/fs_password_onboarding?'))data=onboardingPending?[{user_id:known}]:[];
  else if(url.includes('/fs_members?select=id,email,name'))data=[{id:known,email:'pessoa@example.test',name:'Pessoa',active:true}];
  else if(url.includes('/admin/users/'))data={id:known,email:'pessoa@example.test',...(confirmed?{email_confirmed_at:'2026-10-01'}:{})};
  else if(url.includes('/invite?')){data=mailError?{message:'SMTP'}:{id:'new-user-id'};status=mailError?400:200;}
  else if(url.includes('/otp?'))data={};
  else if(url.endsWith('/fs_members')||url.endsWith('/fs_events'))return new Response(null,{status:201});
  return new Response(JSON.stringify(data),{status});
 });
 const request=(body,auth=true)=>handler(new Request('https://function.test',{method:'POST',headers:{origin,'Content-Type':'application/json',...(auth?{Authorization:'Bearer session-test'}:{})},body:JSON.stringify(body)}));
 assert.equal((await request({},false)).status,401);role='member';assert.equal((await request({name:'Pessoa',email:'pessoa@example.test'})).status,403);assert.ok(!calls.some(c=>c.url.includes('/invite?')));
 role='admin';assert.equal((await request({name:'Pessoa',email:'pessoa@example.test'})).status,200);let inserted=calls.find(c=>c.url.endsWith('/fs_members')&&c.method==='POST');assert.equal(JSON.parse(inserted.body).role,'member');assert.equal(JSON.parse(inserted.body).id,'new-user-id');assert.equal(JSON.parse(inserted.body).department_id,'own-department');assert.ok(!('password' in JSON.parse(inserted.body)));
 known='existing-user-id';confirmed=true;assert.equal((await request({name:'Pessoa',email:'pessoa@example.test'})).status,200);assert.ok(calls.some(c=>c.url.includes('/otp?')&&JSON.parse(c.body).create_user===false));assert.ok(!calls.some(c=>c.method==='PUT'&&c.url.includes('/admin/users/')));
 known='e9048350-ad60-4ed4-a132-03b6eeb12345';confirmed=true;onboardingPending=true;const beforeResend=calls.length;assert.equal((await request({action:'resend',memberId:known})).status,200);assert.ok(calls.slice(beforeResend).some(c=>c.url.includes('/otp?')));assert.ok(!calls.slice(beforeResend).some(c=>c.url.includes('/invite?')||c.method==='PUT'));assert.ok(calls.slice(beforeResend).some(c=>c.url.includes('department_id=eq.own-department')));onboardingPending=false;assert.equal((await request({action:'resend',memberId:known})).status,409);
 known=null;confirmed=false;mailError=true;const count=calls.filter(c=>c.url.endsWith('/fs_members')&&c.method==='POST').length;assert.equal((await request({name:'Pessoa',email:'pessoa@example.test'})).status,400);assert.equal(calls.filter(c=>c.url.endsWith('/fs_members')&&c.method==='POST').length,count);
});
