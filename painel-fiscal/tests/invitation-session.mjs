import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile('public/cloud-api.js','utf8');
function client(saved=new Map(),hash='',server={pending:true,network:false,denied:false,passwordFailed:false}){
 const calls=[],location={hash,pathname:'/fechamento/painel-fiscal/',search:''};
 const ctx=vm.createContext({URLSearchParams,window:{FISCAL_CLOUD:{url:'https://test.supabase.co',key:'public-test'},location,history:{replaceState(){location.hash='';}}},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},fetch:async(url,opts={})=>{calls.push({url,...opts});if(server.network)throw new TypeError('Conexão interrompida');let data,status=200;if(server.denied){status=401;data={message:'Sessão inválida'};}else if(url.endsWith('fs_requires_password_setup'))data=server.pending;else if(url.includes('grant_type=refresh_token'))data={access_token:'refreshed',refresh_token:'new-refresh',expires_in:3600};else if(opts.method==='PUT'){if(server.passwordFailed){status=422;data={message:'Senha não aceita'};}else{server.pending=false;data={id:'invited-user'};}}else data={id:'invited-user'};return {status,ok:status===200,json:async()=>data};}});
 vm.runInContext(code,ctx);return {api:ctx.window.FiscalCloud,saved,calls,location,server};
}
const invite='#type=invite&access_token=invite-token&refresh_token=refresh-token&expires_in=3600';
test('convite: retoma definição de senha após atualizar, limpa tokens e conclui somente com sucesso',async()=>{
 const c=client(new Map(),invite);assert.equal(await c.api.consumeAuthLink(),'invite');assert.equal(c.location.hash,'');assert.equal(JSON.parse([...c.saved.values()][0]).password_setup_pending,true);
 const reload=client(c.saved,'',c.server);assert.equal(await reload.api.consumeAuthLink(),'invite');assert.equal(reload.calls[0].headers.Authorization,'Bearer invite-token');
 reload.server.passwordFailed=true;await assert.rejects(()=>reload.api.api('account-password','PUT',{password:'Senha-ficticia-123'}));assert.equal(JSON.parse([...c.saved.values()][0]).password_setup_pending,true);
 reload.server.passwordFailed=false;await reload.api.api('account-password','PUT',{password:'Senha-ficticia-123'});assert.equal(JSON.parse([...c.saved.values()][0]).password_setup_pending,false);assert.equal(await client(c.saved,'',c.server).api.consumeAuthLink(),null);
});
test('convite: falha de rede preserva cadastro, inclusive durante renovação da sessão',async()=>{
 const c=client(new Map(),invite);c.server.network=true;await assert.rejects(()=>c.api.consumeAuthLink());assert.equal(c.location.hash,'');assert.equal(c.saved.size,1);
 const session=JSON.parse([...c.saved.values()][0]);session.expires_at=1;c.saved.set('cavalca-fiscal-session-v1',JSON.stringify(session));const reload=client(c.saved,'',c.server);await assert.rejects(()=>reload.api.consumeAuthLink());assert.equal(c.saved.size,1);
 reload.server.network=false;assert.equal(await reload.api.consumeAuthLink(),'invite');assert.equal(JSON.parse([...c.saved.values()][0]).password_setup_pending,true);assert.ok(reload.calls.some(c=>c.url.includes('grant_type=refresh_token')));
});
test('convite: estado do servidor recupera primeiro acesso já aceito sem marcador local',async()=>{
 const saved=new Map([['cavalca-fiscal-session-v1',JSON.stringify({access_token:'old-session',refresh_token:'refresh',expires_at:Date.now()/1000+3600})]]);
 assert.equal(await client(saved).api.consumeAuthLink(),'invite');
 const existing=client(new Map(),invite.replace('type=invite','type=magiclink'),{pending:false});assert.equal(await existing.api.consumeAuthLink(),'magiclink');assert.equal(JSON.parse([...existing.saved.values()][0]).password_setup_pending,false);
});
test('convite: sessão inválida ou link expirado não deixa credenciais na URL nem libera acesso',async()=>{
 const c=client(new Map(),invite);c.server.denied=true;await assert.rejects(()=>c.api.consumeAuthLink());assert.equal(c.saved.size,0);assert.equal(c.location.hash,'');
 const expired=client(new Map(),'#error=access_denied&error_code=otp_expired');await assert.rejects(()=>expired.api.consumeAuthLink(),/expirou/);assert.equal(expired.location.hash,'');assert.equal(expired.calls.length,0);
});
