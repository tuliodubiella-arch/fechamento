const origin='https://tuliodubiella-arch.github.io';
const redirect=origin+'/fechamento/painel-fiscal/';
export function departmentHandler(env:(key:string)=>string|undefined,fetcher:typeof fetch=fetch){
 const url=env('SUPABASE_URL')!,service=env('SUPABASE_SERVICE_ROLE_KEY')!,publicKey=env('SUPABASE_ANON_KEY')!;
 return async(req:Request)=>{
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Vary':'Origin'};
  const reply=(status:number,data:object)=>new Response(JSON.stringify(data),{status,headers});
  if(req.method==='OPTIONS')return reply(200,{ok:true});
  if(req.method!=='POST')return reply(405,{error:'Método inválido.'});
  if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return reply(403,{error:'Origem não permitida.'});
  const request=async(path:string,method='GET',body?:object,token=service,key=service)=>{
   const response=await fetcher(url+path,{method,headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
   const text=await response.text();return {ok:response.ok,status:response.status,data:text?JSON.parse(text):{}};
  };
  try{
   const jwt=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!jwt)return reply(401,{error:'Entre com sua conta.'});
   const identity=await request('/auth/v1/user','GET',undefined,jwt,publicKey);if(!identity.ok||!identity.data.id)return reply(401,{error:'Sessão inválida.'});
   const raw=await req.text();if(raw.length>12000)return reply(413,{error:'Dados muito grandes.'});const b=JSON.parse(raw||'{}');
   if(b.action==='send-team'){
    const caller=await request('/rest/v1/fs_members?select=role,active,department_id&id=eq.'+encodeURIComponent(identity.data.id));const member=caller.data?.[0];
    if(!caller.ok||!member?.active||member.role!=='admin'||!member.department_id)return reply(403,{error:'Somente o administrador do departamento pode enviar estes convites.'});
    const scope='department_id=eq.'+encodeURIComponent(member.department_id);
    const queue=await request('/rest/v1/fs_team_invite_queue?select=id,name,email&'+scope+'&status=neq.sent&order=created_at&limit=10');if(!queue.ok)throw Error('queue');
    let sent=0,failed=0;
    for(const person of queue.data){
     const result=await request('/functions/v1/fiscal-invite-member','POST',{name:person.name,email:person.email},jwt,publicKey);
     // Recupera a confirmação perdida de uma tentativa anterior, sem enviar novamente.
     const exists=!result.ok?await request('/rest/v1/fs_members?select=id&'+scope+'&email=eq.'+encodeURIComponent(person.email)):null;
     const success=result.ok||!!(exists?.ok&&exists.data?.length);
     const updated=await request('/rest/v1/fs_team_invite_queue?id=eq.'+encodeURIComponent(person.id)+'&'+scope,'PATCH',{status:success?'sent':'failed',...(success?{sent_at:new Date().toISOString()}:{})});if(!updated.ok)throw Error('queue update');
     if(success)sent++;else{failed++;break;}
    }
    const remaining=await request('/rest/v1/fs_team_invite_queue?select=id&'+scope+'&status=neq.sent');if(!remaining.ok)throw Error('queue');
    return reply(200,{ok:true,sent,failed,remaining:remaining.data.length});
   }
   const permission=await request('/rest/v1/fs_platform_admins?select=user_id&user_id=eq.'+encodeURIComponent(identity.data.id));
   if(!permission.ok||!permission.data?.length)return reply(403,{error:'Somente a administração geral pode convidar novos departamentos.'});
   if(!['invite-department','resend-department'].includes(b.action))return reply(400,{error:'Operação inválida.'});
   let email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim(),invitation:any;
   if(b.action==='resend-department'){
    if(!/^[0-9a-f-]{36}$/i.test(String(b.invitationId||'')))return reply(400,{error:'Convite inválido.'});
    const found=await request('/rest/v1/fs_department_invites?select=*&status=eq.pending&id=eq.'+encodeURIComponent(b.invitationId));invitation=found.data?.[0];if(!found.ok||!invitation)return reply(404,{error:'Convite pendente não encontrado.'});email=invitation.email;name=invitation.name;
   }
   if(name.length<2||name.length>80||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply(400,{error:'Informe o nome e o e-mail do responsável pelo departamento.'});
   const membership=await request('/rest/v1/fs_members?select=id&email=eq.'+encodeURIComponent(email));if(!membership.ok)throw Error('membership');if(membership.data.length)return reply(409,{error:'Este e-mail já pertence a um departamento. Utilize o convite de um responsável ainda não vinculado.'});
   const lookup=await request('/rest/v1/rpc/fs_find_auth_user','POST',{p_email:email});if(!lookup.ok)throw Error('lookup');let id=lookup.data||undefined,account:any;
   if(id){
    const found=await request('/auth/v1/admin/users/'+encodeURIComponent(id));if(!found.ok)throw Error('account');account=found.data.user||found.data;
    if(!invitation){const pending=await request('/rest/v1/fs_department_invites?select=*&status=eq.pending&user_id=eq.'+encodeURIComponent(id));if(!pending.ok)throw Error('invitation');invitation=pending.data?.[0];}
   }
   if(invitation?.sent_at&&Date.now()-Date.parse(invitation.sent_at)<60000)return reply(429,{error:'Aguarde um minuto antes de reenviar o convite.'});
   const awaiting=account?.invited_at&&!account.email_confirmed_at&&!account.confirmed_at&&!account.last_sign_in_at;
   const existing=!!account&&!awaiting&&!!(account.email_confirmed_at||account.confirmed_at||account.last_sign_in_at);
   const send=async()=>existing?request('/auth/v1/otp?redirect_to='+encodeURIComponent(redirect),'POST',{email,create_user:false},publicKey,publicKey):request('/auth/v1/invite?redirect_to='+encodeURIComponent(redirect),'POST',{email,data:{name,full_name:name}});
   let delivery:any;
   if(!id){delivery=await send();if(!delivery.ok)return reply(delivery.status===429?429:400,{error:'Não foi possível enviar o convite. Confira o e-mail e tente novamente mais tarde.'});id=delivery.data.user?.id||delivery.data.id;if(!id)throw Error('id');}
   if(!invitation){const created=await request('/rest/v1/fs_department_invites','POST',{user_id:id,name,email,created_by:identity.data.id});if(!created.ok)throw Error('save invitation');invitation=created.data?.[0];if(!invitation?.id)throw Error('invitation id');}
   if(!existing){
    const pending=await request('/rest/v1/fs_password_onboarding?user_id=eq.'+encodeURIComponent(id));if(!pending.ok)throw Error('password');
    if(!pending.data.length){const created=await request('/rest/v1/fs_password_onboarding','POST',{user_id:id,required:true});if(!created.ok)throw Error('password');}
   }
   delivery=delivery||await send();
   const updated=await request('/rest/v1/fs_department_invites?id=eq.'+encodeURIComponent(invitation.id),'PATCH',{email_status:delivery.ok?'sent':'failed',...(delivery.ok?{sent_at:new Date().toISOString()}:{})});if(!updated.ok)throw Error('delivery status');
   if(!delivery.ok)return reply(delivery.status===429?429:400,{error:'O convite ficou pendente. O serviço de e-mail não concluiu o envio; tente reenviar mais tarde.'});
   return reply(200,{ok:true,existing,invitationId:invitation.id});
  }catch{return reply(500,{error:'Não foi possível concluir. Os convites pendentes podem ser reenviados sem recriar o departamento.'});}
 };
}
if(typeof Deno!=='undefined')Deno.serve(departmentHandler(key=>Deno.env.get(key)));
