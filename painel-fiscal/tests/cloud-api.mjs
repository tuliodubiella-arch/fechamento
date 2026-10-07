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
 await api('logout','POST',{});await assert.rejects(()=>api('state'),e=>e.status===401);
});
