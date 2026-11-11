import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {departmentHandler} from '../supabase/functions/platform-departments/index.ts';

test('departamentos: convite exige administrador geral e preserva senha de conta existente',async()=>{
 let platform=false;const calls=[];
 const handler=departmentHandler(k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'public'})[k],async(url,opts)=>{
  calls.push({url,...opts});let data={};
  if(url.endsWith('/auth/v1/user'))data={id:'caller'};
  else if(url.includes('/fs_platform_admins?'))data=platform?[{user_id:'caller'}]:[];
  else if(url.includes('/fs_members?'))data=[];
  else if(url.endsWith('/fs_find_auth_user'))data='known-user';
  else if(url.includes('/auth/v1/admin/users/'))data={id:'known-user',email_confirmed_at:'2026-10-01'};
  else if(url.includes('/fs_department_invites?')&&opts.method==='GET')data=[];
  else if(url.endsWith('/fs_department_invites')&&opts.method==='POST')data=[{id:'invitation-test'}];
  return new Response(JSON.stringify(data),{status:200});
 });
 const invoke=(body,auth=true)=>handler(new Request('https://function.test',{method:'POST',headers:{...(auth?{Authorization:'Bearer session'}:{}),origin:'https://tuliodubiella-arch.github.io','Content-Type':'application/json'},body:JSON.stringify(body)}));
 assert.equal((await invoke({},false)).status,401);
 assert.equal((await invoke({action:'invite-department',name:'Pessoa',email:'p@example.test'})).status,403);
 assert.ok(!calls.some(c=>c.url.includes('/otp?')||c.url.includes('/invite?')));
 platform=true;assert.equal((await invoke({action:'invite-department',name:'Pessoa',email:'p@example.test'})).status,200);
 assert.ok(calls.some(c=>c.url.includes('/otp?')&&JSON.parse(c.body).create_user===false));
 assert.ok(!calls.some(c=>c.method==='PUT'&&c.url.includes('/auth/v1/admin/users/')));
 assert.ok(!calls.some(c=>c.url.endsWith('/fs_members')&&c.method==='POST'));
 const invitation=calls.find(c=>c.url.endsWith('/fs_department_invites')&&c.method==='POST');assert.equal(JSON.parse(invitation.body).created_by,'caller');assert.equal(JSON.parse(invitation.body).user_id,'known-user');
});

test('departamentos: fila de convites usa apenas o departamento do administrador autenticado',async()=>{
 const calls=[];let role='member';
 const handler=departmentHandler(k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'public'})[k],async(url,opts)=>{
  calls.push({url,...opts});let data=[];
  if(url.endsWith('/auth/v1/user'))data={id:'caller'};
  else if(url.includes('/fs_members?'))data=[{role,active:true,department_id:'real-department'}];
  else if(url.includes('fs_team_invite_queue?select=id,name,email'))data=[{id:'queued',name:'Pessoa',email:'p@example.test'}];
  else if(url.includes('/fiscal-invite-member'))data={ok:true};
  return new Response(JSON.stringify(data),{status:200});
 });
 const invoke=()=>handler(new Request('https://function.test',{method:'POST',headers:{Authorization:'Bearer session',origin:'https://tuliodubiella-arch.github.io'},body:JSON.stringify({action:'send-team',department_id:'forged-department'})}));
 assert.equal((await invoke()).status,403);assert.ok(!calls.some(c=>c.url.includes('fs_team_invite_queue')));
 role='admin';assert.equal((await invoke()).status,200);
 for(const call of calls.filter(c=>c.url.includes('fs_team_invite_queue')))assert.ok(call.url.includes('department_id=eq.real-department'));
 assert.ok(!calls.some(c=>c.url.includes('forged-department')));
 assert.ok(calls.some(c=>c.url.endsWith('/fiscal-invite-member')&&c.headers.Authorization==='Bearer session'));
});

