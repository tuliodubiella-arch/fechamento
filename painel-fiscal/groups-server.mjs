import {randomUUID} from 'node:crypto';
const text=(v,n=2000)=>typeof v==='string'?v.trim().slice(0,n):'';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const statuses=['Planejada','Em andamento','Bloqueada','Concluída'];
export function setGroupRecord(db,item,b){
 if(item.type!=='routine')fail('Somente rotinas podem ser registros de um grupo.');
 const groupId=b.action==='record-stage'?item.groupId:b.groupId;
 if(b.action==='record-stage'&&!groupId)fail('Vincule a rotina a um grupo primeiro.');
 if(groupId){const group=db.groups.find(g=>g.id===groupId&&!g.deletedAt);if(!group)fail('Grupo não encontrado ou excluído.');const stage=group.stages.find(s=>s.id===(b.stageId||group.stages[0].id));if(!stage)fail('Etapa inválida para este grupo.');item.groupId=group.id;item.stageId=stage.id;item.status=stage.status;}
 else {delete item.groupId;delete item.stageId;}
 if(b.action!=='record-stage'){item.company=text(b.company,150);item.registry=text(b.registry,150);item.protocol=text(b.protocol,100);}
 return groupId?b.action==='record-stage'?'Moveu registro para '+db.groups.find(g=>g.id===groupId).stages.find(s=>s.id===item.stageId).name:'Organizou registro no grupo '+db.groups.find(g=>g.id===groupId).title:'Atualizou a organização da rotina';
}
export async function handleGroups(route,req,{db,user,body,send,save,event}){
 if(route==='/api/groups'&&req.method==='POST'){
 const b=await body(req);if(!text(b.title,150)||!db.users.some(u=>u.id===b.owner))fail('Informe nome e responsável do grupo.');
 if(!Array.isArray(b.stages)||b.stages.length<2||b.stages.length>8||b.stages.some(s=>!text(s.name,60)||!statuses.includes(s.status))||new Set(b.stages.map(s=>text(s.name,60))).size!==b.stages.length||!b.stages.some(s=>s.status==='Concluída'))fail('Revise as etapas: use nomes diferentes e ao menos uma etapa concluída.');
 const group={id:randomUUID(),title:text(b.title,150),description:text(b.description),owner:b.owner,stages:b.stages.map(s=>({id:randomUUID(),name:text(s.name,60),status:s.status})),version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.groups.push(group);event(user,'Criou grupo de rotinas',group);save();send(201,{id:group.id});return true;
 }
 const match=route.match(/^\/api\/groups\/([^/]+)$/);if(!match||req.method!=='PUT')return false;
 const b=await body(req),group=db.groups.find(g=>g.id===match[1]&&!g.deletedAt);if(!group)fail('Grupo não encontrado ou excluído.',404);if(b.version!==group.version)fail('Outra pessoa atualizou o grupo. Atualize e tente novamente.',409);
 if(b.action==='delete-group'){
 if(user.role!=='admin')fail('Somente o administrador pode excluir grupos.',403);
 const records=db.items.filter(i=>i.groupId===group.id&&!i.deletedAt),at=new Date().toISOString();group.deletedAt=at;group.deletedBy=user.id;for(const i of records){i.deletedAt=at;i.deletedBy=user.id;i.version++;}event(user,'Excluiu grupo e '+records.length+' registros',group);
 }else if(b.action==='edit-stages'){
 const stages=b.stages;if(!Array.isArray(stages)||stages.length<2||stages.length>20||stages.some(s=>typeof s.name!=='string'||!s.name.trim()||s.name.trim().length>60||!statuses.includes(s.status)))fail('Use de 2 a 20 etapas com nome e status válidos.');
 const next=stages.map(s=>{const old=s.id?group.stages.find(e=>e.id===s.id):null;if(s.id&&!old)fail('Etapa não pertence ao grupo.');const id=s.id||randomUUID();if(s.status==='Concluída'&&old?.status!=='Concluída'&&db.items.some(i=>!i.deletedAt&&i.groupId===group.id&&i.stageId===id))fail('Conclua os registros individualmente antes de transformar esta etapa em concluída.');return {id,name:s.name.trim(),status:s.status};});
 if(new Set(next.map(s=>s.id)).size!==next.length||new Set(next.map(s=>s.name.toLocaleLowerCase('pt-BR'))).size!==next.length)fail('Use etapas e nomes diferentes.');if(!next.some(s=>s.status==='Concluída')||!next.some(s=>s.status!=='Concluída'))fail('Mantenha uma etapa aberta e uma etapa concluída.');
 const records=db.items.filter(i=>!i.deletedAt&&i.groupId===group.id);if(records.some(i=>!next.some(s=>s.id===i.stageId)))fail('Mova os registros antes de remover uma etapa ocupada.');group.stages=next;let affected=0;for(const item of records){const stage=next.find(s=>s.id===item.stageId);if(item.status!==stage.status){item.status=stage.status;item.updatedAt=new Date().toISOString();item.version++;affected++;}}event(user,'Editou as etapas do grupo; atualizou o status de '+affected+' registros',group);
 }else if(b.action==='update-group'){
 if(!text(b.title,150)||!db.users.some(u=>u.id===b.owner))fail('Revise nome e responsável.');group.title=text(b.title,150);group.description=text(b.description);group.owner=b.owner;event(user,'Atualizou grupo',group);
 }else if(b.action==='reorder-records'){
 const ids=db.items.filter(i=>i.groupId===group.id&&!i.deletedAt).map(i=>i.id);
 if(!Array.isArray(b.ids)||b.ids.length!==ids.length||new Set(b.ids).size!==ids.length||b.ids.some(id=>!ids.includes(id)))fail('A lista do grupo mudou. Atualize e tente novamente.');
 group.recordOrder=b.ids;event(user,'Reorganizou registros do grupo',group);
 }else fail('Operação inválida.');group.version++;group.updatedAt=new Date().toISOString();save();send(200,{ok:true});return true;
}
