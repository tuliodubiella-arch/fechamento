import { createClient } from "npm:@supabase/supabase-js@2";

const projectUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const pagesOrigin = "https://tuliodubiella-arch.github.io";
const redirectTo = pagesOrigin + "/fechamento/";

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": pagesOrigin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" },
  });
}

Deno.serve(async (request) => {
  if (request.headers.get("origin") !== pagesOrigin) return response({ error: "Origem não permitida" }, 403);
  if (request.method === "OPTIONS") return response({ ok: true });
  if (request.method !== "POST") return response({ error: "Método inválido" }, 405);
  const jwt = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return response({ error: "Sessão necessária" }, 401);
  const authClient = createClient(projectUrl, publishableKey, { auth: { persistSession: false } });
  const adminClient = createClient(projectUrl, serviceKey, { auth: { persistSession: false } });
  const { data: identity, error: identityError } = await authClient.auth.getUser(jwt);
  if (identityError || !identity.user) return response({ error: "Sessão inválida" }, 401);
  const { data: caller, error: callerError } = await adminClient.from("fc_members")
    .select("is_admin,active").eq("id", identity.user.id).maybeSingle();
  if (callerError || !caller?.active || !caller?.is_admin) return response({ error: "Somente o administrador pode convidar" }, 403);

  let payload: { action?: string; email?: string; name?: string; memberId?: string };
  try { payload = await request.json(); } catch { return response({ error: "Dados inválidos" }, 400); }
  if (payload.action === "status") {
    const { data: members, error: membersError } = await adminClient.from("fc_members").select("id").eq("active", true);
    if (membersError) return response({ error: "Não foi possível consultar os responsáveis" }, 500);
    const ids = new Set((members || []).map((member) => member.id));
    const pendingIds: string[] = [];
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return response({ error: "Não foi possível consultar os convites" }, 500);
      for (const user of data.users) {
        if (ids.has(user.id) && user.invited_at && !user.email_confirmed_at && !user.confirmed_at && !user.last_sign_in_at)
          pendingIds.push(user.id);
      }
      if (data.users.length < 1000) break;
    }
    return response({ ok: true, pendingIds });
  }
  if (payload.action === "resend") {
    const memberId = payload.memberId;
    if (!memberId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId))
      return response({ error: "Responsável inválido" }, 400);
    const { data: member, error: memberError } = await adminClient.from("fc_members")
      .select("id,email,name,active").eq("id", memberId).maybeSingle();
    if (memberError || !member?.active) return response({ error: "Responsável não encontrado ou inativo" }, 404);
    const { data: authUser, error: userError } = await adminClient.auth.admin.getUserById(member.id);
    const user = authUser?.user;
    if (userError || !user || user.email?.toLowerCase() !== member.email.toLowerCase())
      return response({ error: "Conta de acesso não encontrada" }, 409);
    if (!user.invited_at || user.email_confirmed_at || user.confirmed_at || user.last_sign_in_at)
      return response({ error: "Este responsável já aceitou o convite ou não possui convite pendente" }, 409);
    const sentAt = user.confirmation_sent_at || user.invited_at;
    if (sentAt && Date.now() - Date.parse(sentAt) < 60_000)
      return response({ error: "Aguarde um minuto antes de reenviar o convite" }, 429);
    const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(member.email, {
      redirectTo, data: { full_name: member.name },
    });
    if (inviteError || invite.user?.id !== member.id)
      return response({ error: inviteError?.message || "Não foi possível reenviar o convite" }, 400);
    return response({ ok: true });
  }
  if (payload.action && payload.action !== "invite") return response({ error: "Ação inválida" }, 400);
  const email = payload.email?.trim().toLowerCase();
  const name = payload.name?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || name.length < 2 || name.length > 120)
    return response({ error: "Informe nome e e-mail válidos" }, 400);
  const { data: existing } = await adminClient.from("fc_members").select("id").eq("email", email).maybeSingle();
  if (existing) return response({ error: "Este e-mail já está cadastrado no fechamento" }, 409);

  let userId: string | undefined;
  let existingUser = false;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return response({ error: "Não foi possível conferir os usuários existentes" }, 500);
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) { userId = match.id; existingUser = true; break; }
    if (data.users.length < 1000) break;
  }
  if (!userId) {
    const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: name } });
    if (inviteError || !invite.user) return response({ error: inviteError?.message || "Convite não enviado" }, 400);
    userId = invite.user.id;
  }
  const { error: insertError } = await adminClient.from("fc_members").insert({ id: userId, email, name, legacy_name: name, active: true, is_admin: false });
  if (insertError) return response({ error: "O perfil não foi criado. Verifique o cadastro no Supabase." }, 500);
  await adminClient.from("fc_tasks").update({ responsible_id: userId, responsible_legacy_name: null })
    .ilike("responsible_legacy_name", name);
  return response({ ok: true, existingUser });
});
