import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('delegação temporária em rotinas e projetos',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'fiscal-delegations-'));const base='http://localhost:4187/api/';
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4187',DATA_DIR:data}});
 const req=async(route,method='GET',b,cookie)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 for(let n=0;n<50;n++){try{if((await fetch(base+'setup')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await req('setup','POST',{name:'Dono',email:'dono@example.test',password:'Senha-teste-123'});const admin=(await req('login','POST',{email:'dono@example.test',password:'Senha-teste-123'})).cookie;
 for(const name of ['Apoio','Outro'])await req('users','POST',{name,email:name.toLowerCase()+'@example.test',password:'Senha-teste-123'},admin);
 const member=(await req('login','POST',{email:'apoio@example.test',password:'Senha-teste-123'})).cookie;const other=(await req('login','POST',{email:'outro@example.test',password:'Senha-teste-123'})).cookie;
 const state=(await req('state','GET',null,admin)).body;const owner=state.user.id,assignee=state.users.find(u=>u.name==='Apoio').id;
 for(const type of ['routine','project']){
 const id=(await req('items','POST',{type,title:'Teste '+type,owner,start:'2026-10-07',end:'2026-10-20'},admin)).body.id;
 const read=async()=>(await req('state','GET',null,admin)).body.items.find(i=>i.id===id);
 const update=async(action,b,cookie=admin)=>req('items/'+id,'PUT',{version:(await read()).version,action,...b},cookie);
 assert.equal((await update('delegate',{title:'Ação',assignee:owner,due:'2026-10-10'})).status,400);
 assert.equal((await update('delegate',{title:'Ação',assignee:'inexistente',due:'2026-10-10'})).status,400);
 assert.equal((await update('delegate',{title:'Ação',assignee,due:'2026-10-10'},other)).status,403);
 for(const title of ['Validar notas','Conferir saldo'])assert.equal((await update('delegate',{title,assignee,due:'2026-10-10'})).status,200);
 let item=await read();assert.equal(item.owner,owner);assert.equal(item.delegations.filter(d=>!d.done).length,2);
 const first=item.delegations[0].id,second=item.delegations[1].id;
 assert.equal((await update('complete-delegation',{id:first,result:'Feito'},other)).status,403);
 assert.equal((await update('complete-delegation',{id:first,result:''},member)).status,400);
 assert.equal((await update('complete-delegation',{id:first,result:'Notas validadas'},member)).status,200);
 assert.equal((await read()).delegations.filter(d=>!d.done).length,1);
 assert.equal((await update('complete-delegation',{id:second,result:'Saldo conferido'},member)).status,200);
 item=await read();assert.equal(item.delegations.filter(d=>!d.done).length,0);assert.equal(item.delegations[0].completedBy,assignee);assert.equal(item.executions.length,2);assert.equal(item.owner,owner);assert.equal(item.status,'Planejada');
 assert.equal((await update('reopen-delegation',{id:first},member)).status,200);item=await read();assert.equal(item.delegations.filter(d=>!d.done).length,1);assert.equal(item.executions.length,2);
 }
 }finally{child.kill();}
});
