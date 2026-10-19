import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('ordenação dos grupos: movimentos, registros novos, filtros e controles para membros',async()=>{
 const context=vm.createContext({state:{user:{id:'member',role:'member'},users:[],groups:[{id:'g',recordOrder:['b','a','deleted'],stages:[]}],items:[{id:'a',groupId:'g',stageId:'s',title:'Registro A'},{id:'b',groupId:'g',stageId:'s',title:'Registro B'},{id:'new',groupId:'g',stageId:'s',title:'Novo'},{id:'other',groupId:'h'}]},esc:String});
 vm.runInContext(await readFile('public/groups.js','utf8'),context);const get=s=>vm.runInContext(s,context);
 assert.equal(JSON.stringify(get("groupRecords(groupById('g')).map(i=>i.id)")),JSON.stringify(['b','a','new']));
 assert.equal(JSON.stringify(get("orderedMove(['a','hidden','b','c'],'a','b',true)")),JSON.stringify(['hidden','b','a','c']));
 assert.equal(JSON.stringify(get("orderedMove(['a','b','c'],'c','a')")),JSON.stringify(['c','a','b']));
 assert.equal(JSON.stringify(get("orderedMove(['a','b'],'a','a')")),JSON.stringify(['a','b']));
 assert.ok(get("recordOrderControls(groupById('g'),state.items[0])").includes('data-record-up="a"'));
 assert.ok(get("activityOrderControls({groupId:'g',activities:[{id:'1'}]},{id:'1',title:'Editar <campo>'})").includes('data-edit-activity="1"'));
 assert.equal(get("activityOrderControls({activities:[]},{id:'1'})"),'');
});
