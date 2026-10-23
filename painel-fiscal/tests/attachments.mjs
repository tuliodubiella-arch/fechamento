import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
test('prints: autenticação, validação, registros e persistência',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'fiscal-prints-'));const base='http://localhost:4188/api/';
 const launch=()=>spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4188',DATA_DIR:data}});let child=launch();
 const ready=async()=>{for(let n=0;n<50;n++){try{if((await fetch(base+'setup')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Servidor não iniciou');};
 const req=async(route,method='GET',b,cookie)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{await ready();await req('setup','POST',{name:'Dono',email:'dono@example.test',password:'Senha-teste-123'});let cookie=(await req('login','POST',{email:'dono@example.test',password:'Senha-teste-123'})).cookie;
 await req('users','POST',{name:'Apoio',email:'apoio@example.test',password:'Senha-teste-123'},cookie);const state=(await req('state','GET',null,cookie)).body;
 const id=(await req('items','POST',{title:'Registro com print',type:'routine',owner:state.user.id,start:'2026-10-07',end:'2026-10-20'},cookie)).body.id;
 const read=async()=>(await req('state','GET',null,cookie)).body.items[0];const update=async(action,b)=>req('items/'+id,'PUT',{version:(await read()).version,action,...b},cookie);
 const attachment={name:'print.png',type:'image/png',data:png.toString('base64')};
 for(const bad of [[{name:'x.svg',type:'image/svg+xml',data:Buffer.from('<svg></svg>').toString('base64')}],Array(4).fill(attachment),[{...attachment,data:Buffer.alloc(5*1024*1024+1).toString('base64')}],[{...attachment,type:'image/jpeg'}]])assert.equal((await update('comment',{text:'Inválido',attachments:bad})).status,400);
 assert.equal((await read()).comments.length,0);
 assert.equal((await update('comment',{text:'Print da conferência',attachments:[attachment]})).status,200);let item=await read();const imageId=item.comments[0].attachments[0].id;
 assert.equal((await fetch(base+'attachments/'+imageId)).status,401);
 const image=await fetch(base+'attachments/'+imageId,{headers:{Cookie:cookie}});assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
 const documents=[['relatório.pdf','application/pdf',Buffer.from('%PDF-1.4\nDocumento de teste\n%%EOF')],['relatório.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',Buffer.from('PK\x03\x04[Content_Types].xml xl/workbook.xml')],['parecer.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',Buffer.from('PK\x03\x04[Content_Types].xml word/document.xml')],['legado.xls','application/vnd.ms-excel',Buffer.from([208,207,17,224,161,177,26,225])],['legado.doc','application/msword',Buffer.from([208,207,17,224,161,177,26,225])]];
 for(const [name,type,bytes] of documents){assert.equal((await update('comment',{text:'Documento de apoio',attachments:[{name,type,data:bytes.toString('base64')}]})).status,200);const entry=(await read()).comments.at(-1).attachments[0];const downloaded=await fetch(base+'attachments/'+entry.id,{headers:{Cookie:cookie}});assert.equal(downloaded.headers.get('content-type'),type);assert.ok(downloaded.headers.get('content-disposition').startsWith('attachment;'));assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);assert.equal((await fetch(base+'attachments/'+entry.id)).status,401);}
 for(const [name,type] of [['x.pdf','application/pdf'],['x.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['x.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['x.xlsm','application/vnd.ms-excel']])assert.equal((await update('comment',{text:'Formato inválido',attachments:[{name,type,data:png.toString('base64')}]})).status,400);
 assert.equal((await fetch(base+'attachments/00000000-0000-0000-0000-000000000000',{headers:{Cookie:cookie}})).status,404);
 assert.equal((await update('execution',{text:'Execução com evidência',attachments:[attachment]})).status,200);
 assert.equal((await update('delegate',{title:'Conferir',assignee:state.users[1].id,due:'2026-10-10'})).status,200);item=await read();assert.equal((await update('complete-delegation',{id:item.delegations[0].id,result:'Conferido',attachments:[attachment]})).status,200);
 item=await read();assert.equal(item.delegations[0].attachments[0].id,item.executions[1].attachments[0].id);
 await update('reopen-delegation',{id:item.delegations[0].id});item=await read();assert.equal(item.executions[1].attachments.length,1);
 child.kill();await new Promise(r=>child.once('exit',r));child=launch();await ready();cookie=(await req('login','POST',{email:'apoio@example.test',password:'Senha-teste-123'})).cookie;
 const restored=await fetch(base+'attachments/'+imageId,{headers:{Cookie:cookie}});assert.equal(restored.status,200);assert.deepEqual(Buffer.from(await restored.arrayBuffer()),png);
 const adminCookie=(await req('login','POST',{email:'dono@example.test',password:'Senha-teste-123'})).cookie;
 const active=(await req('state','GET',null,adminCookie)).body.items[0];assert.equal((await req('items/'+id,'PUT',{version:active.version,action:'delete-item'},adminCookie)).status,200);
 assert.equal((await req('state','GET',null,adminCookie)).body.items.length,0);
 const archivedPrint=await fetch(base+'attachments/'+imageId,{headers:{Cookie:cookie}});assert.equal(archivedPrint.status,200);assert.deepEqual(Buffer.from(await archivedPrint.arrayBuffer()),png);
 }finally{child.kill();}
});
