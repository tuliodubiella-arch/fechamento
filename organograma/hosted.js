const ORG_SUPABASE_URL = 'https://jbnqgchofaprjjwbuzpe.supabase.co';
const ORG_SUPABASE_KEY = 'sb_publishable_jjy5twY8P1oroKyMgF5A_g_loODauqr';
const orgClient = window.supabase.createClient(ORG_SUPABASE_URL, ORG_SUPABASE_KEY);
let orgCurrentUserId = null;
let orgCurrentMember = null;
let orgMembers = [];
let orgUploadedManuals = [];

const accessGate = document.getElementById('accessGate');
const protectedApp = document.getElementById('protectedApp');
const authError = document.getElementById('orgAuthError');

function showAuthMessage(message) {
  authError.textContent = message || '';
}

function showLogin() {
  protectedApp.hidden = true;
  accessGate.hidden = false;
  document.getElementById('orgLogin').hidden = false;
  document.getElementById('orgForgot').hidden = false;
}

async function openProtectedOrganogram(session) {
  if (!session) {
    orgCurrentUserId = null;
    showLogin();
    return;
  }
  showAuthMessage('Validando acesso…');
  const { data: member, error: memberError } = await orgClient.from('fc_members').select('id,name,active,is_admin').eq('id', session.user.id).maybeSingle();
  if (memberError || !member?.active || !member.is_admin) {
    orgCurrentUserId = null;
    orgCurrentMember = null;
    showLogin();
    document.getElementById('orgSetup').hidden = true;
    showAuthMessage(member?.active && !member.is_admin
      ? 'O organograma é exclusivo dos administradores do painel de fechamento.'
      : 'Acesso pendente. Peça ao administrador para liberar seu cadastro no painel de fechamento.');
    return;
  }
  orgCurrentUserId = session.user.id;
  orgCurrentMember = member;
  document.getElementById('orgSyncTools').hidden = false;
  document.getElementById('membersTab').hidden = false;
  document.getElementById('orgManualUploadBtn').hidden = false;
  const { data: workspace, error: workspaceError } = await orgClient.from('org_workspace').select('payload').eq('id', 'main').maybeSingle();
  if (workspaceError) {
    showAuthMessage('Não foi possível carregar as rotinas protegidas. Tente novamente.');
    return;
  }
  if (!workspace) {
    document.getElementById('orgLogin').hidden = true;
    document.getElementById('orgForgot').hidden = true;
    document.getElementById('orgSetup').hidden = false;
    showAuthMessage('Aguardando a carga inicial do organograma.');
    return;
  }
  buildFromState(workspace.payload);
  try { await loadOrgManuals(); } catch (error) { console.error('Falha ao carregar manuais enviados:', error); orgUploadedManuals = []; }
  document.getElementById('orgMember').textContent = member.name || session.user.email || '';
  accessGate.hidden = true;
  protectedApp.hidden = false;
  renderAll();
  applyOrgAccessMode();
}

function applyOrgAccessMode() {
  const readOnly = !orgCurrentMember?.is_admin;
  protectedApp.classList.toggle('org-readonly', readOnly);
  protectedApp.querySelectorAll('#sections [contenteditable],#detailsContainer [contenteditable]').forEach(element => element.contentEditable = readOnly ? 'false' : 'true');
  protectedApp.querySelectorAll('#sections input,#detailsContainer textarea').forEach(element => element.disabled = readOnly);
  protectedApp.querySelectorAll('[draggable="true"]').forEach(element => { if (readOnly) element.draggable = false; });
  document.getElementById('saveStatus').textContent = readOnly ? 'Perfil de visualização · alterações bloqueadas' : 'Alterações são salvas automaticamente';
}

document.getElementById('orgLogin').addEventListener('submit', async (event) => {
  event.preventDefault();
  showAuthMessage('Entrando…');
  const form = new FormData(event.currentTarget);
  const { data, error } = await orgClient.auth.signInWithPassword({
    email: String(form.get('email') || '').trim(),
    password: String(form.get('password') || ''),
  });
  if (error) return showAuthMessage(error.message);
  await openProtectedOrganogram(data.session);
});

document.getElementById('orgForgot').addEventListener('click', async () => {
  const email = document.querySelector('#orgLogin [name="email"]').value.trim();
  if (!email) return showAuthMessage('Informe seu e-mail para receber a recuperação de senha.');
  const { error } = await orgClient.auth.resetPasswordForEmail(email, { redirectTo: new URL('../', location.href).href });
  showAuthMessage(error ? error.message : 'Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.');
});

document.getElementById('orgLogout').addEventListener('click', async () => {
  await orgClient.auth.signOut();
  orgCurrentUserId = null;
  showLogin();
});

