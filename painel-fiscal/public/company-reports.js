// Geração no navegador: os dados das empresas não são enviados a serviços de conversão.
const companyReportLibraries={
 excel:{url:'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',integrity:'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz'},
 pdf:{url:'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',integrity:'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3'},
 table:{url:'https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.8/dist/jspdf.plugin.autotable.min.js',integrity:'sha384-5jk55M0XWoAw7LyhlXJe19ErOr3doBAPzxw9vahPFbvolqWa2yDk4fhHa2zuYeOa'}
};
const companyReportLoads=new Map();
let companyReportBusy=false;
function companyReportLibrary(key){
 if(companyReportLoads.has(key))return companyReportLoads.get(key);
 const lib=companyReportLibraries[key];
 const job=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=lib.url;script.integrity=lib.integrity;script.crossOrigin='anonymous';script.referrerPolicy='no-referrer';let timer;const fail=()=>{clearTimeout(timer);script.remove();companyReportLoads.delete(key);reject(Error('Não foi possível carregar o gerador do relatório. Confira a conexão e tente novamente.'));};script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=fail;timer=setTimeout(fail,45000);document.head.appendChild(script);});
 companyReportLoads.set(key,job);return job;
}
function companyReportToolbar(rows){return `<div class="company-report-bar"><div><b>Relatórios das empresas</b><p>${rows.length} empresa${rows.length===1?'':'s'} na lista · Os arquivos respeitam a busca e o regime selecionados.</p></div><div class="company-report-actions"><button class="secondary" data-company-export="pdf" ${!rows.length||companyReportBusy?'disabled':''}>Baixar PDF</button><button class="secondary" data-company-export="xlsx" ${!rows.length||companyReportBusy?'disabled':''}>Baixar Excel (.xlsx)</button></div></div>`;}
function companyReportData(rows,filters={},at=new Date()){
 return {title:'Empresas do Grupo Cavalca',at,issued:at.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),filters:`Busca: ${filters.search?.trim()||'Todas as empresas'} · Regime: ${filters.regime||'Todos os regimes'}`,headers:['Nome da empresa','CNPJ','Cidade','UF','Regime tributário','Informações adicionais'],rows:rows.map(c=>[String(c.name||''),formatCnpj(c.cnpj),String(c.city||''),String(c.uf||''),String(c.taxRegime||''),String(c.additionalInfo||'')])};
}
function companyReportFilename(format,at){const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(at).replace(/[^0-9]/g,'');return `empresas-grupo-cavalca-${stamp}.${format}`;}
function buildCompanyWorkbook(ExcelJS,report){
 const wb=new ExcelJS.Workbook();wb.creator='Grupo Cavalca · Fiscal';wb.created=report.at;wb.modified=report.at;
 const ws=wb.addWorksheet('Empresas do Grupo',{views:[{state:'frozen',ySplit:6,showGridLines:false}],pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:6',margins:{left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.2,footer:0.2}}});
 ws.columns=[{width:36},{width:24},{width:24},{width:10},{width:24},{width:65}];
 for(const row of [1,2,3,4])ws.mergeCells(row,1,row,6);
 ws.getCell('A1').value=report.title;ws.getCell('A1').font={name:'Calibri',size:20,bold:true,color:{argb:'FF39373A'}};ws.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF7AE14'}};ws.getRow(1).height=38;
 ws.getCell('A2').value=`Emitido em ${report.issued} (horário de Brasília)`;ws.getCell('A3').value=report.filters;ws.getCell('A4').value=`Total de empresas: ${report.rows.length}`;
 ws.getCell('A3').alignment={wrapText:true,vertical:'top'};ws.getRow(3).height=Math.min(180,15*Math.ceil(report.filters.length/125));
 for(const row of [2,3,4])ws.getCell(`A${row}`).font={name:'Calibri',size:11,color:{argb:'FF504F53'}};
 const heading=ws.getRow(6);heading.values=report.headers;heading.height=30;heading.eachCell(cell=>{cell.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF39373A'}};cell.alignment={vertical:'middle',wrapText:true};});
 report.rows.forEach(values=>{const row=ws.addRow(values);row.height=Math.min(360,Math.max(32,15*Math.max(...values.map((v,n)=>String(v).split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/[34,24,24,10,24,65][n])),0)))));row.eachCell({includeEmpty:true},cell=>{cell.font={name:'Calibri',size:11,color:{argb:'FF39373A'}};cell.numFmt='@';cell.alignment={vertical:'top',wrapText:true};if(row.number%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF7F7F7'}};cell.border={bottom:{style:'hair',color:{argb:'FFE3E5E6'}}};});});
 ws.autoFilter={from:{row:6,column:1},to:{row:Math.max(6,ws.rowCount),column:6}};ws.pageSetup.printArea=`A1:F${ws.rowCount}`;ws.headerFooter.oddFooter='Grupo Cavalca · Fiscal | Página &P de &N';
 return wb;
}
function buildCompanyPdf(JsPDF,report,logo){
 const doc=new JsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});doc.setProperties({title:report.title,subject:'Cadastro de empresas do Grupo Cavalca',author:'Grupo Cavalca · Fiscal',creator:'Painel Fiscal'});
 const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight();
 doc.setFont('helvetica','normal');doc.setFontSize(8);const filterLines=doc.splitTextToSize(report.filters,width-28);const start=39+filterLines.length*4;
 doc.autoTable({startY:start,margin:{left:14,right:14,top:18,bottom:16},head:[report.headers],body:report.rows,showHead:'everyPage',theme:'striped',rowPageBreak:'avoid',styles:{font:'helvetica',fontSize:8,cellPadding:2.3,overflow:'linebreak',valign:'top',textColor:[57,55,58],lineColor:[227,229,230],lineWidth:0.1},headStyles:{fillColor:[57,55,58],textColor:[255,255,255],fontStyle:'bold'},alternateRowStyles:{fillColor:[248,248,248]},columnStyles:{0:{cellWidth:51},1:{cellWidth:33},2:{cellWidth:33},3:{cellWidth:12},4:{cellWidth:35},5:{cellWidth:105}},didDrawPage:hook=>{
  doc.setDrawColor(247,174,20);doc.setLineWidth(1.2);doc.line(14,10,width-14,10);
  doc.setFont('helvetica','bold');doc.setFontSize(hook.pageNumber===1?16:9);doc.setTextColor(57,55,58);doc.text(report.title,14,hook.pageNumber===1?21:16);
  if(hook.pageNumber===1){doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(90,87,93);doc.text(`Emitido em ${report.issued} (Brasília) · ${report.rows.length} empresa${report.rows.length===1?'':'s'}`,14,28);doc.text(filterLines,14,34);if(logo?.complete&&logo.naturalWidth){try{doc.addImage(logo,'PNG',width-51,14,37,14);}catch{}}}
 }});
 const count=doc.getNumberOfPages();for(let n=1;n<=count;n++){doc.setPage(n);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(110,106,113);doc.text('Grupo Cavalca · Fiscal',14,height-8);doc.text(`Página ${n} de ${count}`,width-14,height-8,{align:'right'});}
 return doc;
}
function downloadCompanyReport(bytes,type,filename){const url=URL.createObjectURL(new Blob([bytes],{type}));const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function exportCompanyReport(format){
 if(companyReportBusy)return;const rows=filteredCompanyRows();if(!rows.length)return toast('Nenhuma empresa nesta lista para exportar.');
 // Snapshot: mudanças de filtros e atualizações automáticas não alteram um relatório em geração.
 const report=companyReportData(rows,{search:companySearch,regime:companyRegime});companyReportBusy=true;document.querySelectorAll('[data-company-export]').forEach(b=>b.disabled=true);toast('Preparando relatório…');
 try{
  if(format==='xlsx'){await companyReportLibrary('excel');if(!window.ExcelJS)throw Error('Gerador de Excel indisponível. Tente novamente.');const wb=buildCompanyWorkbook(window.ExcelJS,report);downloadCompanyReport(await wb.xlsx.writeBuffer(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',companyReportFilename('xlsx',report.at));}
  else if(format==='pdf'){await companyReportLibrary('pdf');await companyReportLibrary('table');if(!window.jspdf?.jsPDF)throw Error('Gerador de PDF indisponível. Tente novamente.');const doc=buildCompanyPdf(window.jspdf.jsPDF,report,document.querySelector('.brand img'));downloadCompanyReport(doc.output('arraybuffer'),'application/pdf',companyReportFilename('pdf',report.at));}
  else throw Error('Formato de relatório inválido.');
  toast('Relatório gerado. Confira os downloads do navegador.');
 }catch(e){toast(e.message||'Não foi possível gerar o relatório. Tente novamente.');}
 finally{companyReportBusy=false;document.querySelectorAll('[data-company-export]').forEach(b=>b.disabled=!filteredCompanyRows().length);}
}
function bindCompanyReports(){document.querySelectorAll('[data-company-export]').forEach(b=>b.onclick=()=>exportCompanyReport(b.dataset.companyExport));}
