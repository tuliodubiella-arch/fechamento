import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('login, equipe, colaboração, conflitos e persistência',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'cavalca-fiscal-')); const port=4185;
 const launch=()=>{const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DATA_DIR:data}});return child;};
 let child=launch();
 const ready=async()=>{for(let n=0;n<50;n++){try{if((await fetch(`http://localhost:${port}/api/setup`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Servidor não iniciou');};
 const request=async(route,method='GET',payload,cookie)=>{const r=await fetch(`http://localhost:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:payload?JSON.stringify(payload):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{await ready();assert.equal((await request('state')).status,401);
 assert.equal((await request('setup','POST',{name:'Admin Teste',email:'admin@example.test',password:'Teste-local-123',samples:false})).status,201);
 assert.equal((await request('setup','POST',{})).status,409);
 assert.equal((await request('login','POST',{email:'admin@example.test',password:'incorreta'})).status,401);
 const admin=await request('login','POST',{email:'admin@example.test',password:'Teste-local-123'});assert.equal(admin.status,200);assert.ok(admin.cookie);
 assert.equal((await request('users','POST',{name:'Equipe Teste',email:'equipe@example.test',password:'Equipe-local-123'},admin.cookie)).status,201);
 const member=await request('login','POST',{email:'equipe@example.test',password:'Equipe-local-123'});
 assert.equal((await request('users','POST',{},member.cookie)).status,403);
 const st=(await request('state','GET',null,admin.cookie)).body;assert.ok(st.users.every(u=>!u.password));
 const id=(await request('items','POST',{type:'routine',title:'Conferência teste',description:'Teste',owner:st.user.id,start:'2026-10-07',end:'2026-10-09',frequency:'Diária',priority:'Alta'},admin.cookie)).body.id;assert.ok(id);
 assert.equal((await request('items/'+id,'PUT',{version:1,action:'activity',title:'Conferir documentos'},member.cookie)).status,200);
 assert.equal((await request('items/'+id,'PUT',{version:1,action:'comment',text:'Conflito'},admin.cookie)).status,409);
 let item=(await request('state','GET',null,admin.cookie)).body.items[0];
 assert.equal((await request('items/'+id,'PUT',{version:item.version,action:'toggle',id:item.activities[0].id},admin.cookie)).status,200);
 item=(await request('state','GET',null,member.cookie)).body.items[0];assert.equal(item.activities[0].done,true);
 for(const action of ['comment','execution']){assert.equal((await request('items/'+id,'PUT',{version:item.version,action,text:'Conferência realizada'},member.cookie)).status,200);item=(await request('state','GET',null,member.cookie)).body.items[0];}
 assert.equal(item.comments[0].author,'Equipe Teste');assert.equal(item.executions.length,1);
 const activityId=item.activities[0].id;
 assert.equal((await request('items/'+id,'PUT',{version:item.version,action:'delete-activity',id:activityId},member.cookie)).status,403);
 assert.equal((await request('items/'+id,'PUT',{version:item.version-1,action:'delete-activity',id:activityId},admin.cookie)).status,409);
 assert.equal((await request('items/'+id,'PUT',{version:item.version,action:'delete-activity',id:'inexistente'},admin.cookie)).status,404);
 assert.equal((await request('items/'+id,'PUT',{version:item.version,action:'delete-activity',id:activityId},admin.cookie)).status,200);
 const deleted=(await request('state','GET',null,admin.cookie)).body;
 assert.equal(deleted.items[0].activities.length,0);assert.equal(deleted.items[0].executions.length,1);assert.equal(deleted.items[0].comments.length,1);
 assert.ok(deleted.events.some(e=>e.user==='Admin Teste'&&e.action.includes('Excluiu a atividade “Conferir documentos” (concluída)')));
 const disk=JSON.parse(await readFile(path.join(data,'database.json'),'utf8'));assert.ok(!disk.users[0].password.includes('Teste-local'));assert.equal(disk.items.length,1);
 child.kill();await new Promise(r=>child.once('exit',r));child=launch();await ready();
 const login=await request('login','POST',{email:'admin@example.test',password:'Teste-local-123'});assert.equal((await request('state','GET',null,login.cookie)).body.items[0].executions.length,1);
 for(const type of ['routine','project']){
 const record=(await request('items','POST',{type,title:'Excluir '+type,owner:st.user.id,start:'2026-10-13',end:'2026-10-20'},login.cookie)).body.id;
 const memberLogin=await request('login','POST',{email:'equipe@example.test',password:'Equipe-local-123'});
 assert.equal((await request('items/'+record,'PUT',{action:'delete-item',version:1},memberLogin.cookie)).status,403);
 assert.equal((await request('items/'+record,'PUT',{action:'delete-item',version:0},login.cookie)).status,409);
 await request('items/'+record,'PUT',{action:'comment',version:1,text:'Preservar comentário'},login.cookie);
 assert.equal((await request('items/'+record,'PUT',{action:'delete-item',version:2},login.cookie)).status,200);
 const current=(await request('state','GET',null,login.cookie)).body;
 assert.ok(!current.items.some(i=>i.id===record));assert.ok(current.events.some(e=>e.item==='Excluir '+type&&e.action.startsWith('Excluiu')));
 assert.equal((await request('items/'+record,'PUT',{action:'activity',version:3,title:'Alteração tardia'},login.cookie)).status,404);
 const preserved=JSON.parse(await readFile(path.join(data,'database.json'),'utf8')).items.find(i=>i.id===record);assert.ok(preserved.deletedAt);assert.equal(preserved.comments[0].text,'Preservar comentário');
 }
 assert.equal((await request('logout','POST',{},login.cookie)).status,200);assert.equal((await request('state','GET',null,login.cookie)).status,401);
 }finally{child.kill();}
});
