import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('adaptador Supabase: login, RPC, anexos privados e limpeza em conflito',async()=>{
 const calls=[],saved=new Map();let conflict=false;
 const context=vm.createContext({window:{FISCAL_CLOUD:{url:'https://example.supabase.co',key:'public-test-key'}},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},Uint8Array,atob,Error,Date,JSON,Map,Set,fetch:async(url,options)=>{
 calls.push({url,...options});let body={};let status=200;
 if(url.includes('/auth/v1/token'))body={access_token:'test-session',refresh_token:'test-refresh',expires_in:3600};
 if(url.endsWith('fs_prepare_attachment'))body={id:'attachment-id',path:'member/attachment-id.png',type:'image/png',name:'print.png'};
 if(url.endsWith('fs_get_state'))body={user:{id:'member'},users:[],items:[{comments:[{attachments:[{path:'member/attachment-id.png'}]}],executions:[],delegations:[]}],events:[]};
 if(url.endsWith('/object/sign/fiscal-prints'))body=[{path:'member/attachment-id.png',signedURL:'/object/sign/fiscal-prints/member/attachment-id.png?token=test'}];
 if(url.endsWith('fs_apply_item')&&conflict){status=400;body={message:'Conflito de versão'};}
 return {status,ok:status===200,json:async()=>body};
 }});
 vm.runInContext(await readFile('public/cloud-api.js','utf8'),context);const api=context.window.FiscalCloud.api;
 await assert.rejects(()=>api('state'),e=>e.status===401);
 await api('login','POST',{email:'test@example.test',password:'ficticia'});const st=await api('state');assert.equal(st.items[0].comments[0].attachments[0].url,'https://example.supabase.co/storage/v1/object/sign/fiscal-prints/member/attachment-id.png?token=test');
 const payload={version:1,action:'comment',text:'Print',attachments:[{name:'print.png',type:'image/png',data:'aW1hZ2U='}]};
 await api('items/item-id','PUT',payload);const apply=calls.find(c=>c.url.endsWith('fs_apply_item'));assert.deepEqual(JSON.parse(apply.body).p_payload.attachments,['attachment-id']);assert.ok(calls.some(c=>c.headers.Authorization==='Bearer test-session'&&c.url.includes('/object/fiscal-prints/member/')));
 conflict=true;await assert.rejects(()=>api('items/item-id','PUT',payload),/Conflito/);assert.ok(calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/object/fiscal-prints')));assert.ok(calls.some(c=>c.url.endsWith('fs_discard_attachment')));
 await api('items/item-id','PUT',{action:'delete-activity',id:'activity-id',version:5});const deletion=calls.find(c=>c.url.endsWith('fs_delete_activity'));assert.deepEqual(JSON.parse(deletion.body),{p_id:'item-id',p_activity_id:'activity-id',p_version:5});
 await api('items/item-id','PUT',{action:'delete-item',version:6});const removed=calls.find(c=>c.url.endsWith('fs_delete_item'));assert.deepEqual(JSON.parse(removed.body),{p_id:'item-id',p_version:6});
 await api('groups','POST',{title:'Grupo',owner:'member',stages:[]});assert.ok(calls.some(c=>c.url.endsWith('fs_create_group')));
 await api('groups/group-id','PUT',{action:'update-group',version:1});assert.ok(calls.some(c=>c.url.endsWith('fs_update_group')&&JSON.parse(c.body).p_id==='group-id'));
 await api('items','POST',{groupId:'group-id',title:'Registro'});assert.ok(calls.some(c=>c.url.endsWith('fs_create_group_record')));
 await api('items/item-id','PUT',{action:'record-stage',stageId:'stage-id',version:7});const moved=calls.find(c=>c.url.endsWith('fs_update_record'));assert.deepEqual(JSON.parse(moved.body),{p_id:'item-id',p_payload:{action:'record-stage',stageId:'stage-id',version:7}});
 await api('personal','POST',{title:'Privada',action:'save'});await api('personal/private-id','PUT',{action:'share',version:1});const personal=calls.filter(c=>c.url.endsWith('fs_save_personal'));assert.deepEqual(JSON.parse(personal[0].body),{p_id:null,p_payload:{title:'Privada',action:'save'}});assert.equal(JSON.parse(personal[1].body).p_id,'private-id');assert.ok(calls.some(c=>c.url.endsWith('fs_get_personal')));
 await api('logout','POST',{});await assert.rejects(()=>api('state'),e=>e.status===401);
});
