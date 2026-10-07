import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {randomBytes,scryptSync,timingSafeEqual,randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const production=process.env.NODE_ENV==='production';
if(production&&(!process.env.SETUP_TOKEN||process.env.SETUP_TOKEN.length<32))throw Error('Configure SETUP_TOKEN com pelo menos 32 caracteres antes de publicar.');
if(production&&process.env.COOKIE_SECURE!=='true')throw Error('Configure COOKIE_SECURE=true e HTTPS para publicar.');
const dir=process.env.DATA_DIR||path.join(root,'data'); mkdirSync(dir,{recursive:true});
const file=path.join(dir,'database.json');
let db=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{users:[],items:[],events:[]};
const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(db,null,2));renameSync(file+'.tmp',file);};
const sessions=new Map(), attempts=new Map();
const cleanUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role});
const hash=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');};
const validPassword=(p,h)=>{const [s,v]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(v,'hex'));};
const emailValid=e=>typeof e==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const hashSetupToken=value=>createHash('sha256').update(value).digest('hex');
const text=(v,max=2000)=>typeof v==='string'?v.trim().slice(0,max):'';
const event=(user,action,item)=>{db.events.unshift({id:randomUUID(),user:user.name,action,item:item?.title||'Equipe',at:new Date().toISOString()});db.events=db.events.slice(0,1000);};
const dateValid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d));
const body=async req=>{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>22*1024*1024)throw Object.assign(Error('Envio muito grande. Anexe até 3 prints de 5 MB cada.'),{status:413});chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');};
function storeAttachments(input){
 if(input===undefined)return [];if(!Array.isArray(input)||input.length>3)throw Object.assign(Error('Anexe até 3 prints por registro.'),{status:400});
 const images=input.map(a=>{
 if(!a||typeof a.data!=='string'||a.data.length>7*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.data))throw Object.assign(Error('Print inválido.'),{status:400});
 const bytes=Buffer.from(a.data,'base64');if(!bytes.length||bytes.length>5*1024*1024)throw Object.assign(Error('Cada print deve ter no máximo 5 MB.'),{status:400});
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>=24&&bytes.toString('ascii',12,16)==='IHDR';
 const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=bytes.length>=16&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 const mime=png?'image/png':jpeg?'image/jpeg':webp?'image/webp':null;
 if(!mime||mime!==a.type)throw Object.assign(Error('Use prints em PNG, JPG ou WebP.'),{status:400});
 const id=randomUUID();return {bytes,meta:{id,name:text(a.name,150)||'Print',type:mime,size:bytes.length,file:id+({ 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'})[mime]}};
 });
 mkdirSync(path.join(dir,'attachments'),{recursive:true});for(const i of images)writeFileSync(path.join(dir,'attachments',i.meta.file),i.bytes);return images.map(i=>i.meta);
}
function sample(user){const today=new Date();const day=n=>{const d=new Date(today);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
 db.items=[['routine','Conferência de documentos fiscais','Validar entradas, saídas e divergências antes do fechamento.','Diária',-2,1,'Em andamento'],['routine','Apuração de tributos','Conferir a base de cálculo e preparar a memória de apuração.','Mensal',0,7,'Planejada'],['routine','Conciliação fiscal × contábil','Conciliar saldos e tratar diferenças com o time contábil.','Mensal',-7,-1,'Em andamento'],['project','Revisão do fluxo de conferência','Organizar o fluxo de entrada e padronizar os pontos de controle.','Única',-5,20,'Em andamento'],['project','Padronização dos relatórios fiscais','Criar um padrão de relatórios para acompanhamento do setor.','Única',0,30,'Planejada']].map(([type,title,description,frequency,s,e,status])=>({id:randomUUID(),type,title,description,frequency,start:day(s),end:day(e),status,owner:user.id,priority:'Média',activities:[{id:randomUUID(),title:'Revisar informações e documentos',done:false},{id:randomUUID(),title:'Validar com o responsável',done:false}],comments:[],executions:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1}));
}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const route=url.pathname;
 const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
 if(!route.startsWith('/api/')){const assets={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/delegations.css':'delegations.css','/logo.png':'logo.png','/attachments.js':'attachments.js','/attachments.css':'attachments.css'};if(!assets[route]){res.writeHead(404);return res.end('Não encontrado');}const ext=path.extname(assets[route]);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'})[ext],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob:; script-src 'self'; frame-ancestors 'none'; base-uri 'self'"});return res.end(readFileSync(path.join(root,'public',assets[route])));}
 if(!['GET','POST','PUT'].includes(req.method))return send(405,{error:'Método inválido.'});
 if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return send(403,{error:'Origem não permitida.'});
 if(route==='/api/setup'&&req.method==='GET')return send(200,{required:db.users.length===0,protected:production});
 if(route==='/api/setup'&&req.method==='POST'){
 const b=await body(req);if(db.users.length)return send(409,{error:'O administrador já foi criado.'});if(production&&(typeof b.setupToken!=='string'||b.setupToken.length>256||!timingSafeEqual(Buffer.from(hashSetupToken(b.setupToken)),Buffer.from(hashSetupToken(process.env.SETUP_TOKEN)))))return send(403,{error:'Código de configuração incorreto.'});if(!text(b.name,80)||!emailValid(b.email)||typeof b.password!=='string'||b.password.length<10||b.password.length>128)return send(400,{error:'Informe nome, e-mail válido e senha de 10 a 128 caracteres.'});
 const u={id:randomUUID(),name:text(b.name,80),email:b.email.toLowerCase().trim(),password:hash(b.password),role:'admin'};db.users.push(u);if(b.samples)sample(u);save();return send(201,{ok:true});}
 if(route==='/api/login'&&req.method==='POST'){
 const b=await body(req);const key=req.socket.remoteAddress;let a=attempts.get(key)||{n:0,time:Date.now()};if(Date.now()-a.time>600000)a={n:0,time:Date.now()};if(a.n>=15)return send(429,{error:'Muitas tentativas. Aguarde 10 minutos.'});
 const u=db.users.find(u=>u.email===text(b.email,254).toLowerCase());if(typeof b.password!=='string'||b.password.length>128||!u||!validPassword(b.password,u.password)){a.n++;attempts.set(key,a);return send(401,{error:'E-mail ou senha incorretos.'});}attempts.delete(key);const token=randomBytes(32).toString('hex');sessions.set(token,{id:u.id,expires:Date.now()+28800000});res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);return send(200,{user:cleanUser(u)});}
 const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);const session=sessions.get(token);const user=session&&session.expires>Date.now()&&db.users.find(u=>u.id===session.id);if(!user)return send(401,{error:'Entre com sua conta para continuar.'});
 if(route==='/api/logout'&&req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
 const imageMatch=route.match(/^\/api\/attachments\/([0-9a-f-]{36})$/);if(imageMatch&&req.method==='GET'){
 const attachment=db.items.flatMap(i=>[...i.comments,...i.executions]).flatMap(n=>n.attachments||[]).find(a=>a.id===imageMatch[1]);
 if(!attachment)return send(404,{error:'Print não encontrado.'});
 const bytes=readFileSync(path.join(dir,'attachments',attachment.file));res.writeHead(200,{'Content-Type':attachment.type,'Content-Length':bytes.length,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Disposition':'inline'});return res.end(bytes);
 }
 if(route==='/api/state'&&req.method==='GET')return send(200,{user:cleanUser(user),users:db.users.map(cleanUser),items:db.items,events:db.events});
 if(route==='/api/users'&&req.method==='POST'){
 if(user.role!=='admin')return send(403,{error:'Somente o administrador pode cadastrar pessoas.'});const b=await body(req);if(!text(b.name,80)||!emailValid(b.email)||typeof b.password!=='string'||b.password.length<10||b.password.length>128)return send(400,{error:'Informe nome, e-mail válido e senha de 10 a 128 caracteres.'});if(db.users.some(u=>u.email===b.email.trim().toLowerCase()))return send(409,{error:'Este e-mail já está cadastrado.'});db.users.push({id:randomUUID(),name:text(b.name,80),email:b.email.trim().toLowerCase(),password:hash(b.password),role:'member'});event(user,'Cadastrou uma pessoa');save();return send(201,{ok:true});}
 if(route==='/api/items'&&req.method==='POST'){
 const b=await body(req);if(!text(b.title,150)||!['routine','project'].includes(b.type)||!dateValid(b.start)||!dateValid(b.end)||b.end<b.start||!db.users.some(u=>u.id===b.owner))return send(400,{error:'Revise o título, responsável e período de execução.'});const item={id:randomUUID(),type:b.type,title:text(b.title,150),description:text(b.description),owner:b.owner,start:b.start,end:b.end,frequency:['Diária','Semanal','Mensal','Única'].includes(b.frequency)?b.frequency:'Única',priority:['Baixa','Média','Alta'].includes(b.priority)?b.priority:'Média',status:'Planejada',activities:[],comments:[],executions:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1};db.items.push(item);event(user,'Criou',item);save();return send(201,{id:item.id});}
 const match=route.match(/^\/api\/items\/([^/]+)$/);if(match&&req.method==='PUT'){
 const b=await body(req);const item=db.items.find(i=>i.id===match[1]);if(!item)return send(404,{error:'Registro não encontrado.'});if(b.version!==item.version)return send(409,{error:'Outra pessoa atualizou este registro. Os dados foram recarregados; confira antes de repetir.'});
 const action=b.action;
 if(action==='status'&&['Planejada','Em andamento','Concluída','Bloqueada'].includes(b.status)){item.status=b.status;event(user,`Alterou o status para ${b.status}`,item);}
 else if(action==='activity'&&text(b.title,200)){item.activities.push({id:randomUUID(),title:text(b.title,200),done:false});event(user,'Adicionou atividade',item);}
 else if(action==='delegate'){
 if(user.id!==item.owner&&user.role!=='admin')return send(403,{error:'Somente o dono da entrega ou administrador pode delegar ações.'});
 const assignee=db.users.find(u=>u.id===b.assignee);if(!text(b.title,200)||!assignee||assignee.id===item.owner||!dateValid(b.due))return send(400,{error:'Informe a ação, o prazo e uma pessoa diferente do dono da entrega.'});
 item.delegations??=[];item.delegations.push({id:randomUUID(),title:text(b.title,200),assignee:assignee.id,due:b.due,done:false,createdBy:user.id,createdAt:new Date().toISOString(),completedAt:null,completedBy:null,result:''});event(user,`Delegou “${text(b.title,200)}” para ${assignee.name}`,item);
 }
 else if(action==='complete-delegation'||action==='reopen-delegation'){
 const d=item.delegations?.find(d=>d.id===b.id);if(!d)return send(404,{error:'Ação delegada não encontrada.'});
 if(user.id!==d.assignee&&user.id!==item.owner&&user.role!=='admin')return send(403,{error:'Somente a pessoa responsável, o dono da entrega ou administrador pode atualizar esta ação.'});
 if(action==='complete-delegation'){
 if(d.done)return send(409,{error:'Esta ação já foi concluída.'});if(!text(b.result))return send(400,{error:'Descreva o resultado da ação para concluir.'});
 const attachments=storeAttachments(b.attachments);d.done=true;d.completedAt=new Date().toISOString();d.completedBy=user.id;d.result=text(b.result);d.attachments=attachments;
 item.executions.push({id:randomUUID(),text:`Ação delegada: ${d.title}\nResultado: ${d.result}`,author:user.name,at:d.completedAt,attachments});event(user,`Concluiu a ação delegada “${d.title}”`,item);
 }else{if(!d.done)return send(409,{error:'Esta ação já está pendente.'});d.done=false;d.completedAt=null;d.completedBy=null;d.result='';d.attachments=[];event(user,`Reabriu a ação delegada “${d.title}”`,item);}
 }
 else if(action==='toggle'){const a=item.activities.find(a=>a.id===b.id);if(!a)return send(404,{error:'Atividade não encontrada.'});a.done=!a.done;event(user,a.done?'Concluiu atividade':'Reabriu atividade',item);}
 else if(action==='comment'&&text(b.text)){const attachments=storeAttachments(b.attachments);item.comments.push({id:randomUUID(),text:text(b.text),author:user.name,at:new Date().toISOString(),attachments});event(user,'Comentou',item);}
 else if(action==='execution'&&text(b.text)){const attachments=storeAttachments(b.attachments);item.executions.push({id:randomUUID(),text:text(b.text),author:user.name,at:new Date().toISOString(),attachments});event(user,'Registrou execução',item);}
 else if(action==='schedule'&&dateValid(b.start)&&dateValid(b.end)&&b.end>=b.start){item.start=b.start;item.end=b.end;event(user,'Atualizou o cronograma',item);}
 else return send(400,{error:'Revise os campos preenchidos.'});item.updatedAt=new Date().toISOString();item.version++;save();return send(200,{ok:true});}
 send(404,{error:'Recurso não encontrado.'});
 }catch(e){send(e.status||400,{error:e instanceof SyntaxError?'Dados inválidos.':e.status?e.message:'Não foi possível concluir a operação.'});}
});
server.listen(Number(process.env.PORT)||4273,process.env.HOST||'127.0.0.1',()=>console.log(`Painel fiscal: http://localhost:${process.env.PORT||4273}`));
