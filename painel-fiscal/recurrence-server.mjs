import {randomUUID} from 'node:crypto';
export function nextRecurrenceDate(value,frequency,anchor=Number(value.slice(8,10))){
 const day=new Date(value+'T12:00:00Z');
 if(frequency==='Mensal'||frequency==='Anual'){
  const year=day.getUTCFullYear()+(frequency==='Anual'?1:0),month=day.getUTCMonth()+(frequency==='Mensal'?1:0),last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return new Date(Date.UTC(year,month,Math.min(anchor,last),12)).toISOString().slice(0,10);
 }
 day.setUTCDate(day.getUTCDate()+(frequency==='Semanal'?7:1));return day.toISOString().slice(0,10);
}
export function generateRecurrence(db,item,previous,user,event){
 if(item.start!==previous.start||item.end!==previous.end||item.frequency!==previous.frequency){delete item.recurrenceStartDay;delete item.recurrenceEndDay;}
 if(item.deletedAt||item.type!=='routine'||item.status!=='Concluída'||previous.status==='Concluída'||!['Diária','Semanal','Mensal','Anual'].includes(item.frequency)||item.recurrenceNextId)return null;
 const existing=db.items.find(i=>i.recurrencePreviousId===item.id);if(existing){item.recurrenceNextId=existing.id;return existing;}
 const at=new Date().toISOString(),startAnchor=item.recurrenceStartDay||Number(item.start.slice(8,10)),endAnchor=item.recurrenceEndDay||Number(item.end.slice(8,10));
 const next={...item,id:randomUUID(),version:1,start:nextRecurrenceDate(item.start,item.frequency,startAnchor),end:nextRecurrenceDate(item.end,item.frequency,endAnchor),status:'Planejada',recurrencePreviousId:item.id,recurrenceRootId:item.recurrenceRootId||item.id,recurrenceStartDay:startAnchor,recurrenceEndDay:endAnchor,createdAt:at,updatedAt:at,activities:item.activities.map(a=>({id:randomUUID(),title:a.title,done:false})),comments:[],executions:[],delegations:[],protocol:''};
 if(item.groupId){const group=db.groups.find(g=>g.id===item.groupId&&!g.deletedAt),stage=group?.stages.find(s=>s.status!=='Concluída');if(!stage)throw Object.assign(Error('O grupo precisa de uma etapa aberta para receber a próxima ocorrência.'),{status:400});next.stageId=stage.id;next.status=stage.status;}
 item.recurrenceNextId=next.id;db.items.push(next);event(user,`Criou automaticamente a próxima ocorrência (${next.start} a ${next.end})`,next);return next;
}