test('departamentos: contexto sem departamento não consulta rotinas, notas ou cadastros',async()=>{
 const calls=[];let context={user:{id:'invited',name:'Pessoa'},onboarding:{invitationId:'invite'},platformAdmin:false,department:null};
 const ctx=vm.createContext({window:{FISCAL_CLOUD:{url:'https://test.supabase.co',key:'public'}},localStorage:{getItem:()=>JSON.stringify({access_token:'session',refresh_token:'refresh',expires_at:Date.now()/1000+3600}),setItem(){},removeItem(){}},Date,JSON,Error,Map,Set,Uint8Array,atob,fetch:async(url,opts)=>{calls.push({url,...opts});return {status:200,ok:true,json:async()=>url.endsWith('fs_get_context')?context:{departments:[]}};}});
 vm.runInContext(await readFile('public/cloud-api.js','utf8'),ctx);
 let state=await ctx.window.FiscalCloud.api('state');assert.equal(state.items.length,0);assert.ok(state.platformContext.onboarding);
 context={user:{id:'general'},platformAdmin:true,department:null};state=await ctx.window.FiscalCloud.api('state');assert.equal(state.items.length,0);assert.equal(state.platformContext.platformAdmin,true);
 assert.ok(!calls.some(c=>/fs_get_state|fs_get_personal|fs_get_registries/.test(c.url)));
 await ctx.window.FiscalCloud.api('platform-summary');assert.ok(calls.some(c=>c.url.endsWith('fs_platform_summary')));
});

test('departamentos: administração separada, identificação dinâmica e conteúdo escapado',async()=>{
 const ctx=vm.createContext({state:{user:{id:'u',role:'admin'},platformContext:{platformAdmin:true,department:{id:'fiscal',name:'Fiscal'}}},nav:[['overview','x','Visão geral'],['routine','r','Rotinas fiscais']],heading:(k,t,s,a)=>t+(a||''),empty:t=>t,esc:v=>String(v??'').replaceAll('<','&lt;'),date:v=>v,time:v=>v});
 vm.runInContext(await readFile('public/departments.js','utf8'),ctx);const get=s=>vm.runInContext(s,ctx);
 assert.equal(get('departmentNavigation().length'),3);
 get("platformSummary={departments:[{id:'d',name:'RH <teste>',administrator:'Pessoa',users:4,routines:8,createdAt:'2026-11-11',active:true}],invitations:[]}");
 assert.ok(get('departmentsContent()').includes('RH &lt;teste>'));assert.ok(get('departmentsContent()').includes('Convidar departamento'));assert.ok(!get('departmentsContent()').includes('data-open='));
 get('state.platformContext.platformAdmin=false');assert.ok(!get('departmentsContent()').includes('RH &lt;teste>'));
 get("state.platformContext.department={id:'rh',name:'Recursos Humanos'}");assert.equal(get("departmentNavigation()[1][2]"),'Rotinas da equipe');
 get('state.platformContext={platformAdmin:true,department:null}');assert.equal(get('departmentNavigation().length'),1);
});

test('departamentos: uma resposta antiga não exibe dados após sair da conta',async()=>{
 let release;const saved=new Map([['cavalca-fiscal-session-v1',JSON.stringify({access_token:'old-session',refresh_token:'refresh',expires_at:Date.now()/1000+3600})]]);
 const ctx=vm.createContext({window:{FISCAL_CLOUD:{url:'https://test.supabase.co',key:'public'}},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},Date,JSON,Error,Map,Set,Uint8Array,atob,fetch:async url=>{if(url.endsWith('fs_platform_summary'))await new Promise(resolve=>{release=resolve;});return {status:200,ok:true,json:async()=>({departments:[{name:'Dados da conta anterior'}]})};}});
 vm.runInContext(await readFile('public/cloud-api.js','utf8'),ctx);const api=ctx.window.FiscalCloud.api;
 const pending=api('platform-summary');while(!release)await new Promise(resolve=>setImmediate(resolve));
 await api('logout','POST');release();await assert.rejects(()=>pending,e=>e.status===409);assert.equal(saved.size,0);
});
