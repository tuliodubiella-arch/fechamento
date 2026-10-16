import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('relatórios: filtros compartilhados, snapshot, texto do CNPJ e lista vazia',async()=>{
 const rows=[{id:'1',name:'Água & Cia',cnpj:'00000000E08G12',city:'Cuiabá',uf:'MT',taxRegime:'Lucro Real',additionalInfo:'Linha 1\nLinha 2'},{id:'2',name:'Empresa B',cnpj:'11222333000181',city:'Goiânia',uf:'GO',taxRegime:'Simples Nacional',additionalInfo:'=1+1'}];
 const ctx=vm.createContext({state:{user:{id:'member',role:'member'},companies:rows},esc:v=>String(v??''),Date,Intl});
 vm.runInContext(await readFile('public/company-reports.js','utf8'),ctx);vm.runInContext(await readFile('public/registries.js','utf8'),ctx);
 const run=s=>vm.runInContext(s,ctx);assert.equal(run('filteredCompanyRows().length'),2);
 run("companyRegime='Lucro Real'");assert.equal(run('filteredCompanyRows().length'),1);run("companySearch='Goiânia'");assert.equal(run('filteredCompanyRows().length'),0);assert.ok(run('companyReportToolbar(filteredCompanyRows())').includes('disabled'));
 run("companyRegime='';companySearch='Água'");assert.equal(run('filteredCompanyRows()[0].name'),'Água & Cia');
 run("var snapshot=companyReportData(filteredCompanyRows(),{search:companySearch,regime:companyRegime},new Date('2026-10-16T13:30:00Z'))");assert.equal(run('snapshot.rows[0][1]'),'00.000.000/E08G-12');assert.equal(run('snapshot.rows[0][5]'),'Linha 1\nLinha 2');assert.ok(run('snapshot.filters').includes('Água'));
 run("state.companies[0].name='Alterada depois'");assert.equal(run('snapshot.rows[0][0]'),'Água & Cia');
 assert.equal(run("companyReportFilename('xlsx',snapshot.at)"),'empresas-grupo-cavalca-20261016103000.xlsx');
 assert.equal(run('companyReportData([]).rows.length'),0);assert.ok(run('companyReportToolbar([{id:1}])').includes('Baixar Excel (.xlsx)'));
});
