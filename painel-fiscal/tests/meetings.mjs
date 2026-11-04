import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
test('reuniões: rascunho, publicação atômica, responsáveis, vínculos e repetição sem duplicação',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'fiscal-meetings-')),base='http://localhost:4199/api/';const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4199',DATA_DIR:dir}});
 const req=async(route,method='GET',b,cookie)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 for(let n=0;n<50;n++){try{if((await req('setup')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await req('setup','POST',{name:'Administrador',email:'admin@example.test',password:'Teste-local-123'});const admin=(await req('login','POST',{email:'admin@example.test',password:'Teste-local-123'})).cookie;
 await req('users','POST',{name:'Pessoa da equipe',email:'pessoa@example.test',password:'Teste-local-123'},admin);const member=(await req('login','POST',{email:'pessoa@example.test',password:'Teste-local-123'})).cookie;const user=(await req('state','GET',null,member)).body.user;
 assert.equal((await req('meetings')).status,401);
 const body={action:'save',title:'Reunião fiscal',date:'2026-11-03',topics:'Integrações',minutes:'Conferir os lançamentos e retornar com resultado.',summary:'Conferência da integração',decisions:'Concluir a revisão',attendees:[user.id],actions:[{id:'bc9be5a8-e4b1-47d5-b888-b76e1d8ceddc',title:'Revisar integração',description:'Verificar os lançamentos fiscais',owner:user.id,start:'2026-11-03',end:'2026-11-05',priority:'Alta'}]};
 const id=(await req('meetings','POST',body,admin)).body.id;let meeting=(await req('meetings','GET',null,member)).body[0];assert.equal(meeting.status,'Rascunho');assert.equal((await req('state','GET',null,member)).body.items.length,0);
 const bad={...body,action:'finalize',version:meeting.version,actions:[...body.actions,{...body.actions[0],id:'9578b8b6-a126-4a45-981b-fc59ff6e3736',owner:''}]};assert.equal((await req('meetings/'+id,'PUT',bad,member)).status,400);assert.equal((await req('state','GET',null,member)).body.items.length,0);
 assert.equal((await req('meetings/'+id,'PUT',{...body,action:'finalize',version:meeting.version-1},member)).status,409);
 const finalized=await req('meetings/'+id,'PUT',{...body,action:'finalize',version:meeting.version},member);assert.equal(finalized.status,200);assert.equal(finalized.body.created,1);
 const items=(await req('state','GET',null,member)).body.items;assert.equal(items.length,1);assert.equal(items[0].owner,user.id);assert.equal(items[0].meetingId,id);assert.equal(items[0].end,'2026-11-05');
 assert.equal((await req('meetings/'+id,'PUT',{...body,action:'finalize',version:meeting.version},member)).status,200);assert.equal((await req('state','GET',null,member)).body.items.length,1);
 meeting=(await req('meetings','GET',null,member)).body[0];assert.equal((await req('meetings/'+id,'PUT',{...body,version:meeting.version},member)).status,400);assert.equal((await req('meetings/'+id,'PUT',{action:'comment',version:meeting.version,text:'Atualização posterior'},member)).status,200);
 meeting=(await req('meetings','GET',null,member)).body[0];assert.equal(meeting.comments[0].author,user.name);assert.equal(meeting.actions[0].routineId,items[0].id);
 }finally{child.kill();}
});
test('reuniões e equipe: telas para membros e administrador sem exposição do conteúdo como HTML',async()=>{
 const context=vm.createContext({state:{user:{id:'u',role:'member'},users:[{id:'u',name:'Pessoa',email:'p@example.test',role:'member'}],items:[]},esc:v=>String(v??'').replaceAll('<','&lt;'),heading:(k,t,s,a)=>t+(a||''),empty:t=>t,date:d=>d,time:t=>t,userName:()=> 'Pessoa',options:(a)=>a.join(','),initials:()=> 'P'});vm.runInContext(await readFile('public/meetings.js','utf8'),context);vm.runInContext(await readFile('public/team.js','utf8'),context);const get=s=>vm.runInContext(s,context);
 get("meetingsLoaded=true;meetingRows=[{id:'m',title:'Reunião <teste>',date:'2026-11-03',status:'Rascunho',actions:[],attendees:[],comments:[],createdBy:'u'}]");assert.ok(get('meetingsContent()').includes('Reunião &lt;teste>'));assert.ok(!get('teamContent()').includes('Convidar pessoa'));get("state.user.role='admin'");assert.ok(get('teamContent()').includes('Convidar pessoa'));assert.ok(get('teamContent()').includes('Cadastrar com senha'));
});
