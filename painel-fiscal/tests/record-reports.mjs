import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
function fixture(){const item={id:'routine',version:3,title:'Alteração contratual <teste>',owner:'u',createdAt:'2026-10-01T12:00:00Z',updatedAt:'2026-11-16T13:00:00Z',start:'2026-10-01',end:'2026-11-20',status:'Concluída',groupId:'g',stageId:'done',frequency:'Única',priority:'Alta',company:'Empresa',protocol:'000123',activities:[{id:'a',title:'Registrar',done:true}],comments:[{id:'note',at:'2026-10-02T12:00:00Z',author:'Pessoa',text:'Texto integral do acompanhamento',attachments:[{id:'f',name:'Documento.pdf',type:'application/pdf',size:123}]}],executions:[],delegations:[]};return {issuedAt:'2026-11-16T14:00:00Z',department:'Fiscal',group:'Alterações contratuais',stage:'Registrado',ownerName:'Pessoa',users:[{id:'u',name:'Pessoa'}],item,history:[{id:1,at:'2026-11-16T12:00:00Z',actor:'Sistema',kind:'baseline',snapshot:{version:2,stage:'Preparação',group:'Alterações contratuais',data:{...item,title:'Título antigo',status:'Planejada',activities:[{id:'a',title:'Registrar',done:false}]}},legacyEvents:[{at:'2026-10-02T12:00:00Z',author:'Pessoa',action:'Moveu registro para Preparação'}]},{id:2,at:'2026-11-16T13:00:00Z',actor:'Pessoa',kind:'changed',snapshot:{version:3,stage:'Registrado',group:'Alterações contratuais',data:item},changes:[{field:'status',before:'Planejada',after:'Concluída'},{field:'activities',before:[{id:'a',title:'Registrar',done:false}],after:item.activities}]}]};}
test('relatório de rotina: histórico completo, legado identificado e snapshot estável',async()=>{
 const groups={g:{printEnabled:true},no:{printEnabled:false}},ctx=vm.createContext({Date,Intl,JSON,Map,groupById:id=>groups[id],esc:s=>String(s).replaceAll('<','&lt;')});
 vm.runInContext(await readFile('public/record-reports.js','utf8'),ctx);const source=fixture();ctx.source=source;const report=vm.runInContext('recordReportData(source)',ctx);
 assert.equal(report.tables.length,8);assert.ok(report.coverage.includes('não podem ser recuperadas'));
 assert.ok(report.tables.find(t=>t.name==='Histórico').rows.some(r=>r.includes('Registro legado por título')));
 assert.ok(report.tables.find(t=>t.name==='Histórico').rows.some(r=>r.some(v=>String(v).includes('Título antigo'))));
 assert.ok(report.tables.find(t=>t.name==='Etapas').rows.some(r=>r.includes('Preparação')));assert.ok(report.tables.find(t=>t.name==='Etapas').rows.some(r=>r.includes('Registrado')));
 assert.equal(report.tables.find(t=>t.name==='Anexos').rows.length,1);assert.equal(report.tables.find(t=>t.name==='Atividades').rows[0][2],'Concluída');
 source.item.comments[0].text='alteração posterior';assert.equal(report.tables.find(t=>t.name==='Acompanhamentos').rows[0][3],'Texto integral do acompanhamento');
 assert.ok(vm.runInContext("recordReportButtons({id:'routine',groupId:'g'})",ctx).includes('data-record-export="xlsx"'));assert.equal(vm.runInContext("recordReportButtons({id:'routine',groupId:'no'})",ctx),'');
 const text=('Texto longo 😀\n').repeat(5000);ctx.longText=text;
 const chunks=vm.runInContext('recordReportChunks(longText)',ctx);assert.equal(chunks.join(''),text);assert.ok(chunks.every(s=>s.length<=30000));
 const readable=vm.runInContext('recordReportChunks(longText,300)',ctx);assert.equal(readable.join(''),text);assert.ok(readable.every(s=>s.length<=300));
});
test('relatório de rotina: novos registros não recebem uma linha de base retroativa',async()=>{
 const ctx=vm.createContext({Date,Intl,JSON,Map});vm.runInContext(await readFile('public/record-reports.js','utf8'),ctx);const source=fixture();source.history=[{...source.history[1],kind:'created'}];ctx.source=source;
 assert.ok(vm.runInContext('recordReportData(source).coverage',ctx).includes('desde a criação'));
});
