// Relatórios locais no navegador. O servidor autoriza a rotina e entrega seu histórico completo.
let recordReportBusy=false;
function recordReportButtons(item){const group=groupById(item.groupId);return group?.printEnabled?`<div class="record-report-actions"><button type="button" class="secondary" data-record-export="pdf" data-report-item="${esc(item.id)}">PDF</button><button type="button" class="secondary" data-record-export="xlsx" data-report-item="${esc(item.id)}">Excel (.xlsx)</button></div>`:'';}
const recordReportTime=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Não registrado';
const recordReportValue=value=>value===undefined||value===null?'Não registrado':typeof value==='object'?JSON.stringify(value,null,2):typeof value==='boolean'?(value?'Sim':'Não'):String(value);
const recordReportFields={title:'Título',description:'Descrição',owner:'Responsável (identificador)',start:'Início previsto',end:'Prazo previsto',status:'Status',stageId:'Etapa (identificador)',groupId:'Grupo (identificador)',activities:'Atividades',delegations:'Ações delegadas',comments:'Comentários',executions:'Execuções',company:'Empresa',registry:'Junta / órgão',protocol:'Protocolo',frequency:'Frequência',priority:'Prioridade',group:'Nome do grupo',stage:'Nome da etapa',deletedAt:'Exclusão'};
function recordReportData(source){
 const r=JSON.parse(JSON.stringify(source)),item=r.item,history=r.history||[],name=id=>(r.users||[]).find(u=>u.id===id)?.name||id||'Não registrado';
 const baselines=history.filter(h=>h.kind==='baseline');
 const coverage=baselines.length?`Histórico detalhado a partir de ${recordReportTime(baselines[0].at)}. O estado anterior foi preservado. Movimentações antigas disponíveis são apresentadas separadamente; datas ou versões não gravadas no passado não podem ser recuperadas. Registros legados são associados ao título atual somente quando ele é único no departamento.`:'Histórico detalhado registrado desde a criação desta rotina.';
 const legacy=history.flatMap(h=>(h.legacyEvents||[]).map(e=>[recordReportTime(e.at),e.author,'Registro legado por título',e.action,'Sem versão anterior/posterior registrada','', '']));
 const changeValue=(c,h,index,side)=>{const value=c[side],snapshot=side==='after'?h.snapshot:history[index-1]?.snapshot;let label;if(c.field==='owner')label=snapshot?.data?.owner===value?snapshot.ownerName:name(value);if(c.field==='stageId')label=snapshot?.data?.stageId===value?snapshot.stage:null;if(c.field==='groupId')label=snapshot?.data?.groupId===value?snapshot.group:null;return recordReportValue(value)+(value&&label?' — '+label:'');};
 const audit=history.flatMap((h,index)=>h.kind==='baseline'?[[recordReportTime(h.at),h.actor,'Estado existente na ativação','Linha de base',coverage+'\n\nEstado integral preservado:\n'+recordReportValue(h.snapshot?.data),'',h.snapshot?.version||'']]:[(h.changes?.length?h.changes:[{field:'registro',before:null,after:h.snapshot?.data}])].flatMap(changes=>changes.map(c=>[recordReportTime(h.at),h.actor,h.kind==='created'?'Criação':h.kind==='group_configuration'?'Configuração do grupo / etapa':'Alteração',recordReportFields[c.field]||c.field,changeValue(c,h,index,'before'),changeValue(c,h,index,'after'),h.snapshot?.version||''])));
 const legacyStages=history.flatMap(h=>(h.legacyEvents||[]).filter(e=>/^Moveu registro para /i.test(e.action)).map(e=>[recordReportTime(e.at),e.author,'Registro legado por título',r.group,e.action.replace(/^Moveu registro para /i,''),'Não registrado no log antigo','Sem versão completa anterior/posterior.']));
 const stages=[...legacyStages,...history.filter(h=>h.kind==='baseline'||h.kind==='created'||(h.changes||[]).some(c=>['stageId','status','groupId','stage','group'].includes(c.field))).map(h=>[recordReportTime(h.at),h.actor,h.kind==='baseline'?'Estado existente na ativação':h.kind==='created'?'Criação':'Movimentação registrada',h.snapshot?.group||'Sem grupo',h.snapshot?.stage||'Sem etapa',h.snapshot?.data?.status||'',h.kind==='baseline'?'Não representa a data original de entrada nesta etapa.':''])];
 const activityDate=id=>{const entries=history.filter(h=>h.kind!=='baseline'&&(h.changes||[]).some(c=>c.field==='activities'&&JSON.stringify((c.before||[]).find(a=>a.id===id))!==JSON.stringify((c.after||[]).find(a=>a.id===id))));return entries.length?recordReportTime(entries.at(-1).at):'Não registrado no histórico antigo';};
 const activities=(item.activities||[]).map((a,n)=>[n+1,a.title,a.done?'Concluída':'Pendente',activityDate(a.id),a.id]);
 const delegations=(item.delegations||[]).map(d=>[d.title,name(d.assignee),d.due||'',d.done?'Concluída':'Pendente',recordReportTime(d.createdAt),name(d.createdBy),recordReportTime(d.completedAt),name(d.completedBy),d.result||'']);
 const notes=[...(item.comments||[]).map(n=>({type:'Comentário',note:n})),...(item.executions||[]).map(n=>({type:'Execução',note:n}))].sort((a,b)=>String(a.note.at).localeCompare(String(b.note.at))).map(({type,note:n})=>[type,recordReportTime(n.at),n.author||'',n.text||'',(n.attachments||[]).map(a=>a.name).join('\n')]);
 const files=new Map();
 function collectFiles(data,sourceLabel){for(const [kind,rows] of [['Comentário',data.comments||[]],['Execução',data.executions||[]],['Ação delegada',data.delegations||[]]])for(const row of rows)for(const file of row.attachments||[]){const key=file.id||file.path||file.name+'|'+file.size;if(!files.has(key))files.set(key,[file.name||'',file.type||'',file.size||0,kind,recordReportTime(row.at||row.createdAt),row.author||name(row.assignee),sourceLabel,file.id||'']);}}
 collectFiles(item,'Registro atual');for(const h of history)collectFiles(h.snapshot?.data||{},'Histórico preservado');
 const versions=[];
 function flatten(value,path,meta){if(value!==null&&typeof value==='object'&&Object.keys(value).length){for(const [key,child] of Object.entries(value))flatten(child,path?(Array.isArray(value)?path+'['+key+']':path+'.'+key):key,meta);}else versions.push([...meta,path,recordReportValue(value)]);}
 for(const h of history)flatten(h.snapshot,'',[String(h.id),recordReportTime(h.at),h.actor,h.kind]);
 const summary=[['Rotina',item.title],['Identificador',item.id],['Departamento',r.department],['Grupo',r.group],['Empresa',item.company||'Não informada'],['Junta / órgão',item.registry||'Não informado'],['Protocolo',item.protocol||'Não informado'],['Responsável',r.ownerName||name(item.owner)],['Prioridade',item.priority],['Frequência',item.frequency],['Status atual',item.status],['Etapa atual',r.stage||'Não informada'],['Início previsto',item.start],['Prazo previsto',item.end],['Criação',recordReportTime(item.createdAt)],['Última atualização',recordReportTime(item.updatedAt)],['Descrição',item.description||''],['Cobertura histórica',coverage],['Anexos','Os arquivos originais não são incorporados ao PDF ou à planilha. Seus nomes, tipos, tamanhos e referências são relacionados; os originais permanecem disponíveis no painel.'],['Emissão',recordReportTime(r.issuedAt)+' (horário de Brasília)']];
 const known=['id','version','title','description','owner','company','registry','protocol','priority','frequency','status','stageId','groupId','start','end','createdAt','updatedAt','activities','delegations','comments','executions'];
 for(const [key,value] of Object.entries(item))if(!known.includes(key))summary.push(['Outros dados · '+key,recordReportValue(value)]);
 const tables=[{name:'Resumo',headers:['Campo','Informação'],rows:summary},{name:'Etapas',headers:['Data e hora (Brasília)','Responsável','Origem','Grupo','Etapa','Status','Observação'],rows:stages},{name:'Atividades',headers:['Ordem','Atividade','Situação','Última alteração disponível','Identificador'],rows:activities},{name:'Ações delegadas',headers:['Ação','Responsável','Prazo','Situação','Criação','Criado por','Conclusão','Concluído por','Resultado'],rows:delegations},{name:'Acompanhamentos',headers:['Tipo','Data e hora (Brasília)','Autor','Texto integral','Anexos'],rows:notes},{name:'Anexos',headers:['Nome','Tipo','Tamanho (bytes)','Vínculo','Data do registro vinculado','Autor / responsável','Origem','Identificador'],rows:[...files.values()]},{name:'Histórico',headers:['Data e hora (Brasília)','Autor','Origem','Campo / ação','Antes / detalhe legado','Depois','Versão'],rows:[...legacy,...audit]},{name:'Versões completas',headers:['Registro','Data e hora (Brasília)','Autor','Origem','Campo da versão','Valor integral'],rows:versions}];
 return {title:item.title,itemId:item.id,issuedAt:r.issuedAt,coverage,tables};
}
function recordReportChunks(value,max=30000){const text=String(value??'');const chunks=[];let offset=0;do{let end=Math.min(offset+max,text.length);if(max<30000){let lines=0;for(let n=offset;n<end;n++)if(text[n]==='\n'&&++lines===12){end=n+1;break;}}if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;chunks.push(text.slice(offset,end));offset=end;}while(offset<text.length);return chunks;}
function buildRecordWorkbook(ExcelJS,report){
 const wb=new ExcelJS.Workbook();wb.creator='Grupo Cavalca';wb.created=new Date(report.issuedAt);
 for(const table of report.tables){
  let part=1,ws;
  const createSheet=()=>{ws=wb.addWorksheet(table.name+(part>1?' '+part:''),{views:[{state:'frozen',ySplit:4}]});ws.addRow(['GRUPO CAVALCA · RELATÓRIO DA ROTINA']);ws.addRow([report.title]);ws.addRow(['Emitido em '+recordReportTime(report.issuedAt)+' · Brasília']);ws.addRow(table.headers);ws.getRow(4).font={bold:true,color:{argb:'FF39373A'}};ws.getRow(4).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE7AE'}};ws.columns=table.headers.map((_,n)=>({width:table.name==='Resumo'?(n===0?28:100):Math.min(n===table.headers.length-1?85:35,table.headers.length>7?30:85)}));ws.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};ws.headerFooter.oddFooter='Grupo Cavalca | Página &P de &N';};
  createSheet();
  for(const values of table.rows){const chunks=values.map(v=>recordReportChunks(v,300)),count=Math.max(...chunks.map(c=>c.length));for(let n=0;n<count;n++){if(ws.rowCount>=1000000){part++;createSheet();}const cells=chunks.map(c=>c.length===1?c[0]:c[n]===undefined?'':`[Parte ${n+1}/${c.length}] ${c[n]}`);const row=ws.addRow(cells);row.height=Math.min(390,Math.max(28,...cells.map((v,c)=>(String(v).split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/(ws.getColumn(c+1).width||30))),0)*14+10))));row.eachCell({includeEmpty:true},cell=>{cell.numFmt='@';cell.font={name:'Calibri',size:11,color:{argb:'FF39373A'}};cell.alignment={vertical:'top',wrapText:true};});}}
  if(table.rows.length)ws.autoFilter={from:{row:4,column:1},to:{row:ws.rowCount,column:table.headers.length}};
 }
 return wb;
}
function buildRecordPdf(JsPDF,report){
 const doc=new JsPDF({unit:'mm',format:'a4',compress:true});doc.setProperties({title:report.title,author:'Grupo Cavalca',subject:'Relatório completo da rotina'});
 let y=30;
 const header=()=>{doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(57,55,58);doc.text('GRUPO CAVALCA · Relatório completo da rotina',14,13);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text('Emissão: '+recordReportTime(report.issuedAt)+' · Brasília',14,19);};
 header();
 for(const table of report.tables.filter(t=>t.name!=='Versões completas')){
  if(y>258){doc.addPage();header();y=30;}
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(57,55,58);doc.text(table.name,14,y);y+=4;
  const body=table.rows.length?table.rows.map(row=>table.headers.length===2?row:[row.slice(0,Math.min(3,row.length)).map((v,n)=>table.headers[n]+': '+String(v??'')).join('\n'),row.slice(Math.min(3,row.length)).map((v,n)=>table.headers[n+3]+': '+String(v??'')).join('\n')]):[['Sem registros','']];
  doc.autoTable({startY:y,head:[table.headers.length===2?table.headers:['Registro','Detalhes integrais']],body,theme:'grid',styles:{font:'helvetica',fontSize:8,cellPadding:2,overflow:'linebreak',valign:'top'},headStyles:{fillColor:[247,174,20],textColor:[57,55,58],fontStyle:'bold'},columnStyles:{0:{cellWidth:table.name==='Resumo'?44:62},1:{cellWidth:table.name==='Resumo'?138:120}},margin:{top:27,right:14,bottom:17,left:14},didDrawPage:header});
  y=doc.lastAutoTable.finalY+10;
 }
 const pages=doc.getNumberOfPages();for(let n=1;n<=pages;n++){doc.setPage(n);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,100,100);doc.text('Grupo Cavalca · Dados restritos ao departamento',14,289);doc.text(`Página ${n} de ${pages}`,196,289,{align:'right'});}
 return doc;
}
async function exportRecordReport(id,format){
 if(recordReportBusy)return;recordReportBusy=true;const buttons=[...document.querySelectorAll('[data-record-export]')];buttons.forEach(b=>b.disabled=true);
 try{
  const report=recordReportData(await api('record-report/'+id));const filename='rotina-'+report.itemId+'-'+new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(report.issuedAt))+'.'+format;
  if(format==='xlsx'){await companyReportLibrary('excel');const wb=buildRecordWorkbook(window.ExcelJS,report);downloadCompanyReport(await wb.xlsx.writeBuffer(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename);}
  else if(format==='pdf'){await companyReportLibrary('pdf');await companyReportLibrary('table');downloadCompanyReport(buildRecordPdf(window.jspdf.jsPDF,report).output('arraybuffer'),'application/pdf',filename);}
  else throw Error('Formato inválido.');
  toast('Relatório completo gerado. Confira os downloads.');
 }catch(error){toast(error.message||'Não foi possível gerar o relatório.');}
 finally{recordReportBusy=false;buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});}
}
function bindRecordReports(scope=document){scope.querySelectorAll('[data-record-export]').forEach(button=>button.onclick=()=>exportRecordReport(button.dataset.reportItem,button.dataset.recordExport));}
