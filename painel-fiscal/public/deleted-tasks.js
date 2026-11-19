let deletedTasks=null,deletedTasksLoading=false,deletedTasksError='',deletedTasksAt=0,deletedTasksQuery='';
function resetDeletedTasks(){deletedTasks=null;deletedTasksError='';deletedTasksAt=0;deletedTasksQuery='';}
function deletedTasksContent(){
 const rows=(deletedTasks||[]).filter(i=>`${i.title} ${i.ownerName||''} ${i.groupName||''}`.toLocaleLowerCase('pt-BR').includes(deletedTasksQuery.toLocaleLowerCase('pt-BR')));
 return heading('RECUPERAÇÃO DE REGISTROS','Tarefas excluídas','Recupere uma tarefa excluída por acidente e continue de onde parou.','<button type="button" class="secondary" data-deleted-refresh>Atualizar lista</button>')+`<section class="panel deleted-notice"><b>O conteúdo da tarefa é preservado</b><p>A restauração devolve a tarefa ao painel com suas atividades, comentários, execuções, anexos, datas e responsáveis. ${state.user.role==='admin'?'Você pode recuperar as rotinas e projetos da equipe deste departamento e suas próprias atividades pessoais.':'Aqui aparecem apenas as suas atividades pessoais. Para recuperar uma tarefa da equipe, solicite ao administrador do departamento.'}</p></section><div class="toolbar"><div class="search"><span>⌕</span><input id="deleted-search" aria-label="Buscar tarefas excluídas" placeholder="Buscar tarefa, responsável ou grupo" value="${esc(deletedTasksQuery)}"></div><span class="muted">${rows.length} registro(s)</span></div>${deletedTasksError?`<p class="error" role="alert">${esc(deletedTasksError)}</p>`:''}${deletedTasks===null?'<p class="muted" role="status">Carregando tarefas excluídas…</p>':`<div class="deleted-list">${rows.map(i=>`<article class="panel deleted-task"><div><span class="eyebrow">${i.source==='personal'?'MEU PAINEL · PRIVADA':i.type==='project'?'PROJETO':i.groupName?'REGISTRO DO GRUPO':'ROTINA'}</span><h2>${esc(i.title)}</h2><p>${esc(i.groupName||'')}${i.groupName?' · ':''}${esc(i.ownerName||'Sem responsável')}</p><small>Excluída em ${time(i.deletedAt)}${i.deletedBy?' por '+esc(i.deletedBy):''} · Status: ${esc(i.status||'Não informado')}</small><p>${Number(i.activities)||0} atividades${i.source==='shared'?` · ${Number(i.comments)||0} comentários · ${Number(i.executions)||0} execuções`:''}</p>${i.groupUnavailable?'<p class="error">O grupo também foi excluído e precisa ser recuperado antes desta tarefa.</p>':''}</div><button type="button" class="primary" data-task-restore="${esc(i.id)}" data-source="${i.source}" ${i.groupUnavailable?'disabled':''}>Restaurar tarefa</button></article>`).join('')||empty('Nenhuma tarefa excluída','As tarefas recuperáveis aparecerão aqui após a exclusão.')}</div>`}`;
}
async function refreshDeletedTasks(){
 if(deletedTasksLoading)return;const account=state?.user?.id,department=state?.platformContext?.department?.id;deletedTasksLoading=true;deletedTasksAt=Date.now();
 try{const rows=await api('deleted-tasks');if(state?.user?.id!==account||state?.platformContext?.department?.id!==department)return;deletedTasks=rows;deletedTasksError='';}
 catch(error){if(state?.user?.id===account)deletedTasksError=error.message;}
 finally{deletedTasksLoading=false;if(state&&page==='deleted')render();}
}
function bindDeletedTasks(){
 if(page!=='deleted')return;
 if(!deletedTasksLoading&&Date.now()-deletedTasksAt>9000)refreshDeletedTasks();
 $('[data-deleted-refresh]')?.addEventListener('click',()=>refreshDeletedTasks());
 $('#deleted-search')?.addEventListener('input',e=>{deletedTasksQuery=e.target.value;const p=e.target.selectionStart;render();$('#deleted-search').focus();$('#deleted-search').setSelectionRange(p,p);});
 document.querySelectorAll('[data-task-restore]').forEach(button=>button.onclick=async()=>{
  const item=(deletedTasks||[]).find(i=>i.id===button.dataset.taskRestore&&i.source===button.dataset.source);if(!item)return;
  if(!confirm('Restaurar “'+item.title+'” ao painel ativo, com todos os dados preservados?'))return;button.disabled=true;
  try{await api('restore-task','POST',{id:item.id,source:item.source,version:item.version});deletedTasks=deletedTasks.filter(i=>i!==item);await load();render();toast('Tarefa restaurada. Ela já está disponível no painel ativo.');}
  catch(error){toast(error.message);await refreshDeletedTasks();if(button.isConnected)button.disabled=false;}
 });
}
