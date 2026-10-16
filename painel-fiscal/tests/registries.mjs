import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('cadastros: CNPJ numérico e alfanumérico, filtro e conteúdo protegido',async()=>{
 const ctx=vm.createContext({state:{user:{id:'m',role:'member'},companies:[{id:'c1',name:'Empresa <A>',cnpj:'11222333000181',city:'Cuiabá',uf:'MT',taxRegime:'Lucro Real',additionalInfo:'Observação'}],suggestions:[{id:'s1',title:'Melhoria <A>',description:'Descrição',benefit:'Benefício',area:'Fiscal',owner:'m',status:'Nova',comments:[],createdAt:'2026-10-16T12:00:00Z'}]},esc:v=>String(v??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),heading:(a,b,c,d)=>d||'',empty:(a,b)=>a+b,options:(v,c)=>v.join(','),userName:()=> 'Pessoa',initials:()=> 'P'});
 vm.runInContext(await readFile('public/company-reports.js','utf8'),ctx);
 vm.runInContext(await readFile('public/registries.js','utf8'),ctx);const get=s=>vm.runInContext(s,ctx);
 for(const value of ['11222333000181','11.222.333/0001-81','00.000.000/E08G-12','00000000e08g12'])assert.equal(get(`validCnpj('${value}')`),true,value);
 for(const value of ['00000000000000','11222333000182','1122233300018','<11222333000181>','AAAAAAAAAAAA00'])assert.equal(get(`validCnpj('${value}')`),false,value);
 assert.ok(!get('companiesContent()').includes('data-company-new'));assert.ok(get('companiesContent()').includes('Empresa &lt;A&gt;'));assert.ok(get('suggestionsContent()').includes('Melhoria &lt;A&gt;'));
 get("companyRegime='Simples Nacional'");assert.ok(!get('companiesContent()').includes('data-company-open='));get("companyRegime='';companySearch='Cuiabá'");assert.ok(get('companiesContent()').includes('data-company-open='));
 get("state.user.role='admin'");assert.ok(get('companiesContent()').includes('data-company-new'));
});
