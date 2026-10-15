import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const text=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export async function handlePersonal(route,req,{db,user,body,send,save,event}){
 if(!/^\/api\/personal(?:\/[^/]+)?$/.test(route))return false;
 db.personalItems??=[];
 if(route==='/api/personal'&&req.method==='GET'){send(200,db.personalItems.filter(i=>i.owner===user.id&&!i.deletedAt));return true;}
 const b=await body(req),id=route.split('/')[3];
 let item=id?db.personalItems.find(i=>i.id===id&&i.owner===user.id&&!i.deletedAt):null;
 if(id&&!item)fail('Atividade pessoal não encontrada.',404);
 if(id&&b.version!==item.version)fail('Esta atividade mudou em outra janela. Reabra antes de salvar.',409);
 if(id&&req.method!=='PUT'||!id&&req.method!=='POST')fail('Método inválido.',405);
 const now=new Date().toISOString();
 if(b.action==='delete'&&item){item.deletedAt=now;item.version++;save();send(200,{ok:true});return true;}
 if(b.action==='share'&&item){
  if(item.sharedItemId){send(200,{id:item.sharedItemId});return true;}
  const shared={id:randomUUID(),type:'routine',title:item.title,description:item.description,owner:user.id,start:item.start,end:item.end,status:item.status,priority:item.priority,frequency:'Única',activities:item.activities.map(a=>({...a,id:randomUUID()})),comments:[],executions:[],delegations:[],createdAt:now,updatedAt:now,version:1};
  db.items.push(shared);item.sharedItemId=shared.id;item.sharedAt=now;item.updatedAt=now;item.version++;event(user,'Compartilhou uma atividade pessoal',shared);save();send(200,{id:shared.id});return true;
 }
 if(b.action&&b.action!=='save')fail('Operação inválida.');
 if(!text(b.title,150)||!validDate(b.start)||!validDate(b.end)||b.end<b.start||!['Planejada','Em andamento','Concluída','Bloqueada'].includes(b.status)||!['Baixa','Média','Alta'].includes(b.priority)||!Array.isArray(b.activities)||b.activities.length>50)fail('Revise nome, período, status e checklist (até 50 itens).');
 const activities=b.activities.map(a=>{if(!text(a.title,200))fail('Preencha os itens do checklist.');return {id:randomUUID(),title:text(a.title,200),done:a.done===true};});
 const data={title:text(b.title,150),description:text(b.description,2000),notes:text(b.notes,10000),start:b.start,end:b.end,status:b.status,priority:b.priority,activities,updatedAt:now};
 if(item){Object.assign(item,data);item.version++;}else{item={...data,id:randomUUID(),owner:user.id,createdAt:now,version:1};db.personalItems.push(item);}
 save();send(id?200:201,{id:item.id});return true;
}