document.getElementById('orgImport').addEventListener('click', async () => {
  if (!orgCurrentMember?.is_admin || !orgCurrentUserId) return showAuthMessage('Somente um administrador pode realizar a carga inicial.');
  const file = document.getElementById('orgSeedFile').files[0];
  const text = document.getElementById('orgSeedText').value.trim();
  if (!file && !text) return showAuthMessage('Selecione o arquivo JSON ou cole o conteúdo da carga inicial.');
  try {
    const payload = JSON.parse(file ? await file.text() : text);
    if (!payload?.contabil?.rotinas || !payload?.fiscal?.rotinas) throw new Error('Arquivo de carga inválido.');
    showAuthMessage('Importando dados protegidos…');
    const { error } = await orgClient.from('org_workspace').insert({ id:'main', payload, updated_at:new Date().toISOString(), updated_by:orgCurrentUserId });
    if (error) throw error;
    document.getElementById('orgSetup').hidden = true;
    buildFromState(payload);
    document.getElementById('orgMember').textContent = orgCurrentMember.name || '';
    accessGate.hidden = true;
    protectedApp.hidden = false;
    renderAll();
  } catch (error) {
    showAuthMessage(error.message || String(error));
  }
});

function mergeLocalAssignments(localPayload) {
  const merged = serializeState();
  for (const [key, localSection] of Object.entries(localPayload || {})) {
    const currentSection = merged[key];
    if (!currentSection || !Array.isArray(localSection?.rotinas)) continue;
    const localTeam = Array.isArray(localSection.equipe) ? localSection.equipe.filter(Boolean) : [];
    if (localTeam.length) currentSection.equipe = [...new Set(localTeam)];
    const currentByRid = new Map(currentSection.rotinas.map(routine => [routine.rid, routine]));
    for (const localRoutine of localSection.rotinas) {
      if (!localRoutine?.rid) continue;
      const currentRoutine = currentByRid.get(localRoutine.rid);
      if (currentRoutine) {
        currentRoutine.selected = Array.isArray(localRoutine.selected) ? localRoutine.selected.filter(Boolean) : [];
        if (typeof localRoutine.nome === 'string' && localRoutine.nome.trim()) currentRoutine.nome = localRoutine.nome.trim();
        if (typeof localRoutine.cor === 'string') currentRoutine.cor = localRoutine.cor;
        currentRoutine.destaque = Boolean(localRoutine.destaque);
      } else {
        currentSection.rotinas.push({
          rid: localRoutine.rid,
          nome: localRoutine.nome || '(sem nome)',
          desc: localRoutine.desc || '',
          summary: localRoutine.summary || '',
          manualFiles: [],
          manualVersion: Number(localRoutine.manualVersion) || 0,
          destaque: Boolean(localRoutine.destaque),
          cor: localRoutine.cor || '',
          selected: Array.isArray(localRoutine.selected) ? localRoutine.selected.filter(Boolean) : [],
        });
      }
    }
  }
  return merged;
}

document.getElementById('orgSyncApply').addEventListener('click', async () => {
  const status = document.getElementById('orgSyncStatus');
  if (!orgCurrentMember?.is_admin || !orgCurrentUserId) return status.textContent = 'Somente um administrador pode aplicar a configuração local.';
  const text = document.getElementById('orgSyncText').value.trim();
  if (!text) return status.textContent = 'Cole primeiro a configuração copiada do painel local.';
  try {
    const localPayload = JSON.parse(text);
    if (!localPayload?.contabil?.rotinas || !localPayload?.fiscal?.rotinas) throw new Error('Configuração local inválida.');
    const merged = mergeLocalAssignments(localPayload);
    status.textContent = 'Aplicando responsáveis e personalizações…';
    const { error } = await orgClient.from('org_workspace').update({ payload:merged, updated_at:new Date().toISOString(), updated_by:orgCurrentUserId }).eq('id','main');
    if (error) throw error;
    buildFromState(merged);
    renderAll();
    document.getElementById('orgSyncText').value = '';
    document.getElementById('orgSyncTools').open = false;
    status.textContent = 'Configuração local aplicada com sucesso.';
  } catch (error) {
    status.textContent = error.message || String(error);
  }
});

function getRoutineManualFiles(routine) {
  const official = Array.isArray(routine?.manualFiles) ? routine.manualFiles : [];
  const uploaded = orgUploadedManuals.filter(manual => manual.routineId === routine?.rid);
  return [...official, ...uploaded];
}

