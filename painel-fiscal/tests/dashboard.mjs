import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('dashboard: totais por grupo, pendências sem duplicidade e privacidade',async()=>{
 const groups=[{id:'g1',title:'REGISTROS DE ALTERAÇÕES',stages:[{id:'s1',name:'Preparação',status:'Planejada'},{id:'s2',name:'Protocolo',status:'Em andamento'},{id:'s3',name:'Concluído',status:'Concluída'}]},{id:'g2',title:'APURAÇÃO DE IMPOSTOS',stages:[]}];
 const base={owner:'u1',type:'routine',start:'2026-10-01',end:'2026-10-16',title:'Registro',activities:[],delegations:[],comments:[],executions:[]};
 const rows=[{...base,id:'1',groupId:'g1',stageId:'s1',status:'Planejada',end:'2026-10-14'},{...base,id:'2',groupId:'g1',stageId:'s2',status:'Em andamento',activities:[{title:'Revisar',done:false},{title:'Preparar',done:true}],delegations:[{title:'Validar',assignee:'u1',due:'2026-10-16',done:false}]},{...base,id:'3',groupId:'g1',stageId:'s3',status:'Concluída',end:'2026-10-10'},{...base,id:'4',groupId:'g2',status:'Bloqueada'},{...base,id:'5',status:'Em andamento'},{...base,id:'6',type:'project',status:'Em andamento'}];
 const ctx=vm.createContext({state:{items:rows,groups,personalItems:[{...base,title:'SEGREDO PRIVADO',status:'Planejada'}],events:[]},overdue:i=>i.end<'2026-10-15'&&i.status!=='Concluída',allGroups:()=>groups,groupById:id=>groups.find(g=>g.id===id),owner:()=> 'Pessoa',userName:()=> 'Pessoa',esc:v=>String(v??'').replaceAll('<','&lt;'),statusClass:s=>({'Planejada':'planned','Em andamento':'running','Bloqueada':'blocked','Concluída':'done'})[s],date:d=>d,heading:()=>'',createButton:()=>'',events:()=>'',table:()=>'',empty:()=>'<p>Vazio</p>'});
 vm.runInContext(await readFile('public/dashboard.js','utf8'),ctx);
 const get=expr=>vm.runInContext(expr,ctx);
 let m=get('routineMetrics(dashboardScope())');assert.equal(m.total,5);assert.equal(m.done,1);assert.equal(m.open,4);assert.equal(m.running,2);assert.equal(m.late,1);assert.equal(m.checksDone,1);assert.equal(m.actions,1);
 get("dashboardGroup='g1'");m=get('routineMetrics(dashboardScope())');assert.equal(m.total,3);assert.equal(m.pct,33);assert.equal(m.open,2);
 assert.ok(get('overviewDashboard()').includes('<h3>REGISTROS DE ALTERAÇÕES</h3>'));assert.ok(!get('overviewDashboard()').includes('<h3>APURAÇÃO DE IMPOSTOS</h3>'));assert.ok(!get('overviewDashboard()').includes('SEGREDO PRIVADO'));
 get("dashboardGroup='ungrouped'");assert.equal(get('dashboardScope().length'),1);
 get("dashboardGroup='removed'");get('overviewDashboard()');assert.equal(get('dashboardGroup'),'all');
 const bar=get('dashboardStatusBar([])');assert.ok(!bar.includes('NaN'));assert.ok(!bar.includes('style='));
 assert.ok(get("dashboardActivities(dashboardScope())").includes('Revisar'));assert.ok(!get('dashboardActivities(dashboardScope())').includes('<b>Preparar</b>'));
});
