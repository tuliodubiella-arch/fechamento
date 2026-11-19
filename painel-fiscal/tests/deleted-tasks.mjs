import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile('public/deleted-tasks.js','utf8');
function fixture(){const buttons={},calls=[];const ctx=vm.createContext({Date,Number,confirm:()=>true,state:{user:{id:'admin',role:'admin'},platformContext:{department:{id:'fiscal'}}},page:'deleted',esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),time:s=>s,heading:(a,b,c)=>[a,b,c].join(' '),empty:(a,b)=>a+' '+b,document:{querySelectorAll:()=>Object.values(buttons)},$:()=>null,render:()=>{},load:async()=>{},toast:s=>calls.push(s),api:async(route,method,data)=>{calls.push({route,method,data});return [];}});vm.runInContext(source,ctx);return {ctx,buttons,calls};}
test('tarefas excluídas: conteúdo seguro, pesquisa e restauração da versão selecionada',async()=>{
 const {ctx,buttons,calls}=fixture();ctx.rows=[{id:'a',source:'shared',title:'Compensação <teste>',version:9,type:'routine',ownerName:'Pessoa',deletedAt:'2026-11-19',activities:4,comments:3,executions:0}];vm.runInContext('deletedTasks=rows;deletedTasksAt=Date.now();',ctx);
 const html=vm.runInContext('deletedTasksContent()',ctx);assert.ok(html.includes('Compensação &lt;teste>'));assert.ok(html.includes('Restaurar tarefa'));assert.ok(html.includes('administrador')||html.includes('recuperar as rotinas'));
 vm.runInContext("deletedTasksQuery='ausente'",ctx);assert.ok(vm.runInContext('deletedTasksContent()',ctx).includes('Nenhuma tarefa excluída'));
 const button={dataset:{taskRestore:'a',source:'shared'},disabled:false};buttons.a=button;vm.runInContext('bindDeletedTasks()',ctx);await button.onclick();
 assert.deepEqual(calls.filter(c=>typeof c==='object').map(c=>({...c,data:{...c.data}})),[{route:'restore-task',method:'POST',data:{id:'a',source:'shared',version:9}}]);assert.equal(vm.runInContext('deletedTasks.length',ctx),0);
});
test('tarefas excluídas: resposta de sessão antiga é descartada',async()=>{
 const {ctx}=fixture();let done;ctx.api=()=>new Promise(resolve=>{done=resolve;});const pending=vm.runInContext('refreshDeletedTasks()',ctx);ctx.state={user:{id:'outro'},platformContext:{department:{id:'outro-departamento'}}};done([{id:'privado-antigo'}]);await pending;assert.equal(vm.runInContext('deletedTasks',ctx),null);
 ctx.state.user.role='member';assert.ok(vm.runInContext('deletedTasksContent()',ctx).includes('apenas as suas atividades pessoais'));
});
