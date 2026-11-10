import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextRecurrenceDate,generateRecurrence} from '../recurrence-server.mjs';
import {readFile} from 'node:fs/promises';
test('anual: preserva cronograma de validação no próximo ano e trata anos bissextos',()=>{
 assert.equal(nextRecurrenceDate('2026-09-01','Anual'),'2027-09-01');assert.equal(nextRecurrenceDate('2026-12-31','Anual'),'2027-12-31');assert.equal(nextRecurrenceDate('2024-02-29','Anual',29),'2025-02-28');assert.equal(nextRecurrenceDate('2027-02-28','Anual',29),'2028-02-29');
 const item={id:'annual',type:'routine',title:'Validar ECF',owner:'u',start:'2026-09-01',end:'2026-12-31',frequency:'Anual',status:'Concluída',activities:[]},db={items:[item]};const next=generateRecurrence(db,item,{...item,status:'Planejada'},null,()=>{});assert.equal(next.start,'2027-09-01');assert.equal(next.end,'2027-12-31');assert.equal(next.frequency,'Anual');assert.equal(next.status,'Planejada');assert.equal(generateRecurrence(db,item,{...item,status:'Planejada'},null,()=>{}),null);assert.equal(db.items.length,2);
});
test('anual: formulários de criação e edição e servidor aceitam a frequência',async()=>{
 for(const p of ['public/app.js','public/groups.js','server.mjs'])assert.ok((await readFile(p,'utf8')).includes("'Diária','Semanal','Mensal','Anual','Única'"));
});
