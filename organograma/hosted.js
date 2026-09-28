const ORG_SUPABASE_URL = 'https://jbnqgchofaprjjwbuzpe.supabase.co';
const ORG_SUPABASE_KEY = 'sb_publishable_jjy5twY8P1oroKyMgF5A_g_loODauqr';
const orgClient = window.supabase.createClient(ORG_SUPABASE_URL, ORG_SUPABASE_KEY);
let orgCurrentUserId = null;
let orgCurrentMember = null;

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
  if (!file) return showAuthMessage('Selecione o arquivo JSON da carga inicial.');
  try {
    const payload = JSON.parse(await file.text());
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

orgClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') showLogin();
  if (event === 'SIGNED_IN' && protectedApp.hidden) setTimeout(() => openProtectedOrganogram(session), 0);
});

orgClient.auth.getSession().then(({ data }) => openProtectedOrganogram(data.session));
