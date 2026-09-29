const ORG_SUPABASE_URL = 'https://jbnqgchofaprjjwbuzpe.supabase.co';
const ORG_SUPABASE_KEY = 'sb_publishable_jjy5twY8P1oroKyMgF5A_g_loODauqr';
const orgClient = window.supabase.createClient(ORG_SUPABASE_URL, ORG_SUPABASE_KEY);
let orgCurrentUserId = null;
let orgCurrentMember = null;
let orgMembers = [];

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
  if (memberError || !member?.active) {
    document.getElementById('orgLogin').hidden = true;
    document.getElementById('orgForgot').hidden = true;
    showAuthMessage('Acesso pendente. Peça ao administrador para liberar seu cadastro no painel de fechamento.');
    return;
  }
  orgCurrentUserId = session.user.id;
  orgCurrentMember = member;
  document.getElementById('orgSyncTools').hidden = !member.is_admin;
  document.getElementById('membersTab').hidden = !member.is_admin;
  const { data: workspace, error: workspaceError } = await orgClient.from('org_workspace').select('payload').eq('id', 'main').maybeSingle();
  if (workspaceError) {
    showAuthMessage('Não foi possível carregar as rotinas protegidas. Tente novamente.');
    return;
  }
  if (!workspace) {
    document.getElementById('orgLogin').hidden = true;
    document.getElementById('orgForgot').hidden = true;
    document.getElementById('orgSetup').hidden = !member.is_admin;
    showAuthMessage(member.is_admin ? 'Aguardando a carga inicial do organograma.' : 'O organograma ainda não foi inicializado pelo administrador.');
    return;
  }
  buildFromState(workspace.payload);
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
    event.currentTarget.reset();
    status.textContent = makeAdmin ? 'Convite de administrador enviado.' : 'Convite de visualização enviado.';
    await loadOrgMembers();
  } catch (error) { status.textContent = error.message || String(error); }
});

orgClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') showLogin();
  if (event === 'SIGNED_IN' && protectedApp.hidden) setTimeout(() => openProtectedOrganogram(session), 0);
});

orgClient.auth.getSession().then(({ data }) => openProtectedOrganogram(data.session));