async function loadOrgManuals() {
  const { data, error } = await orgClient.from('org_manuals')
    .select('id,routine_id,area,role,item,title,file_name,storage_path,file_size,created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  orgUploadedManuals = (data || []).map(manual => ({
    id: manual.id,
    routineId: manual.routine_id,
    area: manual.area,
    role: manual.role,
    item: manual.item || '',
    title: manual.title,
    label: 'Abrir ' + manual.file_name,
    fileName: manual.file_name,
    storagePath: manual.storage_path,
    fileSize: manual.file_size,
    createdAt: manual.created_at,
    summary: manual.item || 'Documento enviado pelo portal.',
  }));
}

async function openUploadedManual(manual, button) {
  const popup = window.open('about:blank', '_blank');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Abrindo…';
  try {
    const { data, error } = await orgClient.storage.from('org-manuals').createSignedUrl(manual.storagePath, 120);
    if (error || !data?.signedUrl) throw error || new Error('Link do manual indisponível.');
    if (popup) { popup.opener = null; popup.location.replace(data.signedUrl); }
    else window.location.href = data.signedUrl;
  } catch (error) {
    if (popup) popup.close();
    button.textContent = error.message || 'Não foi possível abrir';
    setTimeout(() => { button.textContent = originalLabel; }, 2500);
  } finally {
    button.disabled = false;
    if (button.textContent === 'Abrindo…') button.textContent = originalLabel;
  }
}

const manualDialog = document.getElementById('orgManualDialog');
const manualForm = document.getElementById('orgManualForm');
const manualArea = document.getElementById('orgManualArea');
const manualRoutine = document.getElementById('orgManualRoutine');
const manualFile = document.getElementById('orgManualFile');
const manualTitle = document.getElementById('orgManualTitle');
const manualStatus = document.getElementById('orgManualStatus');

function populateManualRoutines() {
  const section = secoes.find(item => item.key === manualArea.value);
  manualRoutine.innerHTML = '';
  for (const routine of section?.rotinas || []) {
    const option = document.createElement('option');
    option.value = routine.rid;
    option.textContent = routine.nome;
    manualRoutine.appendChild(option);
  }
  if (!manualRoutine.options.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Nenhuma rotina disponível';
    manualRoutine.appendChild(option);
  }
}

function closeManualDialog() {
  if (manualDialog.open) manualDialog.close();
  manualStatus.textContent = '';
}

document.getElementById('orgManualUploadBtn').addEventListener('click', () => {
  if (!orgCurrentMember?.is_admin) return;
  manualForm.reset();
  populateManualRoutines();
  manualStatus.textContent = '';
  manualDialog.showModal();
});
manualArea.addEventListener('change', populateManualRoutines);
document.getElementById('orgManualClose').addEventListener('click', closeManualDialog);
document.getElementById('orgManualCancel').addEventListener('click', closeManualDialog);
manualDialog.addEventListener('click', event => { if (event.target === manualDialog) closeManualDialog(); });
manualFile.addEventListener('change', () => {
  const file = manualFile.files?.[0];
  if (file && !manualTitle.value.trim()) manualTitle.value = file.name.replace(/\.docx$/i, '');
});

manualForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!orgCurrentMember?.is_admin || !orgCurrentUserId) return;
  const file = manualFile.files?.[0];
  const area = manualArea.value;
  const routineId = manualRoutine.value;
  const role = document.getElementById('orgManualRole').value;
  const item = document.getElementById('orgManualItem').value.trim();
  const title = manualTitle.value.trim() || file?.name.replace(/\.docx$/i, '') || '';
  const expectedPrefix = area === 'contabil' ? 'POPCON - ' : 'POPFIS - ';
  const submit = document.getElementById('orgManualSubmit');
  if (!file || !routineId) return manualStatus.textContent = 'Selecione a rotina e o arquivo DOCX.';
  if (!file.name.toUpperCase().startsWith(expectedPrefix)) return manualStatus.textContent = 'O arquivo deve começar com “' + expectedPrefix.trim() + '”.';
  if (!/\.docx$/i.test(file.name)) return manualStatus.textContent = 'Somente arquivos DOCX são aceitos.';
  if (file.size < 1 || file.size > 20 * 1024 * 1024) return manualStatus.textContent = 'O arquivo deve ter no máximo 20 MB.';
  if (!title || title.length > 200) return manualStatus.textContent = 'Informe um título com até 200 caracteres.';
  if (role === 'adicional' && !item) return manualStatus.textContent = 'Informe o item ou subrotina do material adicional.';

  const safeName = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  const storagePath = area + '/' + routineId + '/' + Date.now() + '-' + crypto.randomUUID() + '-' + safeName;
  submit.disabled = true;
  manualStatus.textContent = 'Enviando e vinculando o manual…';
  try {
    const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const { error: uploadError } = await orgClient.storage.from('org-manuals').upload(storagePath, file, { contentType, upsert: false });
    if (uploadError) throw uploadError;
    const { error: insertError } = await orgClient.from('org_manuals').insert({
      routine_id: routineId,
      area,
      role,
      item: item || null,
      title,
      file_name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      uploaded_by: orgCurrentUserId,
    });
    if (insertError) {
      await orgClient.storage.from('org-manuals').remove([storagePath]);
      throw insertError;
    }
    await loadOrgManuals();
    renderAll();
    manualStatus.textContent = 'Manual enviado e vinculado com sucesso.';
    setTimeout(closeManualDialog, 900);
  } catch (error) {
    manualStatus.textContent = error.message || String(error);
  } finally {
    submit.disabled = false;
  }
});

