import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('Meu Painel: isolamento entre contas, admin, cópia sem notas e conflitos',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'fiscal-personal-')),base='http://localhost:4193/api/';
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4193',DATA_DIR:data}});
 const req=async(route,method='GET',b,cookie)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 for(let n=0;n<50;n++){try{if((await fetch(base+'setup')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await req('setup','POST',{name:'Admin teste',email:'admin@example.test',password:'Senha-teste-123'});
 const admin=(await req('login','POST',{email:'admin@example.test',password:'Senha-teste-123'})).cookie;
 for(const name of ['ana','bia'])await req('users','POST',{name,email:name+'@example.test',password:'Senha-teste-123'},admin);
 const ana=(await req('login','POST',{email:'ana@example.test',password:'Senha-teste-123'})).cookie,bia=(await req('login','POST',{email:'bia@example.test',password:'Senha-teste-123'})).cookie;
 const payload={title:'Organizar documentos pessoais',description:'Descrição escolhida para compartilhar',notes:'SEGREDO PRIVADO',start:'2026-10-15',end:'2026-10-16',status:'Em andamento',priority:'Alta',activities:[{title:'Revisar',done:true}],owner:'forged',sharedItemId:'forged',version:123};
 assert.equal((await req('personal','POST',payload)).status,401);
 const id=(await req('personal','POST',payload,ana)).body.id;
 const state=async cookie=>(await req('state','GET',null,cookie)).body;
 let st=await state(ana);assert.equal(st.personalItems.length,1);assert.equal(st.items.length,0);assert.equal(st.personalItems[0].owner,st.user.id);assert.equal(st.personalItems[0].sharedItemId,undefined);assert.equal(st.events.some(e=>e.item===payload.title),false);
 for(const cookie of [admin,bia]){
  assert.equal((await state(cookie)).personalItems.length,0);assert.deepEqual((await req('personal','GET',null,cookie)).body,[]);
  for(const action of ['save','share','delete'])assert.equal((await req('personal/'+id,'PUT',{...payload,action,version:1},cookie)).status,404);
  assert.equal((await req('items/'+id,'PUT',{action:'comment',text:'forged',version:1},cookie)).status,404);
 }
 assert.equal((await req('personal/'+id,'PUT',{...payload,version:0},ana)).status,409);
 const shared=(await req('personal/'+id,'PUT',{action:'share',version:1},ana)).body.id;
 for(const cookie of [admin,bia,ana]){st=await state(cookie);assert.equal(st.items[0].id,shared);assert.equal(st.items[0].title,payload.title);assert.equal(st.items[0].activities[0].done,true);assert.equal(JSON.stringify(st.items).includes('SEGREDO'),false);assert.equal(JSON.stringify(st.events).includes('SEGREDO'),false);}
 assert.equal((await req('personal/'+id,'PUT',{action:'share',version:2},ana)).body.id,shared);assert.equal((await state(bia)).items.length,1);
 await req('personal/'+id,'PUT',{...payload,title:'Nome privado atualizado',action:'save',version:2},ana);assert.equal((await state(bia)).items[0].title,payload.title);
 await req('personal/'+id,'PUT',{action:'delete',version:3},ana);assert.equal((await state(ana)).personalItems.length,0);assert.equal((await state(bia)).items.length,1);
 const disk=JSON.parse(await readFile(path.join(data,'database.json'),'utf8'));assert.ok(disk.personalItems[0].deletedAt);assert.equal(disk.personalItems[0].notes,'SEGREDO PRIVADO');
 }finally{child.kill();}
});
