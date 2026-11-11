const pagesOrigin='https://tuliodubiella-arch.github.io';
const redirectTo=pagesOrigin+'/fechamento/painel-fiscal/';
export function inviteHandler(env:(key:string)=>string|undefined,fetcher:typeof fetch=fetch){
 const url=env('SUPABASE_URL')!,service=env('SUPABASE_SERVICE_ROLE_KEY')!,publicKey=env('SUPABASE_ANON_KEY')!;
 return async(req:Request)=>{
  const headers={'Access-Control-Allow-Origin':pagesOrigin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Vary':'Origin'};
  const reply=(status:number,b:object)=>new Response(JSON.stringify(b),{status,headers});
  if(req.method==='OPTIONS')return reply(200,{ok:true});if(req.method!=='POST')return reply(405,{error:'Método inválido.'});
  if(req.headers.get('origin')&&req.headers.get('origin')!==pagesOrigin)return reply(403,{error:'Origem não permitida.'});
  const request=async(path:string,method='GET',body?:object,token=service,key=service)=>{const res=await fetcher(url+path,{method,headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const raw=await res.text();const json=raw?JSON.parse(raw):{};return {ok:res.ok,status:res.status,data:json};};
  try{
   const jwt=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!jwt)return reply(401,{error:'Entre com sua conta.'});
   const identity=await request('/auth/v1/user','GET',undefined,jwt,publicKey);if(!identity.ok||!identity.data.id)return reply(401,{error:'Sessão inválida.'});
   const caller=await request('/rest/v1/fs_members?select=*&id=eq.'+encodeURIComponent(identity.data.id));const member=caller.data?.[0];if(!caller.ok||!member?.active||member.role!=='admin')return reply(403,{error:'Somente o administrador do departamento pode convidar pessoas.'});
   const departmentFilter=member.department_id?'&department_id=eq.'+encodeURIComponent(member.department_id):'';
   const raw=await req.text();if(raw.length>10000)return reply(413,{error:'Dados muito grandes.'});const b=JSON.parse(raw||'{}');
   if(b.action==='status'){
    const team=await request('/rest/v1/fs_members?select=id,email&active=eq.true'+departmentFilter);if(!team.ok)throw Error('team');const setup=await request('/rest/v1/fs_password_onboarding?select=user_id&required=eq.true');if(!setup.ok)throw Error('onboarding');const needsPassword=new Set(setup.data.map((p:{user_id:string})=>p.user_id));const pending=[];
    for(const person of team.data){const account=await request('/auth/v1/admin/users/'+encodeURIComponent(person.id));if(!account.ok)continue;const u=account.data.user||account.data;if(needsPassword.has(person.id)||(u.invited_at&&!u.email_confirmed_at&&!u.confirmed_at&&!u.last_sign_in_at))pending.push({id:person.id,sentAt:u.confirmation_sent_at||u.invited_at});}
    return reply(200,{pending});
   }
   let email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim(),id:string|undefined,account:any;
   if(b.action==='resend'){
    if(!/^[0-9a-f-]{36}$/i.test(String(b.memberId||'')))return reply(400,{error:'Pessoa inválida.'});
    const target=await request('/rest/v1/fs_members?select=id,email,name,active&id=eq.'+encodeURIComponent(b.memberId)+departmentFilter);const p=target.data?.[0];if(!p?.active)return reply(404,{error:'Pessoa não encontrada neste departamento.'});email=p.email;name=p.name;id=p.id;
   }else{
    if(b.action&&b.action!=='invite')return reply(400,{error:'Operação inválida.'});
    if(!name||name.length<2||name.length>80||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply(400,{error:'Informe nome e e-mail válidos.'});
    const existing=await request('/rest/v1/fs_members?select=id&email=eq.'+encodeURIComponent(email));if(!existing.ok)throw Error('lookup');if(existing.data?.length)return reply(409,{error:'Este e-mail já pertence à equipe. Use reenviar convite, se estiver pendente.'});
    const found=await request('/rest/v1/rpc/fs_find_auth_user','POST',{p_email:email});if(!found.ok)throw Error('lookup');id=found.data||undefined;
   }
   if(id){const result=await request('/auth/v1/admin/users/'+encodeURIComponent(id));if(!result.ok)throw Error('user');account=result.data.user||result.data;}
   const awaitingInvite=account?.invited_at&&!account.email_confirmed_at&&!account.confirmed_at&&!account.last_sign_in_at;let setupPending=false;if(id){const setup=await request('/rest/v1/fs_password_onboarding?select=user_id&required=eq.true&user_id=eq.'+encodeURIComponent(id));if(!setup.ok)throw Error('onboarding');setupPending=setup.data.length>0;}const pending=awaitingInvite||setupPending;
   if(b.action==='resend'&&!pending)return reply(409,{error:'Esta pessoa já acessou a plataforma e não tem convite pendente.'});
   const sentAt=account?.confirmation_sent_at||account?.invited_at;if(pending&&sentAt&&Date.now()-Date.parse(sentAt)<60000)return reply(429,{error:'Aguarde um minuto antes de reenviar o convite.'});
   const confirmed=!!account&&!awaitingInvite;
   const sent=confirmed?await request('/auth/v1/otp?redirect_to='+encodeURIComponent(redirectTo),'POST',{email,create_user:false},publicKey,publicKey):await request('/auth/v1/invite?redirect_to='+encodeURIComponent(redirectTo),'POST',{email,data:{name,full_name:name}});
   if(!sent.ok)return reply(sent.status===429?429:400,{error:sent.status===429?'Limite de envio atingido. Aguarde antes de tentar novamente.':'O serviço de e-mail não enviou o convite. Confira o endereço e a configuração de e-mail do Supabase.'});
   id=id||sent.data.user?.id||sent.data.id;if(!id)throw Error('id');
   if(b.action!=='resend'){
    const inserted=await request('/rest/v1/fs_members','POST',{id,name,email,role:'member',active:true,...(member.department_id?{department_id:member.department_id}:{})});if(!inserted.ok)return reply(500,{error:'O e-mail foi enviado, mas o vínculo ao departamento não foi concluído. Confira o cadastro antes de reenviar.'});
   }
   await request('/rest/v1/fs_events','POST',{user:member.name,action:b.action==='resend'?'Reenviou convite para '+name:'Convidou '+name,item:'Equipe',...(member.department_id?{department_id:member.department_id}:{})});
   return reply(200,{ok:true,existing:confirmed});
  }catch{return reply(500,{error:'Não foi possível concluir o convite. Tente novamente.'});}
 };
}
if(typeof Deno!=='undefined')Deno.serve(inviteHandler(key=>Deno.env.get(key)));
