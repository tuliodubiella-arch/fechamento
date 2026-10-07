const attachmentDrafts=new WeakMap();
function attachmentField(){return `<div class="attachment-field"><label>Anexar prints (opcional)<input class="print-input" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><p>Selecione imagens ou cole um print com Ctrl+V neste formulário. Até 3 imagens, com 5 MB cada.</p><div class="print-previews" aria-live="polite"></div></div>`;}
function attachmentsView(images){return images?.length?`<div class="saved-prints">${images.map(a=>`<a href="${esc(printURL(a))}" target="_blank" rel="noopener" title="Abrir print em tamanho original"><img src="${esc(printURL(a))}" alt="${esc(a.name)}" loading="lazy"><span>${esc(a.name)}</span></a>`).join('')}</div>`:'';}
function releasePrints(){modal.querySelectorAll('form').forEach(form=>{const draft=attachmentDrafts.get(form);draft?.files.forEach(f=>URL.revokeObjectURL(f.url));});}
function bindPrints(){modal.querySelectorAll('form:has(.print-input)').forEach(form=>{
 const draft={files:[],pending:0};attachmentDrafts.set(form,draft);
 const draw=()=>{form.querySelector('.print-previews').innerHTML=draft.files.map((f,index)=>`<div><img src="${f.url}" alt="${esc(f.name)}"><span>${esc(f.name)}</span><button type="button" data-remove-print="${index}" aria-label="Remover ${esc(f.name)}">×</button></div>`).join('');form.querySelectorAll('[data-remove-print]').forEach(button=>button.onclick=()=>{const [f]=draft.files.splice(Number(button.dataset.removePrint),1);URL.revokeObjectURL(f.url);draw();});};
 const add=async files=>{for(const file of files){if(draft.files.length+draft.pending>=3){toast('Anexe até 3 prints por registro.');break;}if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('Use imagens PNG, JPG ou WebP.');continue;}if(file.size>5*1024*1024){toast('Cada print deve ter no máximo 5 MB.');continue;}draft.pending++;try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(Error('Não foi possível ler o print.'));r.readAsDataURL(file);});if(form.isConnected){draft.files.push({name:file.name||'Print.png',type:file.type,data,url:URL.createObjectURL(file)});draw();}}catch(e){toast(e.message);}finally{draft.pending--;}}};
 form.querySelector('.print-input').onchange=e=>{add([...e.target.files]);e.target.value='';};
 form.addEventListener('paste',e=>{const files=[...(e.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();add(files);}});
 });}
function printPayload(form){const draft=attachmentDrafts.get(form);if(draft?.pending)throw Error('Aguarde a leitura dos prints antes de salvar.');return (draft?.files||[]).map(({name,type,data})=>({name,type,data}));}
modal.addEventListener('close',releasePrints);

function printURL(image){if(window.FiscalCloud)return image.url||'';return '/api/attachments/'+encodeURIComponent(image.id);}
