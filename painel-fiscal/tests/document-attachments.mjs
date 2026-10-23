import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('anexos: documentos têm download, imagens têm prévia e nomes são escapados',async()=>{
 const ctx=vm.createContext({window:{FiscalCloud:{}},URL,modal:{addEventListener(){}},esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
 vm.runInContext(await readFile('public/attachments.js','utf8'),ctx);const get=s=>vm.runInContext(s,ctx);
 const url='https://example.supabase.co/storage/v1/object/sign/fiscal-prints/member/a.pdf?token=abc';
 ctx.files=[{id:'p',name:'Relatório <fiscal>.pdf',type:'application/pdf',size:1024,url},{id:'i',name:'print.png',type:'image/png',size:512,url:'https://example.supabase.co/image.png?token=abc'}];
 const html=get('attachmentsView(files)');assert.equal((html.match(/<img /g)||[]).length,1);assert.ok(html.includes('Relatório &lt;fiscal>.pdf'));assert.ok(html.includes('Baixar arquivo'));assert.ok(html.includes('download='));
 assert.equal(new URL(get('attachmentDownloadURL(files[0])')).searchParams.get('download'),'Relatório <fiscal>.pdf');assert.ok(get('attachmentField()').includes('.xls,.xlsx,.doc,.docx,.pdf'));
 get('window.FiscalCloud=null');assert.equal(get('attachmentDownloadURL(files[0])'),'/api/attachments/p?download=1');
});
