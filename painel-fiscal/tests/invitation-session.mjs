import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('convite: valida sessão recebida, limpa tokens da URL e conclui a senha da própria conta',async()=>{
 const saved=new Map(),calls=[];let cleaned=false,valid=true;
 const ctx=vm.createContext({URLSearchParams,window:{FISCAL_CLOUD:{url:'https://test.supabase.co',key:'public-test'},location:{hash:'#type=invite&access_token=invite-token&refresh_token=refresh-token&expires_in=3600',pathname:'/fechamento/painel-fiscal/',search:''},history:{replaceState(){cleaned=true;}}},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},fetch:async(url,options)=>{calls.push({url,...options});return {status:valid?200:401,ok:valid,json:async()=>valid?{id:'invited-user'}:{message:'Link inválido'}};}});
 vm.runInContext(await readFile('public/cloud-api.js','utf8'),ctx);assert.equal(await ctx.window.FiscalCloud.consumeAuthLink(),'invite');assert.equal(cleaned,true);assert.equal(JSON.parse([...saved.values()][0]).access_token,'invite-token');assert.equal(calls[0].headers.Authorization,'Bearer invite-token');
 await ctx.window.FiscalCloud.api('account-password','PUT',{password:'Senha-ficticia-123'});assert.equal(calls.at(-1).method,'PUT');assert.deepEqual(JSON.parse(calls.at(-1).body),{password:'Senha-ficticia-123'});
 valid=false;await assert.rejects(()=>ctx.window.FiscalCloud.consumeAuthLink());assert.equal(saved.size,0);
});
