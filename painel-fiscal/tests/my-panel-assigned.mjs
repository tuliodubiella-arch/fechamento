import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile('public/personal.js','utf8');
function setup(){
 const base={start:'2026-11-06',end:'2026-11-10',createdAt:'2026-11-06',description:'',activities:[],status:'Planejada',priority:'Média'};
 const state={user:{id:'vanilda'},personalItems:[{...base,id:'private',owner:'vanilda',title:'Minha atividade',notes:'ANOTAÇÃO PRIVADA'},{...base,id:'other-private',owner:'other',title:'PRIVADO DE OUTRA PESSOA'}],items:[{...base,id:'assigned',type:'routine',owner:'vanilda',title:'Rotina atribuída'},{...base,id:'group-record',type:'routine',owner:'vanilda',groupId:'g',title:'Registro de alteração'},{...base,id:'other',type:'routine',owner:'other',title:'ROTINA DE OUTRA PESSOA'},{...base,id:'project',type:'project',owner:'vanilda',title:'PROJETO NÃO É ROTINA'},{...base,id:'deleted',type:'routine',owner:'vanilda',title:'ROTINA EXCLUÍDA',deletedAt:'2026-11-01'}],groups:[{id:'g',title:'ALTERAÇÕES CONTRATUAIS'}]};
 const context=vm.createContext({state,heading:(k,t,s,a)=>k+t+s+a,esc:v=>String(v??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),statusClass:()=> 'planned',date:d=>d,today:()=> '2026-11-06',overdue:i=>i.end<'2026-11-06'&&i.status!=='Concluída',progress:()=>0,options:()=>'',empty:(t,s)=>t+s});vm.runInContext(code,context);return {state,get:s=>vm.runInContext(s,context)};
}
test('Meu Painel: reúne pessoais e rotinas atribuídas, inclusive grupos, sem copiar dados',()=>{
 const {state,get}=setup();const before=JSON.stringify(state);assert.deepEqual(Array.from(get('myPanelItems()'),i=>i.id),['private','assigned','group-record']);const html=get('personalContent()');assert.ok(html.includes('data-personal-open="private"'));assert.ok(html.includes('data-open="assigned"'));assert.ok(html.includes('data-open="group-record"'));assert.ok(!html.includes('data-personal-open="assigned"'));assert.ok(html.includes('ALTERAÇÕES CONTRATUAIS'));assert.ok(!html.includes('PRIVADO DE OUTRA PESSOA'));assert.ok(!html.includes('ROTINA DE OUTRA PESSOA'));assert.ok(!html.includes('PROJETO NÃO É ROTINA'));assert.ok(!html.includes('ROTINA EXCLUÍDA'));assert.ok(html.includes('<b>3</b> pendentes'));assert.equal(JSON.stringify(state),before);
});
test('Meu Painel: origem, status, dia e busca aplicam-se às duas origens',()=>{
 const {state,get}=setup();get("personalOrigin='shared'");let html=get('personalContent()');assert.ok(!html.includes('data-personal-open="private"'));assert.ok(html.includes('data-open="assigned"'));get("personalOrigin='personal'");html=get('personalContent()');assert.ok(html.includes('data-personal-open="private"'));assert.ok(!html.includes('data-open="assigned"'));
 get("personalOrigin='';personalQuery='ALTERAÇÕES CONTRATUAIS'");html=get('personalContent()');assert.ok(html.includes('data-open="group-record"'));assert.ok(!html.includes('data-open="assigned"'));
 state.items[0].status='Concluída';get("personalQuery='';personalStatus='Concluída'");html=get('personalContent()');assert.ok(html.includes('data-open="assigned"'));assert.ok(!html.includes('data-personal-open="private"'));get("personalStatus='';personalDay='2026-12-01'");assert.ok(get('personalContent()').includes('Nenhuma atividade encontrada'));
});
test('Meu Painel: alterações e troca do responsável aparecem sem misturar contas',()=>{
 const {state,get}=setup();state.items[0].title='Título atualizado na equipe';assert.ok(get('personalContent()').includes('Título atualizado na equipe'));state.items[0].owner='other';assert.ok(!get('personalContent()').includes('data-open="assigned"'));state.user.id='other';const html=get('personalContent()');assert.ok(html.includes('data-open="assigned"'));assert.ok(!html.includes('data-personal-open="private"'));assert.ok(!html.includes('ANOTAÇÃO PRIVADA'));
});
