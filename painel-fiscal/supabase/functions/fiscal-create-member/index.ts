import {createClient} from 'npm:@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'https://tuliodubiella-arch.github.io','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 const reply=(status:number,body:object)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply(405,{error:'Método inválido.'});
 try{
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
 const client=createClient(url,key,{global:{headers:{Authorization:req.headers.get('Authorization')||''}},auth:{persistSession:false}});
 const {data:{user},error}=await client.auth.getUser();if(error||!user)return reply(401,{error:'Entre com sua conta.'});
 const {data:member}=await client.from('fs_members').select('role,active,name').eq('id',user.id).single();if(!member?.active||member.role!=='admin')return reply(403,{error:'Somente o administrador pode cadastrar pessoas.'});
 const raw=await req.text();if(raw.length>10000)return reply(413,{error:'Dados muito grandes.'});const b=JSON.parse(raw),name=String(b.name||'').trim().slice(0,80),email=String(b.email||'').trim().toLowerCase();
 if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof b.password!=='string'||b.password.length<10||b.password.length>128)return reply(400,{error:'Informe nome, e-mail e senha de 10 a 128 caracteres.'});
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {data:exists}=await admin.from('fs_members').select('id').eq('email',email).maybeSingle();if(exists)return reply(409,{error:'Este e-mail já pertence à equipe fiscal.'});
 const {data:known,error:lookup}=await admin.rpc('fs_find_auth_user',{p_email:email});if(lookup)throw lookup;
 let id=known,created=false;if(!id){const {data,error}=await admin.auth.admin.createUser({email,password:b.password,email_confirm:true,user_metadata:{name}});if(error)return reply(400,{error:'Não foi possível criar a conta.'});id=data.user.id;created=true;}
 const {error:insert}=await admin.from('fs_members').insert({id,name,email,role:'member',active:true});if(insert){if(created)await admin.auth.admin.deleteUser(id);throw insert;}
 await admin.from('fs_events').insert({user:member.name,action:'Cadastrou '+name,item:'Equipe'});
 return reply(201,{ok:true,existing:!created});
 }catch{return reply(400,{error:'Não foi possível cadastrar a pessoa.'});}
});
