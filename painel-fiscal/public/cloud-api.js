/* Chave pública somente. Autorizações são verificadas no banco e na função de cadastro. */
if(window.FISCAL_CLOUD){
 const config=window.FISCAL_CLOUD,sessionKey='cavalca-fiscal-session-v1';
 let session;try{session=JSON.parse(localStorage.getItem(sessionKey)||'null');}catch{session=null;}
 let refreshing;
 const save=value=>{session=value;if(value)localStorage.setItem(sessionKey,JSON.stringify(value));else localStorage.removeItem(sessionKey);};
 function failure(status,message){return Object.assign(Error(message),{status});}
 async function auth(path,payload){const r=await fetch(config.url+'/auth/v1/'+path,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify(payload)});const b=await r.json();if(!r.ok)throw failure(r.status,b.error_description||b.msg||b.message||'Não foi possível entrar.');if(b.access_token)save({...b,expires_at:Math.floor(Date.now()/1000)+b.expires_in});return b;}
 async function token(){if(!session)throw failure(401,'Entre com sua conta para continuar.');if(session.expires_at<Date.now()/1000+60){if(!refreshing)refreshing=auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token}).catch(e=>{save(null);throw e;}).finally(()=>refreshing=null);await refreshing;}return session.access_token;}
 async function request(path,method='GET',body,binary){const access=await token();const r=await fetch(config.url+path,{method,headers:{apikey:config.key,Authorization:'Bearer '+access,...(binary?{'Content-Type':binary}:{'Content-Type':'application/json'})},body:body===undefined?undefined:binary?body:JSON.stringify(body)});const b=r.status===204?{}:await r.json();if(!r.ok){if(r.status===401)save(null);throw failure(r.status,b.message||b.error||'Não foi possível concluir.');}return b;}
 const rpc=(name,payload={})=>request('/rest/v1/rpc/'+name,'POST',payload);
 async function signed(state){const rows=state.items.flatMap(i=>[...i.comments,...i.executions,...(i.delegations||[])]);const paths=[...new Set(rows.flatMap(n=>(n.attachments||[]).map(a=>a.path)).filter(Boolean))];if(!paths.length)return state;const links=await request('/storage/v1/object/sign/fiscal-prints','POST',{paths,expiresIn:3600});const urls=new Map(links.map(a=>[a.path,a.signedURL||a.signedUrl]));for(const row of rows)for(const a of row.attachments||[]){const link=urls.get(a.path);if(link)a.url=link.startsWith('https://')?link:config.url+'/storage/v1'+(link.startsWith('/')?link:'/'+link);}return state;}
 async function uploads(itemId,images){const staged=[];try{if(images.length>3)throw Error('Anexe até 3 prints.');for(const image of images){if(!['image/png','image/jpeg','image/webp'].includes(image.type))throw Error('Use imagens PNG, JPG ou WebP.');const raw=atob(image.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(!bytes.length||bytes.length>5*1024*1024)throw Error('Cada print deve ter no máximo 5 MB.');const meta=await rpc('fs_prepare_attachment',{p_item:itemId,p_name:image.name,p_type:image.type,p_size:bytes.length});staged.push(meta);await request('/storage/v1/object/fiscal-prints/'+meta.path,'POST',bytes,image.type);}return staged;}catch(e){await cleanup(staged);throw e;}}
 async function cleanup(images){for(const image of images){try{await request('/storage/v1/object/fiscal-prints','DELETE',{prefixes:[image.path]});await rpc('fs_discard_attachment',{p_id:image.id});}catch{}}}
 window.FiscalCloud={async api(route,method='GET',body={}){
 if(route==='setup')return {required:false};
 if(route==='login'){await auth('token?grant_type=password',{email:body.email,password:body.password});return {};}
 if(route==='logout'){try{await request('/auth/v1/logout','POST',{});}finally{save(null);}return {};}
 if(route==='state')return signed(await rpc('fs_get_state'));
 if(route==='users')return request('/functions/v1/fiscal-create-member','POST',body);
 if(route==='items')return rpc('fs_create_item',{p_payload:body});
 if(route.startsWith('items/')){const id=route.slice(6),images=await uploads(id,body.attachments||[]);try{return await rpc('fs_apply_item',{p_id:id,p_payload:{...body,attachments:images.map(a=>a.id)}});}catch(e){await cleanup(images);throw e;}}
 throw Error('Operação desconhecida.');
 }};
}
