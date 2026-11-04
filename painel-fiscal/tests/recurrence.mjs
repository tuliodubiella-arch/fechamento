import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateRecurrence,nextRecurrenceDate} from '../recurrence-server.mjs';
test('recorrência: mês curto, ano bissexto, virada do ano e calendário semanal',()=>{
 assert.equal(nextRecurrenceDate('2026-01-31','Mensal'),'2026-02-28');
 assert.equal(nextRecurrenceDate('2026-02-28','Mensal',31),'2026-03-31');
 assert.equal(nextRecurrenceDate('2028-01-31','Mensal'),'2028-02-29');
 assert.equal(nextRecurrenceDate('2026-12-31','Diária'),'2027-01-01');
 assert.equal(nextRecurrenceDate('2026-12-28','Semanal'),'2027-01-04');
});
test('recorrência: preserva histórico, reinicia checklist e impede repetição após reabrir',()=>{
 const item={id:'original',type:'routine',status:'Concluída',frequency:'Mensal',owner:'u',start:'2026-01-31',end:'2026-01-31',activities:[{id:'a',title:'Conferir',done:true}],comments:[{text:'Histórico'}],executions:[{text:'Feito'}],delegations:[{done:true}],protocol:'123'};
 const db={items:[item]},event=()=>{},next=generateRecurrence(db,item,{...item,status:'Em andamento'},{id:'u'},event);
 assert.equal(next.start,'2026-02-28');assert.equal(next.owner,'u');assert.equal(next.activities[0].done,false);assert.notEqual(next.activities[0].id,'a');assert.equal(next.comments.length,0);assert.equal(next.delegations.length,0);assert.equal(next.protocol,'');assert.equal(item.comments.length,1);
 assert.equal(generateRecurrence(db,item,{...item,status:'Planejada'},null,event),null);assert.equal(db.items.length,2);
 next.status='Concluída';const third=generateRecurrence(db,next,{...next,status:'Planejada'},null,event);assert.equal(third.start,'2026-03-31');
 const edited={...third,status:'Concluída',start:'2026-03-15',end:'2026-03-15'};db.items.push(edited);const fourth=generateRecurrence(db,edited,third,null,event);assert.equal(fourth.start,'2026-04-15');
 for(const type of ['routine','project']){const unique={...item,id:type,type,frequency:'Única',recurrenceNextId:null};assert.equal(generateRecurrence(db,unique,{...unique,status:'Planejada'},null,event),null);}
});
test('recorrência: conclusão compartilhada cria uma única próxima rotina e reinicia a etapa do grupo',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'fiscal-recurrence-')),base='http://localhost:4197/api/';const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4197',DATA_DIR:dir}});let cookie;
 const req=async(route,method='GET',body)=>{const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,body:await response.json()};};
 try{
  for(let n=0;n<50;n++){try{if((await req('setup')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  await req('setup','POST',{name:'Administrador',email:'admin@example.test',password:'Teste-local-123'});await req('login','POST',{email:'admin@example.test',password:'Teste-local-123'});
  const owner=(await req('state')).body.user.id;
  const groupId=(await req('groups','POST',{title:'Conferências',owner,stages:[{name:'Preparar',status:'Planejada'},{name:'Concluído',status:'Concluída'}]})).body.id;
  const itemId=(await req('items','POST',{title:'Conferir apuração',owner,type:'routine',start:'2026-10-01',end:'2026-10-13',frequency:'Mensal',groupId})).body.id;
  let state=(await req('state')).body,item=state.items.find(i=>i.id===itemId),group=state.groups.find(g=>g.id===groupId);
  const changes=await Promise.all([1,2].map(()=>req('items/'+itemId,'PUT',{action:'record-stage',version:item.version,stageId:group.stages[1].id})));
  assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);state=(await req('state')).body;assert.equal(state.items.length,2);item=state.items.find(i=>i.id===itemId);const next=state.items.find(i=>i.id===item.recurrenceNextId);
  assert.equal(next.start,'2026-11-01');assert.equal(next.end,'2026-11-13');assert.equal(next.stageId,group.stages[0].id);assert.equal(next.status,'Planejada');
  await req('items/'+itemId,'PUT',{action:'record-stage',version:item.version,stageId:group.stages[0].id});item=(await req('state')).body.items.find(i=>i.id===itemId);
  await req('items/'+itemId,'PUT',{action:'record-stage',version:item.version,stageId:group.stages[1].id});assert.equal((await req('state')).body.items.length,2);
 }finally{child.kill();}
});
