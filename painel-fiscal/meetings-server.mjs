import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const str=(v,max)=>typeof v==='string'&&v.length<=max?v.trim():'';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export async function handleMeetings(route,req,{db,user,body,send,save,event}){
 if(!route.startsWith('/api/meetings'))return false;db.meetings??=[];
 if(route==='/api/meetings'&&req.method==='GET'){send(200,[...db.meetings].sort((a,b)=>b.date.localeCompare(a.date)));return true;}
 const match=route.match(/^\/api\/meetings(?:\/([0-9a-f-]{36}))?$/);if(!match||!['POST','PUT'].includes(req.method))return false;
 const b=await body(req),existing=match[1]?db.meetings.find(m=>m.id===match[1]):null;if(match[1]&&!existing)fail('Reunião não encontrada.',404);
 if(!['save','finalize','comment'].includes(b.action))fail('Operação inválida.');
 if(existing?.status==='Finalizada'&&b.action==='finalize'){send(200,{id:existing.id,created:existing.actions.length,alreadyFinalized:true});return true;}
 if(existing&&b.version!==existing.version)fail('Outra pessoa atualizou esta reunião. Reabra antes de salvar.',409);
 if(b.action==='comment'){
  if(!existing||!str(b.text,2000))fail('Informe um acompanhamento de até 2.000 caracteres.');existing.comments.push({id:randomUUID(),text:b.text.trim(),author:user.name,at:new Date().toISOString()});existing.version++;existing.updatedAt=new Date().toISOString();event(user,'Registrou acompanhamento da reunião',existing);save();send(200,{id:existing.id});return true;
 }
 if(existing?.status==='Finalizada')fail('A ata foi finalizada. Registre novos acompanhamentos sem alterar a ata original.');
 if(!str(b.title,150)||!validDate(b.date)||typeof b.minutes!=='string'||b.minutes.length>50000||typeof b.topics!=='string'||b.topics.length>10000||typeof b.decisions!=='string'||b.decisions.length>10000||typeof b.summary!=='string'||b.summary.length>4000)fail('Revise os dados da ata.');
 if(!Array.isArray(b.attendees)||b.attendees.some(id=>!db.users.some(u=>u.id===id)))fail('Participantes inválidos.');
 if(!Array.isArray(b.actions)||b.actions.length>100)fail('Informe até 100 ações por reunião.');
 const actions=b.actions.map(a=>{if(!str(a.title,150)||typeof a.description!=='string'||a.description.length>2000)fail('Revise o nome e os detalhes das ações.');if(a.owner&&!db.users.some(u=>u.id===a.owner))fail('Responsável inválido.');if(a.start&&!validDate(a.start)||a.end&&!validDate(a.end)||a.start&&a.end&&a.end<a.start)fail('Revise o período das ações.');if(b.action==='finalize'&&(!a.owner||!a.start||!a.end))fail('Antes de finalizar, defina responsável, início e prazo de todas as ações.');const id=a.id||randomUUID();if(!/^[0-9a-f-]{36}$/i.test(id))fail('Identificador de ação inválido.');return {id,title:a.title.trim(),description:a.description,owner:a.owner||null,start:a.start||null,end:a.end||null,priority:['Baixa','Média','Alta'].includes(a.priority)?a.priority:'Média'};});
 if(new Set(actions.map(a=>a.id)).size!==actions.length)fail('Ações repetidas na ata.');if(b.action==='finalize'&&!b.minutes.trim())fail('Registre a ata antes de finalizar.');
 const at=new Date().toISOString(),m={id:existing?.id||randomUUID(),createdBy:existing?.createdBy||user.id,createdAt:existing?.createdAt||at,updatedAt:at,version:existing?existing.version+1:1,title:b.title.trim(),date:b.date,topics:b.topics,minutes:b.minutes,decisions:b.decisions,summary:b.summary,attendees:b.attendees,actions,comments:existing?.comments||[],status:b.action==='finalize'?'Finalizada':'Rascunho'};
 if(b.action==='finalize'){m.finalizedAt=at;m.finalizedBy=user.id;for(const a of actions){const id=randomUUID();db.items.push({id,type:'routine',title:a.title,description:(a.description+'\n\nOrigem: reunião '+m.title+' de '+m.date+'.').slice(0,2000),owner:a.owner,start:a.start,end:a.end,priority:a.priority,frequency:'Única',status:'Planejada',activities:[],delegations:[],comments:[],executions:[],createdAt:at,updatedAt:at,version:1,meetingId:m.id,meetingActionId:a.id});a.routineId=id;event(user,'Criou rotina da reunião',{title:a.title});}}
 if(existing)db.meetings[db.meetings.indexOf(existing)]=m;else db.meetings.push(m);event(user,b.action==='finalize'?'Finalizou reunião e criou '+actions.length+' rotinas':'Salvou rascunho da reunião',m);save();send(200,{id:m.id,created:b.action==='finalize'?actions.length:0});return true;
}
