import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('etapas: membro edita nomes, acrescenta e reordena sem perder registros, valida remoções e conflitos',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'fiscal-stages-')),base='http://localhost:4196/api/';const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4196',DATA_DIR:dir}});let cookie;
 const req=async(route,method='GET',body)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};};
 try{
  for(let n=0;n<50;n++){try{if((await req('setup')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  await req('setup','POST',{name:'Admin',email:'admin@example.test',password:'Teste-local-123'});await req('login','POST',{email:'admin@example.test',password:'Teste-local-123'});await req('users','POST',{name:'Equipe',email:'equipe@example.test',password:'Teste-local-123'});await req('login','POST',{email:'equipe@example.test',password:'Teste-local-123'});
  const owner=(await req('state')).body.user.id,id=(await req('groups','POST',{title:'Alterações contratuais',owner,stages:[{name:'Preparar',status:'Planejada'},{name:'Concluído',status:'Concluída'}]})).body.id;
  let g=(await req('state')).body.groups.find(g=>g.id===id);
  const item=(await req('items','POST',{title:'Alteração de endereço',owner,type:'routine',groupId:id,frequency:'Única',start:'2026-11-04',end:'2026-11-10'})).body.id;
  const stages=[{...g.stages[0],name:'Em preparação'},{name:'REGISTRADO',status:'Em andamento'},g.stages[1]];
  assert.equal((await req('groups/'+id,'PUT',{action:'edit-stages',version:g.version,stages})).status,200);
  let state=(await req('state')).body;g=state.groups.find(g=>g.id===id);let record=state.items.find(i=>i.id===item);assert.equal(g.stages.length,3);assert.equal(record.stageId,g.stages[0].id);assert.equal(g.stages[0].name,'Em preparação');
  assert.equal((await req('groups/'+id,'PUT',{action:'edit-stages',version:g.version-1,stages:g.stages})).status,409);
  const update=stages=>req('groups/'+id,'PUT',{action:'edit-stages',version:g.version,stages});
  assert.equal((await update(g.stages.slice(1))).status,400);
  assert.equal((await update(g.stages.map((s,n)=>n===0?{...s,status:'Concluída'}:s))).status,400);
  assert.equal((await update(g.stages.map((s,n)=>n===1?{...s,id:'foreign-stage'}:s))).status,400);
  assert.equal((await update(g.stages.map((s,n)=>n===1?{...s,name:g.stages[0].name.toUpperCase()}:s))).status,400);
  const changed=g.stages.map((s,n)=>n===0?{...s,status:'Em andamento'}:s);assert.equal((await update(changed)).status,200);
  state=(await req('state')).body;g=state.groups.find(g=>g.id===id);record=state.items.find(i=>i.id===item);assert.equal(record.status,'Em andamento');assert.equal(record.version,2);assert.equal(record.stageId,g.stages[0].id);
  const reversed=[g.stages[1],g.stages[0],g.stages[2]];assert.equal((await update(reversed)).status,200);state=(await req('state')).body;g=state.groups.find(g=>g.id===id);assert.equal(g.stages[0].name,'REGISTRADO');assert.equal(state.items.find(i=>i.id===item).stageId,reversed[1].id);
 }finally{child.kill();}
});
