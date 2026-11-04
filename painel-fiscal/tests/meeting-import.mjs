import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile('public/meeting-import.js','utf8');
const context=vm.createContext({TextDecoder,DataView,Uint8Array,Date,Set,Map});vm.runInContext(code,context);const get=s=>vm.runInContext(s,context);
context.users=[{id:'t',name:'Tulio Antonio Dubiella',email:'tulio@example.test'},{id:'m',name:'Marluza Beal',email:'marluza@example.test'},{id:'a',name:'Ana Silva'},{id:'b',name:'Ana Beal'}];
test('atas: tabelas, nomes cadastrados, datas explícitas e deduplicação',()=>{
 context.text='Nome da reunião: Alinhamento fiscal\nData da reunião: 03/11/2026\nParticipantes: Tulio Dubiella; Marluza\nResumo: Integrações e apuração\nDecisões: Revisar documentos\nAções\nAtividade | Responsável | Prazo\nRevisar integração | Marluza | 06/11/2026\nConferir tributos | Tulio Dubiella | 09/11/2026\nRevisar integração | Marluza | 06/11/2026';
 const result=get("parseMeetingMinutes(text,users,'2026-12-01')");assert.equal(result.actions.length,2);assert.equal(result.actions[0].owner,'m');assert.equal(result.actions[0].end,'2026-11-06');assert.equal(result.actions[0].start,'2026-11-03');assert.equal(result.date,'2026-11-03');assert.equal(result.title,'Alinhamento fiscal');assert.equal(result.summary,'Integrações e apuração');assert.equal(result.decisions,'Revisar documentos');assert.equal(result.attendees.length,2);
});
test('atas: responsáveis ambíguos ou externos e prazos relativos ficam para revisão',()=>{
 context.text='Ação: Validar documentos\nResponsável: Ana\nPrazo: sexta-feira\nAção: Verificar cadastro | Responsável: Patricia | Prazo: 31/02/2026';
 const result=get("parseMeetingMinutes(text,users,'2026-11-03')");assert.equal(result.actions.length,2);for(const a of result.actions){assert.equal(a.owner,'');assert.equal(a.end,'');}assert.ok(result.actions[0].description.includes('Ana'));assert.ok(result.actions[1].description.includes('Patricia'));assert.equal(get("meetingImportDate('10/11')"),'');assert.equal(get("meetingImportDate('entre 03/11/2026 e 06/11/2026')"),'');assert.equal(get("meetingImportDate('10 de novembro de 2026')"),'2026-11-10');
});
test('atas: listas de ações e rótulos em uma linha, sem transformar toda a discussão em tarefa',()=>{
 context.text='Pauta\n- Discutir melhorias gerais\nEncaminhamentos\n- Marluza: Conferir integração até 06/11/2026\n- Tulio Dubiella - Revisar documentos - Prazo: 09/11/2026\nDecisões\nA equipe validou o fluxo.';
 const result=get("parseMeetingMinutes(text,users,'2026-11-03')");assert.equal(result.actions.length,2);assert.equal(result.actions[0].owner,'m');assert.equal(result.actions[0].end,'2026-11-06');assert.equal(result.actions[1].owner,'t');assert.equal(result.actions[1].end,'2026-11-09');assert.ok(result.topics.includes('Discutir melhorias'));assert.ok(result.decisions.includes('validou'));
 context.text='Revisar apuração | Responsável: Marluza | Prazo: 06/11/2026';assert.equal(get("parseMeetingMinutes(text,users,'2026-11-03').actions[0].owner"),'m');
});
test('arquivos: codificações de texto, PDF em colunas e rejeição de DOCX inválido',()=>{
 context.utf8=new TextEncoder().encode('Reunião fiscal').buffer;assert.equal(get('decodeMeetingText(utf8)'),'Reunião fiscal');context.ansi=Uint8Array.from([82,101,117,110,105,227,111]).buffer;assert.equal(get('decodeMeetingText(ansi)'),'Reunião');context.bad=new Uint8Array(30).buffer;assert.throws(()=>get('validateMeetingDocx(bad)'),/DOCX/);
 context.items=[{str:'Responsável',transform:[1,0,0,1,300,700],width:70},{str:'Ação',transform:[1,0,0,1,40,700],width:30},{str:'Revisar',transform:[1,0,0,1,40,680],width:40}];assert.equal(get('meetingPdfPageText(items)'),'Ação | Responsável\nRevisar');
});
