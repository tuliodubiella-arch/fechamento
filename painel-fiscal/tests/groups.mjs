import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('grupos: registros independentes, etapas, vínculo e permissões',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'fiscal-groups-')),base='http://localhost:4191/api/';
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4191',DATA_DIR:data}});
 const req=async(route,method='GET',b,cookie)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 for(let n=0;n<50;n++){try{if((await fetch(base+'setup')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await req('setup','POST',{name:'Dono',email:'dono@example.test',password:'Senha-teste-123'});const cookie=(await req('login','POST',{email:'dono@example.test',password:'Senha-teste-123'})).cookie;
 await req('users','POST',{name:'Apoio',email:'apoio@example.test',password:'Senha-teste-123'},cookie);const member=(await req('login','POST',{email:'apoio@example.test',password:'Senha-teste-123'})).cookie;
 const state=async()=>(await req('state','GET',null,cookie)).body;const owner=(await state()).user.id;
 const groupBody={title:'Alterações contratuais',description:'Organizar registros',owner,stages:[{name:'Em preparação',status:'Planejada'},{name:'Protocolado',status:'Em andamento'},{name:'Em exigência',status:'Bloqueada'},{name:'Concluído',status:'Concluída'}]};
 assert.equal((await req('groups','POST',{...groupBody,stages:[{name:'Única etapa',status:'Concluída'}]},cookie)).status,400);
 const groupId=(await req('groups','POST',groupBody,cookie)).body.id;let g=(await state()).groups[0];assert.equal(g.id,groupId);assert.equal(g.stages.length,4);
 assert.equal((await req('groups/'+g.id,'PUT',{action:'update-group',version:1,...groupBody},member)).status,200);g=(await state()).groups[0];
 const payload={title:'Alteração de endereço',type:'routine',owner,start:'2026-10-14',end:'2026-10-20',groupId,company:'Empresa A',registry:'Junta',protocol:'123',frequency:'Única'};
 const id=(await req('items','POST',payload,cookie)).body.id;let i=(await state()).items.find(i=>i.id===id);assert.equal(i.groupId,g.id);assert.equal(i.stageId,g.stages[0].id);assert.equal(i.frequency,'Única');assert.equal(i.company,'Empresa A');
 assert.equal((await req('items','POST',{...payload,type:'project'},cookie)).status,400);
 const second=(await req('items','POST',{...payload,title:'Segundo registro'},member)).body.id;
 let currentGroup=(await state()).groups[0];
 assert.equal((await req('groups/'+g.id,'PUT',{action:'reorder-records',version:currentGroup.version,ids:[second,id]},member)).status,200);
 currentGroup=(await state()).groups[0];assert.deepEqual(currentGroup.recordOrder,[second,id]);
 assert.equal((await req('groups/'+g.id,'PUT',{action:'reorder-records',version:currentGroup.version-1,ids:[id,second]},member)).status,409);
 for(const ids of [[id,id],[id,'foreign'],[id]])assert.equal((await req('groups/'+g.id,'PUT',{action:'reorder-records',version:currentGroup.version,ids},member)).status,400);
 assert.equal((await req('items/'+id,'PUT',{...i,action:'record-edit',title:'Título atualizado',priority:'Alta',description:'Nova descrição'},member)).status,200);i=(await state()).items.find(r=>r.id===id);assert.equal(i.title,'Título atualizado');assert.equal(i.priority,'Alta');
 for(const title of ['Primeira atividade','Segunda atividade']){await req('items/'+id,'PUT',{action:'activity',title,version:i.version},member);i=(await state()).items.find(r=>r.id===id);}
 const aid=i.activities[0].id,bid=i.activities[1].id;
 await req('items/'+id,'PUT',{action:'toggle',id:aid,version:i.version},member);i=(await state()).items.find(r=>r.id===id);
 assert.equal((await req('items/'+id,'PUT',{action:'edit-activity',id:aid,title:'Atividade editada',version:i.version},member)).status,200);i=(await state()).items.find(r=>r.id===id);
 assert.equal((await req('items/'+id,'PUT',{action:'reorder-activities',ids:[bid,aid],version:i.version},member)).status,200);i=(await state()).items.find(r=>r.id===id);assert.deepEqual(i.activities.map(a=>a.id),[bid,aid]);assert.equal(i.activities[1].done,true);assert.equal(i.activities[1].title,'Atividade editada');
 assert.equal((await req('items/'+id,'PUT',{action:'reorder-activities',ids:[bid,bid],version:i.version},member)).status,400);
 assert.equal((await req('items/'+id,'PUT',{action:'delete-activity',id:aid,version:i.version},member)).status,403);
 g=(await state()).groups[0];

 assert.equal((await req('items/'+id,'PUT',{version:i.version,action:'status',status:'Concluída'},cookie)).status,400);
 assert.equal((await req('items/'+id,'PUT',{version:i.version,action:'record-stage',stageId:'errada'},cookie)).status,400);
 assert.equal((await req('items/'+id,'PUT',{version:i.version,action:'comment',text:'Preservar comentário'},cookie)).status,200);i=(await state()).items.find(i=>i.id===id);
 assert.equal((await req('items/'+id,'PUT',{version:i.version,action:'record-stage',stageId:g.stages[3].id},member)).status,200);i=(await state()).items.find(i=>i.id===id);assert.equal(i.status,'Concluída');assert.equal(i.comments[0].text,'Preservar comentário');
 assert.equal((await req('items/'+id,'PUT',{version:i.version-1,action:'record-stage',stageId:g.stages[1].id},cookie)).status,409);
 const existing=(await req('items','POST',{...payload,title:'Rotina existente',groupId:undefined},cookie)).body.id;let current=(await state()).items.find(i=>i.id===existing);
 await req('items/'+existing,'PUT',{action:'record-settings',version:current.version,groupId:g.id,stageId:g.stages[2].id,company:'Empresa B'},cookie);current=(await state()).items.find(i=>i.id===existing);assert.equal(current.status,'Bloqueada');
 await req('items/'+existing,'PUT',{action:'record-settings',version:current.version,groupId:'',company:'Empresa B'},cookie);current=(await state()).items.find(i=>i.id===existing);assert.equal(current.groupId,undefined);
 assert.equal((await req('groups/'+g.id,'PUT',{action:'delete-group',version:g.version},member)).status,403);
 assert.equal((await req('groups/'+g.id,'PUT',{action:'delete-group',version:g.version},cookie)).status,200);
 const final=await state();assert.equal(final.groups.length,0);assert.ok(!final.items.some(i=>i.id===id));assert.ok(final.items.some(i=>i.id===existing));assert.ok(final.events.some(e=>e.action.includes('Excluiu grupo e 2 registros')));
 assert.equal((await req('items','POST',payload,cookie)).status,400);const disk=JSON.parse(await readFile(path.join(data,'database.json'),'utf8'));assert.equal(disk.items.find(i=>i.id===id).comments[0].text,'Preservar comentário');
 }finally{child.kill();}
});
