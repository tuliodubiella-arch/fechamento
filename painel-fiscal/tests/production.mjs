import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('produção protege criação do primeiro administrador',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'fiscal-production-'));
 const token='codigo-ficticio-de-teste-com-32-caracteres';
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,NODE_ENV:'production',COOKIE_SECURE:'true',SETUP_TOKEN:token,PORT:'4189',DATA_DIR:data}});
 try{
 for(let n=0;n<50;n++){try{if((await fetch('http://localhost:4189/api/setup')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal((await (await fetch('http://localhost:4189/api/setup')).json()).protected,true);
 const setup=async setupToken=>fetch('http://localhost:4189/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Admin Teste',email:'admin@example.test',password:'Teste-local-123',setupToken})});
 assert.equal((await setup(undefined)).status,403);assert.equal((await setup('incorreto')).status,403);assert.equal((await setup(token)).status,201);
 const login=await fetch('http://localhost:4189/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.test',password:'Teste-local-123'})});assert.equal(login.status,200);assert.ok(login.headers.get('set-cookie').includes('; Secure'));
 }finally{child.kill();}
});