async function orgInviteRequest(body) {
  const { data, error } = await orgClient.functions.invoke('fc-invite-member', { body });
  if (error || !data?.ok) {
    let detail = data?.error;
    if (!detail && error?.context?.json) {
      try { detail = (await error.context.json())?.error; } catch { /* resposta sem JSON */ }
    }
    throw new Error(detail || error?.message || 'Serviço de convites indisponível.');
  }
  return data;
}

async function loadOrgMembers() {
  if (!orgCurrentMember?.is_admin) return;
  const status = document.getElementById('orgMemberStatus');
  status.textContent = 'Carregando usuários…';
  const { data, error } = await orgClient.from('fc_members').select('id,name,email,active,is_admin').order('name');
  if (error) { status.textContent = error.message || String(error); return; }
  orgMembers = data || [];
  status.textContent = '';
  renderOrgMembers();
}

function renderOrgMembers() {
  if (!orgCurrentMember?.is_admin) return;
  const body = document.getElementById('orgMembersBody');
  body.innerHTML = '';
  if (!orgMembers.length) { void loadOrgMembers(); return; }
  for (const member of orgMembers) {
    const row = document.createElement('tr');
    const name = document.createElement('td'); name.textContent = member.name || 'Sem nome';
    const email = document.createElement('td'); email.textContent = member.email || '—';
    const roleCell = document.createElement('td');
    const role = document.createElement('select'); role.className = 'org-role-select'; role.dataset.memberId = member.id;
    role.innerHTML = '<option value="viewer">Somente visualização</option><option value="admin">Administrador</option>';
    role.value = member.is_admin ? 'admin' : 'viewer';
    role.disabled = member.id === orgCurrentUserId;
    role.addEventListener('change', async () => {
      const desiredAdmin = role.value === 'admin';
      role.disabled = true;
      const status = document.getElementById('orgMemberStatus'); status.textContent = 'Atualizando perfil…';
      const { error } = await orgClient.rpc('fc_set_member_role', { p_member_id: member.id, p_is_admin: desiredAdmin });
      if (error) { role.value = member.is_admin ? 'admin' : 'viewer'; status.textContent = error.message || String(error); }
      else { member.is_admin = desiredAdmin; status.textContent = 'Perfil atualizado com sucesso.'; }
      role.disabled = member.id === orgCurrentUserId;
    });
    roleCell.appendChild(role);
    const active = document.createElement('td'); const pill = document.createElement('span'); pill.className = 'org-status-pill' + (member.active ? '' : ' inactive'); pill.textContent = member.active ? 'Ativo' : 'Inativo'; active.appendChild(pill);
    row.append(name,email,roleCell,active); body.appendChild(row);
  }
}

document.getElementById('orgMemberForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!orgCurrentMember?.is_admin) return;
  const status = document.getElementById('orgMemberStatus');
  const name = document.getElementById('orgMemberName').value.trim();
  const email = document.getElementById('orgMemberEmail').value.trim().toLowerCase();
  const makeAdmin = document.getElementById('orgMemberRole').value === 'admin';
  if (!name || !email) return status.textContent = 'Informe nome e e-mail válidos.';
  status.textContent = 'Enviando convite…';
  try {
    await orgInviteRequest({ email, name });
    if (makeAdmin) {
      const { data: created, error: lookupError } = await orgClient.from('fc_members').select('id').eq('email', email).maybeSingle();
      if (lookupError || !created) throw lookupError || new Error('Usuário convidado não localizado.');
      const { error: promoteError } = await orgClient.rpc('fc_promote_member', { p_member_id: created.id });
      if (promoteError) throw promoteError;
    }
    form.reset();
    status.textContent = makeAdmin ? 'Convite de administrador enviado.' : 'Convite de visualização enviado.';
    await loadOrgMembers();
  } catch (error) { status.textContent = error.message || String(error); }
});

orgClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') showLogin();
  if (event === 'SIGNED_IN' && protectedApp.hidden) setTimeout(() => openProtectedOrganogram(session), 0);
});

orgClient.auth.getSession().then(({ data }) => openProtectedOrganogram(data.session));

