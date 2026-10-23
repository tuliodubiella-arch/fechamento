/* Interface pública; os dados e permissões ficam no Supabase sob RLS. */
const SUPABASE_URL = "https://jbnqgchofaprjjwbuzpe.supabase.co";
const SUPABASE_KEY = "sb_publishable_jjy5twY8P1oroKyMgF5A_g_loODauqr";
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (selector) => document.querySelector(selector);
const field = (form, name) => form.elements.namedItem(name);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const uid = () => crypto.randomUUID();
const departments = ["financeiro", "rh", "estoque", "fiscal", "balancete"];
const tabNames = ["Painel Geral", "Meu Painel", "Execução", "Rotinas avulsas", "Metas", "Histórico", "Controle de erros", "Sugestões de melhoria", "Cadastros"];
const APP_VERSION = "2026.10.23.2";
const errorStatuses = ["Aberto", "Em análise", "Em correção", "Aguardando validação", "Corrigido"];
const executionStatuses = ["Não iniciado", "Em andamento", "Pausado", "Finalizado"];
const legacyCutoff = "2026-09";
const initialInvite = new URLSearchParams(location.hash.replace(/^#/, "")).get("type") === "invite";
const expiredAuthLink = new URLSearchParams(location.hash.replace(/^#/, "")).get("error_code") === "otp_expired";
const state = {
  session: null, member: null, members: [], companies: [], tasks: [], taskLabelEdits: [], taskLabelsReady: false, taskLabelsError: "", owners: [], targets: [], receipts: [], receiptDeliveries: [], receiptFeatureReady: false,
  states: [], holidays: [], history: [], releaseNotes: [], corrections: [], taskComments: [], suggestions: [], closingErrors: [], generalRoutines: [], generalEvents: [], generalNotes: [], generalReady: false, generalError: "", generalStatusFilter: "", generalSearch: "", generalMineOnly: false, generalOpenId: "", generalCreateOpen: false, generalCreateDraft: {}, generalRecurrenceDrafts: {}, generalNoteDrafts: {}, errorFeatureReady: false, errorFeatureError: "", errorStatusFilter: "", errorSearch: "", collaborationReady: false, collaborationError: "", commentsMonth: "", commentTaskId: "", commentDrafts: {}, suggestionReasonDrafts: {}, suggestionDraft: "", adminDataError: "", tab: "Painel Geral", month: "2026-09", query: "",
  companyFilter: "", ownerFilter: "", statusFilters: [], groupFilters: [], myPanelCompanyFilters: [], analysisCompanyFilters: [], executionOwnerWarning: "", online: navigator.onLine,
  queue: [], ready: false, needsPassword: initialInvite, tick: Date.now(), error: "",
  recoveryHold: false, recoveryApproved: false, recoveryBackupRequested: false, recoveryBackupConfirmed: false, syncError: "", errorSaveNotice: "", errorSaveFailed: false,
  invitePendingIds: [], inviteStatus: "idle",
  historyLoaded: false,
};
let flushing = false;
let toastTimer;

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 4500);
}
function brasilia(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));
}
function dateBR(iso) { return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—"; }
function closingDate(goal) {
  if (goal.official_close_date) return goal.official_close_date;
  if (!goal.delivery_at) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(goal.delivery_at));
}
function closingDateLabel(goal) {
  return goal.official_close_date ? dateBR(goal.official_close_date) : goal.delivery_at ? brasilia(goal.delivery_at) : '<span class="muted">Aguardando última rotina</span>';
}
function monthName(month) { return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`)); }
function adjacentCompetence(month, offset) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function duration(seconds) {
  const n = Math.max(0, Math.floor(seconds || 0));
  return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map((part) => String(part).padStart(2, "0")).join(":");
}
function currentSeconds(item) {
  if (!item) return 0;
  return (item.total_seconds || 0) + (item.status === "Em andamento" && item.started_at ? Math.max(0, Math.floor((state.tick - Date.parse(item.started_at)) / 1000)) : 0);
}
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(Date.UTC(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
}
function holidayDates(year) {
  const fixed = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25", "11-14"];
  const goodFriday = new Date(easter(year).getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const dates = new Set([...fixed.map((day) => `${year}-${day}`), goodFriday]);
  if (year === 2026) dates.add("2026-06-04"); // Corpus Christi, Cascavel/PR, Decreto 20.042/2025.
  for (const holiday of state.holidays) dates.add(holiday.date);
  return dates;
}
function plannedDate(month, businessDay) {
  if (!businessDay || businessDay < 1 || businessDay > 23) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const excluded = holidayDates(next.getUTCFullYear());
  let count = 0;
  for (let date = new Date(next); date.getUTCMonth() === next.getUTCMonth(); date.setUTCDate(date.getUTCDate() + 1)) {
    const iso = date.toISOString().slice(0, 10);
    if ([0, 6].includes(date.getUTCDay()) || excluded.has(iso)) continue;
    if (++count === businessDay) return iso;
  }
  return null;
}
const cacheKey = () => `fc_cache_${state.session?.user?.id || "anonymous"}`;
const queueKey = () => `fc_queue_${state.session?.user?.id || "anonymous"}`;
const recoveryKey = () => `fc_recovery_hold_${state.session?.user?.id || "anonymous"}`;
const recoveryErrorKey = () => `fc_recovery_error_${state.session?.user?.id || "anonymous"}`;
const isLegacyTaskWrite = (item) => item.kind === "upsert" && item.table === "fc_tasks";
function saveCache() {
  if (!state.session) return;
  const payload = Object.fromEntries(["members", "companies", "tasks", "taskLabelEdits", "taskLabelsReady", "owners", "targets", "receipts", "receiptDeliveries", "receiptFeatureReady", "states", "holidays", "history", "releaseNotes", "corrections", "taskComments", "suggestions", "closingErrors", "errorFeatureReady", "generalRoutines", "generalEvents", "generalNotes", "generalReady", "commentsMonth"].map((key) => [key, state[key]]));
  localStorage.setItem(cacheKey(), JSON.stringify(payload));
}
function loadCache() {
  try {
    const data = JSON.parse(localStorage.getItem(cacheKey()) || "null");
    if (data) for (const key of Object.keys(data)) if (key in state) state[key] = data[key];
    state.historyLoaded = Boolean(data && Object.hasOwn(data, "history"));
    state.queue = JSON.parse(localStorage.getItem(queueKey()) || "[]");
    state.recoveryHold = state.queue.length > 0 && (localStorage.getItem(recoveryKey()) === "1" || state.queue.some(isLegacyTaskWrite));
    if (state.recoveryHold) localStorage.setItem(recoveryKey(), "1");
    else localStorage.removeItem(recoveryKey());
    state.syncError = state.recoveryHold ? localStorage.getItem(recoveryErrorKey()) || "" : "";
    state.recoveryApproved = false;
    state.recoveryBackupRequested = false;
    state.recoveryBackupConfirmed = false;
    state.member = state.members.find((person) => person.id === state.session?.user?.id && person.active) || null;
    state.ready = Boolean(data);
  } catch { /* Sem cache legível neste aparelho. */ }
}
function enqueue(item) {
  state.queue.push(item);
  localStorage.setItem(queueKey(), JSON.stringify(state.queue));
  if (isLegacyTaskWrite(item)) {
    state.recoveryHold = true;
    state.recoveryApproved = false;
    localStorage.setItem(recoveryKey(), "1");
  }
  saveCache(); render();
  toast(state.recoveryHold ? "Registro guardado neste aparelho. Revise a fila antes de sincronizar." : state.online ? "Registro salvo; sincronizando…" : "Registro salvo neste aparelho; sincronizará quando voltar a conexão.");
  void flush();
}
async function insertNewTask(row) {
  const result = await client.from("fc_tasks").insert(row);
  if (result.error?.code !== "23505") return result;
  // Se o servidor gravou a inclusão mas a resposta se perdeu, a repetição é segura.
  const existing = await client.from("fc_tasks").select("*").eq("id", row.id).maybeSingle();
  if (existing.error || !existing.data) return result;
  const fields = ["id", "company_id", "account", "group_name", "responsible_id", "responsible_legacy_name", "created_competence", "active"];
  return fields.every((key) => (existing.data[key] ?? null) === (row[key] ?? null)) ? { error: null } : result;
}
async function insertCollaborationRecord(item) {
  const result = await client.from(item.table).insert(item.row);
  if (result.error?.code !== "23505") return result;
  const existing = await client.from(item.table).select("*").eq("id", item.row.id).maybeSingle();
  if (existing.error || !existing.data) return result;
  const fields = item.table === "fc_general_routines" ? ["title", "description", "responsible_id", "created_by", "recurrence_frequency", "next_scheduled_date", "recurrence_day"]
    : item.table === "fc_general_routine_notes" ? ["routine_id", "author_id", "body", "occurred_at"]
    : item.table === "fc_task_comments" ? ["task_id", "competence", "author_id", "body"]
    : item.table === "fc_closing_errors" ? ["company_name", "assigned_user", "requested_by", "requested_at", "error_label", "description", "status", "system_improvement", "correction_date", "created_by"]
      : ["author_id", "body"];
  return fields.every((key) => key === "occurred_at"
    ? Date.parse(existing.data[key]) === Date.parse(item.row[key])
    : (existing.data[key] ?? null) === (item.row[key] ?? null)) ? { error: null } : result;
}
async function updateClosingError(id, values) {
  const { data, error } = await client.from("fc_closing_errors").update(values).eq("id", id).select();
  if (error) throw error;
  if (data?.length !== 1 || data[0].id !== id || data[0].status !== values.status || data[0].correction_date !== values.correction_date)
    throw new Error("O servidor não confirmou a atualização deste erro. O status anterior foi mantido; tente novamente ou avise o administrador.");
  return data[0];
}
async function flush() {
  if (!state.online || !state.member || flushing || (state.recoveryHold && !state.recoveryApproved)) return;
  flushing = true;
  try {
    while (state.queue.length) {
      const item = state.queue[0];
      let result;
      if (item.kind === "rpc") result = await client.rpc(item.name, item.args);
      else if ((item.kind === "insert" && item.table === "fc_tasks") || isLegacyTaskWrite(item)) result = await insertNewTask(item.row);
      else if (item.kind === "insert" && ["fc_task_comments", "fc_improvement_suggestions", "fc_closing_errors", "fc_general_routines", "fc_general_routine_notes"].includes(item.table)) result = await insertCollaborationRecord(item);
      else if (item.kind === "upsert") result = await client.from(item.table).upsert(item.row, { onConflict: item.conflict });
      else if (item.kind === "update" && item.table === "fc_closing_errors") {
        const row = await updateClosingError(item.where.id, item.values);
        result = { data: [row], error: null };
      }
      else if (item.kind === "update") {
        let query = client.from(item.table).update(item.values);
        for (const [key, value] of Object.entries(item.where)) query = query.eq(key, value);
        result = await query.select();
      }
      if (result?.error) throw result.error;
      state.queue.shift();
      localStorage.setItem(queueKey(), JSON.stringify(state.queue));
      if (item.table === "fc_closing_errors") {
        state.errorSaveNotice = "Alteração do controle de erros confirmada no servidor.";
        state.errorSaveFailed = false;
      }
    }
    if (state.recoveryHold) {
      localStorage.removeItem(recoveryKey());
      localStorage.removeItem(recoveryErrorKey());
      state.recoveryHold = false;
      state.recoveryApproved = false;
      state.recoveryBackupRequested = false;
      state.recoveryBackupConfirmed = false;
    }
    state.syncError = "";
    await loadData();
  } catch (error) {
    state.syncError = error.message || String(error);
    if (state.queue[0]?.table === "fc_closing_errors") {
      state.errorSaveNotice = `A alteração ainda não foi confirmada: ${state.syncError}`;
      state.errorSaveFailed = true;
    }
    if (state.queue.length && (error.status ? error.status >= 400 && error.status < 500 : Boolean(error.code))) {
      state.recoveryHold = true;
      state.recoveryApproved = false;
      localStorage.setItem(recoveryKey(), "1");
      localStorage.setItem(recoveryErrorKey(), state.syncError);
    }
    toast(`Sincronização pendente: ${state.syncError}`);
  }
  finally { flushing = false; if (state.recoveryHold) state.recoveryApproved = false; render(); }
}
const isDuplicatePauseBlocked = () => {
  const item = state.queue[0];
  return state.recoveryHold && /rotina não está em andamento/i.test(state.syncError)
    && item?.kind === "rpc" && item.name === "fc_apply_activity"
    && item.args?.p_action === "pause" && Boolean(item.args?.p_event_id);
};
async function skipDuplicatePause() {
  if (!state.online || !state.member || !state.recoveryBackupRequested || !state.recoveryBackupConfirmed || !isDuplicatePauseBlocked() || flushing) return;
  const item = state.queue[0], details = pendingDescription(item);
  if (!confirm(`Ignorar SOMENTE este PAUSE pendente de ${details.target}, ${details.time}?\n\nFaça isso apenas se foi um clique repetido e não houve trabalho adicional após o PAUSE já gravado. A ação será auditada, nenhum tempo no servidor será alterado e os outros itens permanecerão na fila.`)) return;
  const saved = JSON.parse(localStorage.getItem(queueKey()) || "[]");
  if (!Array.isArray(saved) || saved[0]?.args?.p_event_id !== item.args.p_event_id || saved.length !== state.queue.length) return toast("A fila mudou. Recarregue e baixe uma nova cópia antes de continuar.");
  const { error } = await client.rpc("fc_skip_duplicate_pending_pause", {
    p_event_id: item.args.p_event_id, p_task_id: item.args.p_task_id,
    p_competence: item.args.p_competence, p_occurred_at: item.args.p_occurred_at,
  });
  if (error) return toast(`PAUSE não retirado: ${error.message}`);
  if (state.queue[0]?.args?.p_event_id !== item.args.p_event_id) return toast("A fila mudou durante a verificação. Recarregue para conferir.");
  state.queue.shift();
  localStorage.setItem(queueKey(), JSON.stringify(state.queue));
  localStorage.removeItem(recoveryErrorKey());
  state.syncError = "";
  state.recoveryBackupRequested = false;
  state.recoveryBackupConfirmed = false;
  render();
  toast("PAUSE repetido retirado e auditado. Os demais registros estão preservados; baixe uma nova cópia antes de sincronizar.");
}
async function allRows(table, filters = {}) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = client.from(table).select("*").range(from, from + 999);
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
async function loadData() {
  if (!state.session || !state.online) { render(); return; }
  const requestedMonth = state.month;
  try {
    if (!isHistorical() && requestedMonth < "2026-11") {
      const { error: assignmentError } = await client.rpc("fc_ensure_month_owners", { p_competence: requestedMonth });
      if (assignmentError) throw assignmentError;
    }
    const [members, companies, tasks, owners, targets, receipts, activityStates, holidays, history, deliveries, comments, suggestions, closingErrors, generalRoutines, generalEvents, generalNotes, labelEdits] = await Promise.all([
      allRows("fc_members"), allRows("fc_companies"), allRows("fc_tasks"), allRows("fc_month_owners"), allRows("fc_targets"),
      allRows("fc_receipts"), allRows("fc_activity_states"), allRows("fc_holidays"),
      state.historyLoaded ? Promise.resolve(state.history) : allRows("fc_history_tasks"),
      allRows("fc_receipt_deliveries").then((data) => ({ data })).catch((error) => ({ error })),
      allRows("fc_task_comments", { competence: requestedMonth }).then((data) => ({ data })).catch((error) => ({ error })),
      allRows("fc_improvement_suggestions").then((data) => ({ data })).catch((error) => ({ error })),
      allRows("fc_closing_errors").then((data) => ({ data })).catch((error) => ({ error })),
      allRows("fc_general_routines").then((data) => ({ data })).catch((error) => ({ error })),
      allRows("fc_general_routine_events").then((data) => ({ data })).catch((error) => ({ error })),
      allRows("fc_general_routine_notes").then((data) => ({ data })).catch((error) => ({ error })),
      allRows("fc_task_label_edits").then((data) => ({ data })).catch((error) => ({ error })),
    ]);
    if (requestedMonth !== state.month) return;
    state.members = members; state.companies = companies; state.tasks = tasks; state.owners = owners; state.targets = targets;
    state.receipts = receipts; state.states = activityStates; state.holidays = holidays; state.history = history;
    state.taskLabelsReady = !labelEdits.error;
    state.taskLabelsError = labelEdits.error?.message || "";
    if (labelEdits.data) state.taskLabelEdits = labelEdits.data;
    state.receiptFeatureReady = !deliveries.error;
    state.receiptDeliveries = deliveries.data || [];
    state.collaborationReady = !comments.error && !suggestions.error;
    state.collaborationError = comments.error?.message || suggestions.error?.message || "";
    if (comments.data) {
      const pending = state.queue.filter((item) => item.kind === "insert" && item.table === "fc_task_comments" && item.row.competence === requestedMonth).map((item) => item.row);
      state.taskComments = [...comments.data, ...pending.filter((row) => !comments.data.some((saved) => saved.id === row.id))];
      state.commentsMonth = requestedMonth;
    }
    if (suggestions.data) {
      const pending = state.queue.filter((item) => item.kind === "insert" && item.table === "fc_improvement_suggestions").map((item) => item.row);
      state.suggestions = [...suggestions.data, ...pending.filter((row) => !suggestions.data.some((saved) => saved.id === row.id))];
    }
    state.errorFeatureReady = !closingErrors.error;
    state.errorFeatureError = closingErrors.error?.message || "";
    if (closingErrors.data) {
      const pending = state.queue.filter((item) => item.kind === "insert" && item.table === "fc_closing_errors").map((item) => item.row);
      state.closingErrors = [...closingErrors.data, ...pending.filter((row) => !closingErrors.data.some((saved) => saved.id === row.id))];
      for (const item of state.queue.filter((entry) => entry.kind === "update" && entry.table === "fc_closing_errors")) {
        const row = state.closingErrors.find((entry) => entry.id === item.where.id);
        if (row) Object.assign(row, item.values);
      }
    }
    state.generalReady = !generalRoutines.error && !generalEvents.error && !generalNotes.error;
    state.generalError = generalRoutines.error?.message || generalEvents.error?.message || generalNotes.error?.message || "";
    if (state.generalReady) {
      const queuedRoutines = state.queue.filter((item) => item.kind === "insert" && item.table === "fc_general_routines").map((item) => item.row);
      state.generalRoutines = [...generalRoutines.data, ...queuedRoutines.filter((row) => !generalRoutines.data.some((saved) => saved.id === row.id))
        .map((row) => ({ status: "Não iniciada", total_seconds: 0, started_at: null, first_started_at: null, finished_at: null, ...row }))];
      state.generalEvents = [...generalEvents.data];
      for (const item of state.queue.filter((entry) => entry.kind === "rpc" && ["fc_apply_general_routine", "fc_set_general_recurrence"].includes(entry.name))) {
        const args = item.args, routine = state.generalRoutines.find((row) => row.id === args.p_routine_id);
        if (!routine) continue;
        if (item.name === "fc_set_general_recurrence") {
          Object.assign(routine, { recurrence_frequency: args.p_frequency, next_scheduled_date: args.p_next_scheduled_date,
            recurrence_day: args.p_next_scheduled_date ? (routine.recurrence_frequency === "monthly" && routine.next_scheduled_date === args.p_next_scheduled_date
              ? routine.recurrence_day : Number(args.p_next_scheduled_date.slice(-2))) : null });
          continue;
        }
        if (state.generalEvents.some((event) => event.id === args.p_event_id)) continue;
        Object.assign(routine, nextGeneralRoutineState(routine, args.p_action, args.p_occurred_at));
        state.generalEvents.push({ id: args.p_event_id, routine_id: args.p_routine_id, action: args.p_action, actor_id: state.member?.id || state.session.user.id, occurred_at: args.p_occurred_at });
      }
      const queuedNotes = state.queue.filter((item) => item.kind === "insert" && item.table === "fc_general_routine_notes").map((item) => item.row);
      state.generalNotes = [...generalNotes.data, ...queuedNotes.filter((row) => !generalNotes.data.some((saved) => saved.id === row.id))];
    }
    state.historyLoaded = true;
    state.member = members.find((person) => person.id === state.session.user.id && person.active) || null;
    if (state.member?.is_admin) {
      try {
        [state.releaseNotes, state.corrections] = await Promise.all([allRows("fc_release_notes"), allRows("fc_activity_corrections")]);
        state.adminDataError = "";
      } catch (error) { state.adminDataError = `Os registros administrativos ainda não estão disponíveis: ${error.message || error}`; }
    } else { state.releaseNotes = []; state.corrections = []; state.adminDataError = ""; }
    state.error = state.member ? "" : "Seu acesso ao fechamento ainda não foi liberado pelo administrador.";
    state.ready = true; saveCache(); render();
    if (state.queue.length) void flush();
    if (state.receiptFeatureReady) void syncReceiptPending();
  } catch (error) {
    state.error = `Não foi possível carregar os dados: ${error.message || error}. Se a migração ainda não foi aplicada, aguarde a configuração.`;
    state.ready = true; render();
  }
}
function monthOptions() {
  const list = [];
  const latestCopiedYear = state.owners.reduce((latest, item) => Math.max(latest, Number(item.competence?.slice(0, 4) || 0)), 0);
  for (let year = 2026; year <= Math.max(2028, new Date().getFullYear() + 2, latestCopiedYear); year++) for (let month = 1; month <= 12; month++) list.push(`${year}-${String(month).padStart(2, "0")}`);
  return list.map((month) => `<option value="${month}" ${month === state.month ? "selected" : ""}>${esc(monthName(month))}</option>`).join("");
}
function memberName(id, legacy) { return state.members.find((item) => item.id === id)?.name || legacy || "A definir"; }
function companyName(id) { return state.companies.find((item) => item.id === id)?.name || "Empresa não encontrada"; }
function taskState(id) { return state.states.find((item) => item.task_id === id && item.competence === state.month); }
function targetFor(company) {
  return state.targets.find((item) => item.company_id === company.id && item.competence === state.month)
    || { company_id: company.id, competence: state.month, category: company.category, sort_order: 9999, business_day: null, planned_date: null, delivery_at: null };
}
function receiptFor(companyId, department) {
  return state.receipts.find((item) => item.company_id === companyId && item.competence === state.month && item.department === department);
}
function isHistorical() { return state.month < legacyCutoff; }
function ownerFor(taskId, competence = state.month) { return state.owners.find((item) => item.task_id === taskId && item.competence === competence); }
function taskLabelFor(task, competence = state.month) {
  const edit = (state.taskLabelEdits || []).filter((item) => item.task_id === task.id && item.effective_competence <= competence)
    .sort((a, b) => b.effective_competence.localeCompare(a.effective_competence)
      || String(b.changed_at).localeCompare(String(a.changed_at)) || String(b.id).localeCompare(String(a.id)))[0];
  return { account: edit?.new_account ?? task.account, group_name: edit?.new_group_name ?? task.group_name };
}
function taskInMonth(task, competence = state.month) {
  return (task.created_competence || legacyCutoff) <= competence
    && (task.active || Boolean(task.retired_competence))
    && (!task.retired_competence || competence < task.retired_competence)
    && (competence < "2026-11" || task.created_competence === competence
      || Boolean(ownerFor(task.id, competence))
      || state.states.some((item) => item.task_id === task.id && item.competence === competence
        && (item.status !== "Não iniciado" || item.total_seconds > 0 || item.first_started_at || item.finished_at)));
}
function monthlyTasks() {
  if (isHistorical()) return state.history.filter((item) => item.competence === state.month).map((item) => ({ ...item, company_name: item.company, owner_name: item.owner_name, historic: true }));
  return state.tasks.filter((item) => taskInMonth(item)).map((item) => {
    const owner = ownerFor(item.id);
    return { ...item, ...taskLabelFor(item), responsible_id: owner?.responsible_id || null, responsible_legacy_name: owner?.responsible_legacy_name || null,
      company_name: companyName(item.company_id), owner_name: memberName(owner?.responsible_id, owner?.responsible_legacy_name) };
  });
}
function myMonthlyTasks() {
  if (!state.member) return [];
  const normalizedName = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  const myName = normalizedName(state.member.name);
  const uniqueHistoricalName = myName && state.members.filter((person) => normalizedName(person.name) === myName).length === 1;
  return monthlyTasks().filter((task) => task.responsible_id === state.member.id
    || (task.historic && !task.responsible_id && uniqueHistoricalName && normalizedName(task.owner_name) === myName));
}
function statusOf(task) { return task.historic ? task.status || "Não iniciado" : taskState(task.id)?.status || "Não iniciado"; }
function executionGroup(task) { return task.group_name?.trim() || "OUTROS"; }
function badge(status) {
  const tone = status === "Finalizado" || status === "Concluída" ? "done" : status === "Em andamento" ? "running" : status === "Pausado" ? "paused" : "not-started";
  return `<span class="badge ${tone}">${esc(status)}</span>`;
}
function renderAuth() {
  const passwordForm = state.needsPassword && state.session;
  $("#app").innerHTML = `<div class="auth-screen"><div class="auth-box"><div class="brand"><img class="brand-logo" src="brand/logo-principal.png" alt="Grupo Cavalca"><strong>Fechamento contábil</strong></div>
    <h1 style="font-size:23px;margin-top:22px">${passwordForm ? "Defina sua senha" : "Acesse o painel"}</h1>
    <p>${passwordForm ? "No primeiro acesso, escolha uma senha exclusiva para sua conta." : "Entre com o e-mail cadastrado pelo administrador."}</p>
    <form id="auth-form">${passwordForm ? "" : '<label class="field"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="email" required></label>'}
    <label class="field"><span>${passwordForm ? "Nova senha" : "Senha"}</span><input class="input" name="password" type="password" minlength="8" autocomplete="${passwordForm ? "new-password" : "current-password"}" required></label>
    ${passwordForm ? '<label class="field"><span>Confirmar senha</span><input class="input" name="confirm" type="password" minlength="8" autocomplete="new-password" required></label>' : ""}
    <button class="btn primary" type="submit">${passwordForm ? "Definir senha" : "Entrar"}</button></form>
    ${passwordForm ? "" : '<button class="btn" style="margin-top:12px;width:100%" data-action="forgot-password">Esqueci minha senha</button>'}
    <p id="auth-error" style="color:#b91c1c;margin-top:12px">${expiredAuthLink && !passwordForm ? "O link de convite ou recuperação expirou. Entre com sua senha ou peça um novo link ao administrador." : ""}</p></div></div>`;
}
function renderGeneralCards() {
  const items = monthlyTasks();
  const completed = items.filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length;
  const running = items.filter((item) => statusOf(item) === "Em andamento").length;
  const seconds = isHistorical() ? 0 : state.states.filter((item) => item.competence === state.month).reduce((sum, item) => sum + currentSeconds(item), 0);
  const received = state.receipts.filter((item) => item.competence === state.month && item.status === "Recebido").length;
  const closedCompanies = state.companies.filter((company) => company.active).filter((company) => {
    const rows = items.filter((item) => item.company_id === company.id);
    return rows.length && rows.every((item) => ["Finalizado", "Concluída"].includes(statusOf(item)));
  }).length;
  return `<div class="grid cards"><div class="card"><span>Atividades</span><strong>${items.length}</strong><small>${completed} finalizadas</small></div>
    <div class="card"><span>Em andamento</span><strong>${running}</strong><small>Rotinas em execução</small></div>
    <div class="card"><span>Tempo registrado</span><strong class="live-total">${isHistorical() ? "—" : duration(seconds)}</strong><small>Soma das conciliações</small></div>
    <div class="card"><span>Progresso geral</span><strong>${items.length ? Math.round(100 * completed / items.length) : 0}%</strong><small>${closedCompanies} empresas encerradas · ${received} documentos recebidos</small></div></div>`;
}
function businessDaysToClose(competence, closeDate) {
  if (!closeDate) return null;
  const start = `${adjacentCompetence(competence, 1)}-01`;
  if (closeDate < start) return 0;
  const excludedByYear = new Map();
  let count = 0;
  for (let date = new Date(`${start}T00:00:00Z`); date.toISOString().slice(0, 10) <= closeDate; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    const year = date.getUTCFullYear();
    if (!excludedByYear.has(year)) excludedByYear.set(year, holidayDates(year));
    if (![0, 6].includes(date.getUTCDay()) && !excludedByYear.get(year).has(day)) count++;
  }
  return count;
}
function closingPerformance(year) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(state.tick));
  const companyCategories = new Map(state.companies.map((company) => [company.id, company.category]));
  const category = (goal) => companyCategories.get(goal.company_id) || goal.category;
  const groups = (targets) => {
    const aggregate = (rows) => {
      const days = rows.map((goal) => {
        const closeDate = closingDate(goal);
        return closeDate && closeDate <= today ? businessDaysToClose(goal.competence, closeDate) : null;
      }).filter((value) => value !== null);
      return { total: rows.length, closed: days.length, days: days.reduce((sum, value) => sum + value, 0), late: days.filter((value) => value > 11).length,
        average: days.length ? days.reduce((sum, value) => sum + value, 0) / days.length : null };
    };
    return { holding: aggregate(targets.filter((goal) => category(goal) === "HOLDING")), demais: aggregate(targets.filter((goal) => category(goal) === "DEMAIS")), geral: aggregate(targets) };
  };
  const months = [...new Set(state.targets.filter((goal) => goal.competence.startsWith(`${year}-`) && goal.competence <= state.month).map((goal) => goal.competence))].sort();
  return { months: months.map((month) => ({ month, ...groups(state.targets.filter((goal) => goal.competence === month)) })),
    total: groups(state.targets.filter((goal) => months.includes(goal.competence))) };
}
function renderClosingPerformance() {
  const year = state.month.slice(0, 4);
  const report = closingPerformance(year);
  const target = year === "2026" ? 11 : null;
  if (!report.months.length) return `<section class="panel closing-performance"><div class="panel-head"><div><h2>Prazo de fechamento · ${esc(year)}</h2><p>Sem encerramentos cadastrados neste ano.</p></div></div></section>`;
  const scale = Math.max(target || 0, ...report.months.flatMap((row) => [row.holding.average || 0, row.demais.average || 0, row.geral.average || 0]));
  const maximum = Math.max(12, Math.ceil(scale / 5) * 5);
  const metric = (item, label, tone) => `<div class="closing-metric"><span>${label}</span><div class="closing-track">${target ? `<i class="closing-target" style="left:${100 * target / maximum}%" aria-hidden="true"></i>` : ""}<b class="closing-fill ${tone}" style="width:${item.average === null ? 0 : Math.min(100, 100 * item.average / maximum)}%"></b></div><strong>${item.average === null ? "—" : item.average.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} d.u.</strong><small>${item.closed}/${item.total}</small></div>`;
  const status = (item) => target === null ? "Sem meta definida" : item.late ? `${item.late} fora da meta` : item.closed < item.total ? `${item.total - item.closed} pendente(s)` : "Meta cumprida";
  const row = (label, data) => `<div class="closing-row"><div class="closing-month"><strong>${esc(label)}</strong><small>${status(data.geral)}</small></div><div class="closing-bars">${metric(data.holding, "Holding", "holding")}${metric(data.demais, "Demais", "demais")}${metric(data.geral, "Total", "overall")}</div></div>`;
  const period = `janeiro a ${monthName(state.month)}`;
  const legend = `<div class="closing-legend"><span><i class="holding"></i>HOLDING</span><span><i class="demais"></i>DEMAIS</span><span><i class="overall"></i>Total</span>${target ? `<span><i class="target"></i>Meta ${target} d.u.</span>` : ""}</div>`;
  return `<section class="panel closing-performance"><div class="panel-head"><div><h2>Prazo de fechamento · acumulado</h2><p>${esc(period)} · ${target ? `meta: até ${target} dias úteis para todas as empresas` : "meta ainda não definida para este ano"}</p></div></div>
    <div class="panel-body closing-compact">${legend}<div class="closing-bars">${metric(report.total.holding, "Holding", "holding")}${metric(report.total.demais, "Demais", "demais")}${metric(report.total.geral, "Total", "overall")}</div><small class="closing-summary-status">${status(report.total.geral)} · ${report.total.geral.closed}/${report.total.geral.total} empresas encerradas</small></div>
    <details class="closing-monthly"><summary>Ver desempenho mês a mês</summary><div class="closing-monthly-content"><div class="closing-monthly-heading"><div><h3>Resultado mensal · ${esc(period)}</h3><p>Comparativo de dias úteis por grupo de empresas</p></div><button class="btn compact no-print" data-action="print-closing-monthly" type="button">Imprimir / PDF</button></div>
    <div class="closing-print-brand"><img src="brand/logo-principal.png" alt="Grupo Cavalca"><div><small>GRUPO CAVALCA · CONTABILIDADE</small><h1>Prazo de fechamento · ${esc(period)}</h1></div></div>
    ${legend}${report.months.map((item) => row(monthName(item.month).split(" de ")[0], item)).join("")}
    <p class="closing-note">Contagem desde o primeiro dia útil do mês seguinte à competência, incluindo o dia do encerramento e excluindo sábados, domingos e feriados nacionais e de Cascavel/PR. Médias consideram apenas empresas encerradas; pendentes aparecem na contagem e não tornam a meta cumprida.</p></div></details></section>`;
}
function renderPanel() {
  const items = monthlyTasks();
  const slowest = isHistorical() ? [] : items.map((item) => ({ ...item, seconds: currentSeconds(taskState(item.id)) })).filter((item) => item.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 8);
  const activeCompanies = state.companies.filter((item) => item.active);
  const companyStats = activeCompanies.map((company) => { const rows = items.filter((item) => item.company_id === company.id); return { name: company.name, total: rows.length, done: rows.filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length, seconds: rows.reduce((sum, item) => sum + currentSeconds(taskState(item.id)), 0) }; }).filter((item) => item.total);
  const personStats = state.members.filter((item) => item.active).map((person) => { const rows = items.filter((item) => item.responsible_id === person.id); return { name: person.name, total: rows.length, done: rows.filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length, seconds: rows.reduce((sum, item) => sum + currentSeconds(taskState(item.id)), 0) }; }).filter((item) => item.total).sort((a, b) => b.seconds - a.seconds || b.done - a.done);
  const groupStats = [...new Set(items.map((item) => item.group_name || "OUTROS"))].map((name) => { const rows = items.filter((item) => (item.group_name || "OUTROS") === name); return { name, total: rows.length, done: rows.filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length, seconds: rows.reduce((sum, item) => sum + currentSeconds(taskState(item.id)), 0) }; }).sort((a, b) => b.seconds - a.seconds);
  const statRows = (rows, mode) => rows.length ? rows.map((item) => `<div class="chart-row"><div class="chart-label"><span>${esc(item.name)}</span><strong>${mode === "time" ? duration(item.seconds) : `${item.done}/${item.total}`}</strong></div><div class="chart-track"><div class="chart-fill ${mode === "time" ? "time" : ""}" style="width:${mode === "time" ? Math.max(item.seconds ? 2 : 0, Math.round(100 * item.seconds / Math.max(1, ...rows.map((row) => row.seconds)))) : Math.round(100 * item.done / item.total)}%"></div></div><small>${mode === "time" ? `${item.done} de ${item.total} concluídas` : `${Math.round(100 * item.done / item.total)}% concluído · ${duration(item.seconds)}`}</small></div>`).join("") : '<div class="empty">Ainda não há dados para este indicador.</div>';
  return `${renderGeneralCards()}${renderClosingPerformance()}
    <div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Progresso por empresa</h2><p>Itens finalizados e tempo de trabalho</p></div></div><div class="panel-body chart-list">${statRows(companyStats, "progress")}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>Indicadores por pessoa</h2><p>Responsabilidades e horas registradas</p></div></div><div class="panel-body chart-list">${statRows(personStats, "progress")}</div></section></div>
    <div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Tempo por tipo de tarefa</h2><p>Grupos de contas e rotinas</p></div></div><div class="panel-body chart-list">${statRows(groupStats, "time")}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>Conciliações mais demoradas</h2><p>Tempo cronometrado em PLAY/PAUSE/STOP</p></div></div><div class="panel-body slow-list">
    ${slowest.length ? slowest.map((item) => `<div class="slow-row"><span title="${esc(item.company_name)}">${esc(item.account)}<small>${esc(item.company_name)}</small></span><strong>${duration(item.seconds)}</strong></div>`).join("") : '<div class="empty">Os tempos aparecerão após o primeiro PLAY.</div>'}</div></section></div>`;
}
function renderMyPanel() {
  if (canViewTeamTimeAnalysis()) return renderTulioPanel();
  const items = myMonthlyTasks();
  const done = items.filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length;
  const running = items.filter((item) => statusOf(item) === "Em andamento").length;
  const paused = items.filter((item) => statusOf(item) === "Pausado").length;
  const secondsFor = (item) => item.historic ? 0 : currentSeconds(taskState(item.id));
  const seconds = items.reduce((sum, item) => sum + secondsFor(item), 0);
  const statsFor = (name, rows) => ({ name, total: rows.length, done: rows.filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length,
    seconds: rows.reduce((sum, item) => sum + secondsFor(item), 0) });
  const companies = [...new Set(items.map((item) => item.company_name))].map((name) => statsFor(name, items.filter((item) => item.company_name === name)))
    .sort((a, b) => b.total - b.done - (a.total - a.done) || a.name.localeCompare(b.name, "pt-BR"));
  const groups = [...new Set(items.map(executionGroup))].map((name) => statsFor(name, items.filter((item) => executionGroup(item) === name)))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name, "pt-BR"));
  const chartRows = (rows, mode) => rows.length ? rows.map((item) => `<div class="chart-row"><div class="chart-label"><span title="${esc(item.name)}">${esc(item.name)}</span><strong>${mode === "time" ? duration(item.seconds) : `${item.done}/${item.total}`}</strong></div>
    <div class="chart-track"><div class="chart-fill ${mode === "time" ? "time" : ""}" style="width:${mode === "time" ? Math.max(item.seconds ? 2 : 0, Math.round(100 * item.seconds / Math.max(1, ...rows.map((row) => row.seconds)))) : Math.round(100 * item.done / item.total)}%"></div></div>
    <small>${mode === "time" ? `${item.done} de ${item.total} finalizadas` : `${Math.round(100 * item.done / item.total)}% concluído${isHistorical() ? "" : ` · ${duration(item.seconds)}`}`}</small></div>`).join("")
    : '<div class="empty">Ainda não há rotinas atribuídas para este indicador.</div>';
  const ordered = [...items].sort((a, b) => Number(["Finalizado", "Concluída"].includes(statusOf(a))) - Number(["Finalizado", "Concluída"].includes(statusOf(b)))
    || a.company_name.localeCompare(b.company_name, "pt-BR") || a.account.localeCompare(b.account, "pt-BR"));
  return `<section class="panel"><div class="panel-head"><div><h2>Meu Painel · ${esc(monthName(state.month))}</h2><p>Somente rotinas atribuídas a ${esc(state.member.name)}.</p></div></div></section>
    <div class="grid cards"><div class="card"><span>Minhas atividades</span><strong>${items.length}</strong><small>${done} finalizadas</small></div>
    <div class="card"><span>Em andamento</span><strong>${running}</strong><small>${paused} pausadas</small></div>
    <div class="card"><span>Meu tempo registrado</span><strong>${isHistorical() ? "—" : duration(seconds)}</strong><small>Apontamentos das minhas rotinas</small></div>
    <div class="card"><span>Meu progresso</span><strong>${items.length ? Math.round(100 * done / items.length) : 0}%</strong><small>${items.length - done} atividades por concluir</small></div></div>${renderClosingPerformance()}
    <div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Minhas tarefas por empresa</h2><p>Conclusão das rotinas atribuídas a você</p></div></div><div class="panel-body chart-list">${chartRows(companies, "progress")}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>Meu tempo por grupo sintético</h2><p>Horas registradas por tipo de tarefa</p></div></div><div class="panel-body chart-list">${isHistorical() ? '<div class="empty">O tempo não está disponível para competências históricas.</div>' : chartRows(groups, "time")}</div></section></div>
    <section class="panel"><div class="panel-head"><div><h2>Minhas rotinas</h2><p>Atividades atribuídas a você na competência selecionada</p></div><button class="btn compact" data-action="my-execution" ${items.length && !isHistorical() ? "" : "disabled"}>Abrir minhas tarefas em Execução</button></div>
    ${ordered.length ? `<div class="table-wrap my-tasks-wrap"><table class="my-tasks-table"><thead><tr><th>Conta / grupo</th><th>Empresa</th><th>Status</th><th>Tempo</th></tr></thead><tbody>${ordered.map((item) => `<tr><td><strong>${esc(item.account)}</strong><small>${esc(executionGroup(item))}</small></td><td>${esc(item.company_name)}</td><td>${badge(statusOf(item))}</td><td>${item.historic ? "—" : duration(secondsFor(item))}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty">Você não possui rotinas atribuídas nesta competência. Se isso estiver incorreto, confira o responsável na tela Execução.</div>'}</section>`;
}
function dashboardCompanyKey(task) { return task.company_id || task.company_name; }
function dashboardCompanyOptions(tasks) {
  return [...new Map(tasks.map((task) => [dashboardCompanyKey(task), { id: dashboardCompanyKey(task), name: task.company_name }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
function renderDashboardCompanyFilter(id, options, selected, dataName) {
  const label = selected.length ? selected.length === 1 ? options.find((company) => company.id === selected[0])?.name : `${selected.length} empresas selecionadas` : "Todas as empresas";
  return `<details id="${id}" class="multi-filter dashboard-company-filter"><summary class="select" aria-label="Filtrar empresas">${esc(label || "Todas as empresas")}</summary><div class="multi-filter-menu" role="group" aria-label="Empresas">${options.map((company) => `<label><input type="checkbox" ${dataName}="${esc(company.id)}" ${selected.includes(company.id) ? "checked" : ""}>${esc(company.name)}</label>`).join("")}<button type="button" class="btn compact" data-action="clear-${id}" ${selected.length ? "" : "disabled"}>Mostrar todas as empresas</button></div></details>`;
}
function renderTulioPanel() {
  const all = monthlyTasks();
  const options = dashboardCompanyOptions(all);
  const selected = (state.myPanelCompanyFilters || []).filter((id) => options.some((company) => company.id === id));
  const visible = all.filter((task) => !selected.length || selected.includes(dashboardCompanyKey(task)));
  const secondsFor = (task) => task.historic ? 0 : currentSeconds(taskState(task.id));
  const statsFor = (name, rows) => ({ name, total: rows.length, done: rows.filter((task) => ["Finalizado", "Concluída"].includes(statusOf(task))).length,
    seconds: rows.reduce((sum, task) => sum + secondsFor(task), 0) });
  const companies = dashboardCompanyOptions(visible).map((company) => statsFor(company.name, visible.filter((task) => dashboardCompanyKey(task) === company.id)))
    .sort((a, b) => b.total - b.done - (a.total - a.done) || a.name.localeCompare(b.name, "pt-BR"));
  const groups = [...new Set(visible.map(executionGroup))].map((name) => statsFor(name, visible.filter((task) => executionGroup(task) === name)))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name, "pt-BR"));
  const chartRows = (rows, mode) => rows.length ? rows.map((item) => `<div class="chart-row"><div class="chart-label"><span title="${esc(item.name)}">${esc(item.name)}</span><strong>${mode === "time" ? duration(item.seconds) : `${item.done}/${item.total}`}</strong></div>
    <div class="chart-track"><div class="chart-fill ${mode === "time" ? "time" : ""}" style="width:${mode === "time" ? Math.max(item.seconds ? 2 : 0, Math.round(100 * item.seconds / Math.max(1, ...rows.map((row) => row.seconds)))) : Math.round(100 * item.done / item.total)}%"></div></div>
    <small>${mode === "time" ? `${item.done} de ${item.total} finalizadas` : `${Math.round(100 * item.done / item.total)}% concluído${isHistorical() ? "" : ` · ${duration(item.seconds)}`}`}</small></div>`).join("")
    : '<div class="empty">Ainda não há rotinas para as empresas selecionadas.</div>';
  const mine = myMonthlyTasks().sort((a, b) => Number(["Finalizado", "Concluída"].includes(statusOf(a))) - Number(["Finalizado", "Concluída"].includes(statusOf(b)))
    || a.company_name.localeCompare(b.company_name, "pt-BR") || a.account.localeCompare(b.account, "pt-BR"));
  const pending = mine.filter((task) => !["Finalizado", "Concluída"].includes(statusOf(task))).length;
  return `<section class="panel"><div class="panel-head"><div><h2>Meu Painel · ${esc(monthName(state.month))}</h2><p>Visão geral do fechamento para ${esc(state.member.name)}; suas rotinas ficam no quadro recolhido abaixo.</p></div></div></section>
    ${renderGeneralCards()}${renderClosingPerformance()}
    <section class="panel my-company-toolbar"><div class="panel-head"><div><h2>Filtrar os gráficos por empresa</h2><p>Selecione uma ou mais empresas; os quatro indicadores acima continuam gerais.</p></div>${renderDashboardCompanyFilter("my-panel-company-filter", options, selected, "data-my-company-filter")}</div></section>
    <div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Tarefas por empresa</h2><p>Conclusão das rotinas das empresas selecionadas</p></div></div><div class="panel-body chart-list">${chartRows(companies, "progress")}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>Tempo por grupo sintético</h2><p>Horas registradas pela equipe nas empresas selecionadas</p></div></div><div class="panel-body chart-list">${isHistorical() ? '<div class="empty">O tempo não está disponível para competências históricas.</div>' : chartRows(groups, "time")}</div></section></div>
    <details class="panel my-routines-collapsed"><summary class="panel-head"><span><strong>Minhas rotinas</strong><small>${mine.length ? `${mine.length} tarefa(s) vinculada(s) · ${pending} pendente(s)` : "Nenhuma tarefa vinculada nesta competência"}</small></span>${mine.length ? `<span class="my-task-alert" role="status">${mine.length} vinculada(s)</span>` : ""}<span class="my-routines-chevron" aria-hidden="true">▾</span></summary>
    <div class="my-routines-body"><div class="panel-head"><p>Atividades atribuídas diretamente a você</p><button class="btn compact" data-action="my-execution" ${mine.length && !isHistorical() ? "" : "disabled"}>Abrir minhas tarefas em Execução</button></div>
    ${mine.length ? `<div class="table-wrap my-tasks-wrap"><table class="my-tasks-table"><thead><tr><th>Conta / grupo</th><th>Empresa</th><th>Status</th><th>Tempo</th></tr></thead><tbody>${mine.map((task) => `<tr><td><strong>${esc(task.account)}</strong><small>${esc(executionGroup(task))}</small></td><td>${esc(task.company_name)}</td><td>${badge(statusOf(task))}</td><td>${task.historic ? "—" : duration(secondsFor(task))}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Nenhuma rotina atribuída ao seu nome nesta competência.</div>'}</div></details>
    ${renderTeamTimeAnalysis()}`;
}
function canViewTeamTimeAnalysis() {
  return Boolean(state.member?.is_admin && state.member.email?.trim().toLocaleLowerCase("pt-BR") === "tulio.dubiella@gmail.com");
}
function renderTeamTimeAnalysis() {
  if (isHistorical()) return `<section class="panel"><div class="panel-head"><div><h2>Tempo por tipo de tarefa e empresa</h2><p>Análise comparativa da equipe · acesso exclusivo do Tulio administrador</p></div></div><div class="empty">Os tempos de execução não estão disponíveis para competências históricas.</div></section>`;
  const tasks = monthlyTasks();
  const options = dashboardCompanyOptions(tasks);
  const selected = (state.analysisCompanyFilters || []).filter((id) => options.some((company) => company.id === id));
  const visible = tasks.filter((task) => !selected.length || selected.includes(dashboardCompanyKey(task)));
  const byGroupCompany = new Map();
  const measured = [];
  for (const task of visible) {
    const group = executionGroup(task);
    const company = task.company_name || "Empresa não informada";
    const key = JSON.stringify([group, task.company_id || company]);
    if (!byGroupCompany.has(key)) byGroupCompany.set(key, { group, company, total: 0, completed: 0, seconds: 0, completedSeconds: 0 });
    const row = byGroupCompany.get(key);
    const status = statusOf(task);
    const seconds = currentSeconds(taskState(task.id));
    row.total += 1;
    row.seconds += seconds;
    if (status === "Finalizado" || status === "Concluída") { row.completed += 1; row.completedSeconds += seconds; }
    if (seconds > 0) measured.push({ ...task, group, status, seconds });
  }
  const rows = [...byGroupCompany.values()].sort((a, b) => a.group.localeCompare(b.group, "pt-BR") || b.seconds - a.seconds || a.company.localeCompare(b.company, "pt-BR"));
  const maxima = new Map();
  for (const row of rows) maxima.set(row.group, Math.max(maxima.get(row.group) || 0, row.seconds));
  const slowest = measured.sort((a, b) => b.seconds - a.seconds || a.company_name.localeCompare(b.company_name, "pt-BR")).slice(0, 15);
  return `<section class="panel analysis-panel"><div class="panel-head"><div><h2>Tempo por tipo de tarefa e empresa</h2><p>Comparação de todas as rotinas da equipe na competência ${esc(monthName(state.month))} · exclusivo do seu acesso de administrador</p></div>
    ${renderDashboardCompanyFilter("analysis-company-filter", options, selected, "data-analysis-company-filter")}</div>
    <div class="analysis-note">Tempo total inclui rotinas em andamento. A média considera apenas as rotinas finalizadas, para facilitar a comparação entre empresas.</div>
    ${rows.length ? `<div class="table-wrap analysis-table-wrap"><table class="analysis-table"><thead><tr><th>Tipo de tarefa</th><th>Empresa</th><th>Finalizadas / total</th><th>Tempo total</th><th>Média por rotina finalizada</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${esc(row.group)}</strong></td><td>${esc(row.company)}</td><td>${row.completed}/${row.total}</td><td><strong>${duration(row.seconds)}</strong><span class="analysis-bar"><span style="width:${Math.round(100 * row.seconds / Math.max(1, maxima.get(row.group)))}%"></span></span></td><td>${row.completed ? duration(row.completedSeconds / row.completed) : "—"}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Não há rotinas nesta competência para as empresas selecionadas.</div>'}</section>
    <section class="panel"><div class="panel-head"><div><h2>Conciliações mais demoradas por empresa</h2><p>As 15 rotinas com mais tempo registrado nas empresas selecionadas; inclui atividades em andamento</p></div></div>
    ${slowest.length ? `<div class="table-wrap analysis-table-wrap"><table class="analysis-table"><thead><tr><th>Conta / atividade</th><th>Tipo de tarefa</th><th>Empresa</th><th>Responsável</th><th>Status</th><th>Tempo</th></tr></thead><tbody>${slowest.map((task) => `<tr><td><strong>${esc(task.account)}</strong></td><td>${esc(task.group)}</td><td>${esc(task.company_name)}</td><td>${esc(task.owner_name || "—")}</td><td>${badge(task.status)}</td><td><strong>${duration(task.seconds)}</strong></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Os tempos aparecerão após o primeiro PLAY das rotinas das empresas selecionadas.</div>'}</section>`;
}
function renderExecution() {
  const monthTasks = monthlyTasks();
  const copyTarget = state.member?.is_admin && state.month >= "2026-09" ? adjacentCompetence(state.month, 1) : null;
  const tasks = monthTasks.filter((item) => {
    const text = `${item.account} ${item.group_name || ""} ${item.company_name} ${item.owner_name}`.toLocaleLowerCase("pt-BR");
    return text.includes(state.query.toLocaleLowerCase("pt-BR")) && (!state.companyFilter || item.company_id === state.companyFilter)
      && (!state.ownerFilter || item.responsible_id === state.ownerFilter);
  });
  const alphabetical = new Intl.Collator("pt-BR", { sensitivity: "base" });
  const groups = [...new Set(monthTasks.map(executionGroup))].sort(alphabetical.compare);
  const companies = state.companies.filter((item) => item.active).sort((a, b) => alphabetical.compare(a.name, b.name));
  const members = state.members.filter((item) => item.active).sort((a, b) => alphabetical.compare(a.name, b.name));
  const memberOptions = members.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
  const statusLabel = state.statusFilters.length ? state.statusFilters.length === 1 ? state.statusFilters[0] : `${state.statusFilters.length} status selecionados` : "Todos os status";
  const groupLabel = state.groupFilters.length ? state.groupFilters.length === 1 ? state.groupFilters[0] : `${state.groupFilters.length} grupos selecionados` : "Todos os grupos sintéticos";
  return `<section class="panel execution-panel"><div class="filters execution-filters"><input id="search" class="input" placeholder="Buscar conta, empresa, grupo…" value="${esc(state.query)}">
    <select id="company-filter" class="select"><option value="">Todas as empresas</option>${companies.map((item) => `<option value="${esc(item.id)}" ${state.companyFilter === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>
    <select id="owner-filter" class="select"><option value="">Todos os responsáveis</option>${members.map((item) => `<option value="${esc(item.id)}" ${state.ownerFilter === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>
    <details id="group-filter" class="multi-filter"><summary class="select" aria-label="Filtrar por grupo sintético">${esc(groupLabel)}</summary><div class="multi-filter-menu" role="group" aria-label="Grupos sintéticos">${groups.map((item) => `<label><input type="checkbox" data-group-filter="${esc(item)}" ${state.groupFilters.includes(item) ? "checked" : ""}>${esc(item)}</label>`).join("")}<button type="button" class="btn compact" data-action="clear-group-filter" ${state.groupFilters.length ? "" : "disabled"}>Mostrar todos os grupos</button></div></details>
    <details id="status-filter" class="multi-filter"><summary class="select" aria-label="Filtrar por status">${esc(statusLabel)}</summary><div class="multi-filter-menu" role="group" aria-label="Status das atividades">${executionStatuses.map((item) => `<label><input type="checkbox" data-status-filter="${esc(item)}" ${state.statusFilters.includes(item) ? "checked" : ""}>${esc(item)}</label>`).join("")}<button type="button" class="btn compact" data-action="clear-status-filter" ${state.statusFilters.length ? "" : "disabled"}>Mostrar todos os status</button></div></details></div>
    ${state.member?.is_admin && state.month >= "2026-09" ? `<div class="execution-copy-toolbar"><div><strong>Cópia mensal da lista</strong><small>Leva cadastros e responsáveis de ${esc(monthName(state.month))} para ${esc(monthName(copyTarget))}, sem copiar status, horas ou registros. Novas cópias acrescentam tarefas ausentes sem alterar as já existentes no destino.</small></div><button class="btn primary" data-action="copy-month-tasks" ${!monthTasks.length || !state.online || state.queue.length ? "disabled" : ""}>Copiar rotinas para ${esc(monthName(copyTarget))}</button></div>` : ""}
    ${state.month >= "2026-11" && !monthTasks.length ? `<div class="notice warn">A lista de ${esc(monthName(state.month))} ainda não foi copiada. Selecione ${esc(monthName(adjacentCompetence(state.month, -1)))} e use o botão de cópia na tela de Execução.</div>` : ""}
    ${state.member?.is_admin && !state.taskLabelsReady ? `<div class="notice warn">A edição do nome das rotinas ainda não está disponível: ${esc(state.taskLabelsError || "aguarde a sincronização")}</div>` : ""}
    ${state.executionOwnerWarning ? '<div class="notice warn owner-play-warning" role="alert">Esta tarefa não pode ser iniciada sem um responsável definido. Selecione um responsável na coluna correspondente antes de usar PLAY.</div>' : ""}
    <div class="table-wrap"><table class="execution-table"><thead><tr><th>Conta / grupo</th><th>Empresa</th><th>Responsável</th><th>Status</th><th>Tempo</th><th>Início · Brasília</th><th>Fim · Brasília</th><th>Execução</th><th>Manutenção</th></tr></thead>
    <tbody>${tasks.map((task) => { const activity = task.historic ? null : taskState(task.id); const filterStatus = statusOf(task) === "Concluída" ? "Finalizado" : statusOf(task); const commentCount = state.commentsMonth === state.month ? (state.taskComments || []).filter((item) => item.task_id === task.id).length : 0; return `<tr data-execution-status="${esc(filterStatus)}" data-execution-group="${esc(executionGroup(task))}"><td data-label="Conta / grupo"><strong>${esc(task.account)}</strong><small>${esc(executionGroup(task))}</small>${task.historic ? "" : `<button class="btn compact comment-open" data-action="open-comments" data-id="${esc(task.id)}" title="Abrir comentários e apontamentos desta atividade">Comentários (${commentCount})</button>`}</td><td data-label="Empresa">${esc(task.company_name)}</td>
      <td data-label="Responsável">${task.historic ? esc(task.owner_name) : `<select class="select" data-action="task-owner" data-id="${esc(task.id)}"><option value="">A definir</option>${memberOptions}</select>${state.executionOwnerWarning === task.id ? '<small class="owner-required">Defina o responsável para iniciar.</small>' : ""}`}</td>
      <td data-label="Status">${badge(statusOf(task))}</td><td data-label="Tempo" class="live-time" data-id="${esc(task.id)}">${task.historic ? "—" : duration(currentSeconds(activity))}</td>
      <td data-label="Início · Brasília">${task.historic ? esc(task.start_date_raw || dateBR(task.start_date)) : brasilia(activity?.first_started_at)}</td><td data-label="Fim · Brasília">${task.historic ? esc(task.end_date_raw || dateBR(task.end_date)) : brasilia(activity?.finished_at)}</td>
      <td data-label="Execução">${task.historic ? "—" : `<div class="actions"><button class="btn compact play" data-action="activity" data-id="${esc(task.id)}" data-kind="play" title="Iniciar">▶ PLAY</button><button class="btn compact pause" data-action="activity" data-id="${esc(task.id)}" data-kind="pause" title="Pausar">Ⅱ PAUSE</button><button class="btn compact stop" data-action="activity" data-id="${esc(task.id)}" data-kind="stop" title="Finalizar">■ STOP</button></div>`}</td>
      <td data-label="Manutenção">${task.historic || !state.member?.is_admin ? "—" : `<div class="actions">${state.taskLabelsReady ? `<button class="btn compact" data-action="edit-task-label" data-id="${esc(task.id)}" title="Corrigir nome e grupo a partir deste mês sem perder os apontamentos">Editar rotina</button>` : ""}${activity?.first_started_at ? `<button class="btn compact" data-action="edit-time" data-id="${esc(task.id)}" title="Corrigir o tempo total com motivo e trilha de auditoria">Editar tempo</button>` : ""}${activity && (activity.status !== "Não iniciado" || activity.total_seconds || activity.first_started_at) ? `<button class="btn compact danger" data-action="reset-activity" data-id="${esc(task.id)}" title="Retirar os apontamentos desta rotina neste mês">Limpar marcação</button>` : ""}<button class="btn compact danger" data-action="retire-task" data-id="${esc(task.id)}" title="Retirar esta rotina do mês selecionado e dos próximos, preservando meses anteriores">Excluir tarefa</button></div>`}</td></tr>`; }).join("")}</tbody></table><div class="empty execution-empty" hidden>Nenhuma atividade neste filtro.</div></div>
    <div class="footer-note">${tasks.length} atividade(s). Os horários são apresentados no fuso de Brasília/DF.</div></section>`;
}
function renderCommentsPanel() {
  const task = monthlyTasks().find((item) => item.id === state.commentTaskId && !item.historic);
  if (!task) return "";
  const comments = state.commentsMonth === state.month
    ? (state.taskComments || []).filter((item) => item.task_id === task.id && item.competence === state.month).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) : [];
  const pendingIds = new Set(state.queue.filter((item) => item.table === "fc_task_comments").map((item) => item.row?.id));
  return `<div class="comment-overlay" role="presentation"><section class="comment-dialog" role="dialog" aria-modal="true" aria-label="Comentários da atividade">
    <div class="panel-head"><div><h2>Comentários e apontamentos</h2><p>${esc(task.account)} · ${esc(task.company_name)} · ${esc(monthName(state.month))}</p></div><button class="btn compact" data-action="close-comments" aria-label="Fechar comentários">Fechar</button></div>
    <div class="comment-list">${comments.length ? comments.map((item) => `<article class="comment-entry"><p>${esc(item.body).replace(/\n/g, "<br>")}</p><small>${esc(memberName(item.author_id, "Usuário removido"))} · ${pendingIds.has(item.id) ? "Aguardando sincronização" : brasilia(item.created_at)}</small></article>`).join("") : '<div class="empty">Ainda não há comentários nesta atividade.</div>'}</div>
    <form id="comment-form" class="comment-form" data-task-id="${esc(task.id)}"><label class="field"><span>Novo comentário / apontamento</span><textarea class="input" name="body" maxlength="2000" rows="4" placeholder="Descreva uma observação sobre esta atividade…" required>${esc(state.commentDrafts[task.id] || "")}</textarea></label>
      <button class="btn primary" type="submit" ${state.collaborationReady ? "" : "disabled"}>Adicionar comentário</button>${state.collaborationError ? `<small class="muted">Comentários indisponíveis: ${esc(state.collaborationError)}</small>` : ""}</form></section></div>`;
}
function applyExecutionFilters() {
  const statusFilter = $("#status-filter"), groupFilter = $("#group-filter");
  if (!statusFilter || !groupFilter) return;
  const statuses = state.statusFilters, groups = state.groupFilters;
  statusFilter.querySelector("summary").textContent = statuses.length ? statuses.length === 1 ? statuses[0] : `${statuses.length} status selecionados` : "Todos os status";
  statusFilter.querySelector('[data-action="clear-status-filter"]').disabled = !statuses.length;
  groupFilter.querySelector("summary").textContent = groups.length ? groups.length === 1 ? groups[0] : `${groups.length} grupos selecionados` : "Todos os grupos sintéticos";
  groupFilter.querySelector('[data-action="clear-group-filter"]').disabled = !groups.length;
  let visible = 0;
  document.querySelectorAll("[data-execution-status]").forEach((row) => {
    const match = (!statuses.length || statuses.includes(row.dataset.executionStatus))
      && (!groups.length || groups.includes(row.dataset.executionGroup));
    row.classList.toggle("hidden", !match);
    if (match) visible++;
  });
  $(".execution-empty").hidden = visible > 0;
  $(".footer-note").textContent = `${visible} atividade(s). Os horários são apresentados no fuso de Brasília/DF.`;
}
function renderGoals() {
  const companies = orderedGoals();
  const pendingCompanies = companies.filter((company) => !companyDeliveriesComplete(company.id));
  const deliveredCompanies = companies.filter((company) => companyDeliveriesComplete(company.id));
  const printRows = companies.map((company, index) => [index + 1, company.name, company.goal.category,
    company.goal.business_day || "—", dateBR(isHistorical() ? company.goal.legacy_deadline : plannedDate(state.month, company.goal.business_day))]);
  const printDensity = companies.length > 52 ? "very-dense" : companies.length > 38 ? "dense" : "";
  const goalTable = (rows) => `<div class="table-wrap"><table class="goals-table"><thead><tr><th>Ordem</th><th>Empresa</th><th>Prioridade</th><th>Dia útil</th><th>Previsão</th><th>Data de entrega</th>${departments.map((item) => `<th>${esc(item)}</th>`).join("")}<th>Mover</th></tr></thead>
    <tbody>${rows.map((company, index) => { const goal = company.goal; return `<tr><td data-label="Ordem"><strong>${companies.findIndex((item) => item.id === company.id) + 1}</strong></td><td data-label="Empresa"><strong>${esc(company.name)}</strong></td>
      <td data-label="Prioridade"><select class="select" data-action="goal-category" data-id="${esc(company.id)}" ${isHistorical() ? "disabled" : ""}><option ${goal.category === "HOLDING" ? "selected" : ""}>HOLDING</option><option ${goal.category === "DEMAIS" ? "selected" : ""}>DEMAIS</option></select></td>
      <td data-label="Dia útil"><input class="input" type="number" min="1" max="23" data-action="goal-day" data-id="${esc(company.id)}" value="${esc(goal.business_day || "")}" ${isHistorical() ? "disabled" : ""}></td>
      <td data-label="Previsão"><strong>${dateBR(isHistorical() ? goal.legacy_deadline : plannedDate(state.month, goal.business_day))}</strong></td><td data-label="Data de entrega">${closingDateLabel(goal)}</td>
      ${departments.map((department) => renderReceiptCell(company, department)).join("")}
      <td data-label="Mover"><div class="actions"><button class="btn compact" data-action="move" data-id="${esc(company.id)}" data-direction="up" ${index === 0 || rows[index - 1].goal.category !== goal.category || isHistorical() ? "disabled" : ""}>↑</button><button class="btn compact" data-action="move" data-id="${esc(company.id)}" data-direction="down" ${index === rows.length - 1 || rows[index + 1].goal.category !== goal.category || isHistorical() ? "disabled" : ""}>↓</button></div></td></tr>`; }).join("")}</tbody></table></div>`;
  return `<section class="panel goals-panel"><div class="panel-head"><div><h2>Entregas pendentes · ${pendingCompanies.length} empresa(s)</h2><p>Ordem mensal de fechamento. HOLDING primeiro; o dia útil programa a data no mês seguinte.</p></div><div class="actions no-print"><button class="btn compact" data-action="print-goals">Imprimir lista / PDF</button><button class="btn compact" data-action="xlsx-goals">Exportar XLSX</button></div></div>
    ${pendingCompanies.length ? goalTable(pendingCompanies) : '<div class="empty">Nenhuma empresa com entrega pendente neste mês.</div>'}
    <div class="footer-note">Uma empresa passa ao quadro abaixo quando Financeiro, RH, Estoque, Fiscal e Balancete estiverem como Recebido ou N/A. Dias úteis excluem fins de semana e feriados cadastrados.</div></section>${renderReceiptPanel()}
    <section class="panel goals-panel"><div class="panel-head"><div><h2>Empresas com entregas concluídas · ${deliveredCompanies.length}</h2><p>Todos os cinco itens foram recebidos ou marcados como N/A. A ordem original é preservada.</p></div></div>
    ${deliveredCompanies.length ? goalTable(deliveredCompanies) : '<div class="empty">As empresas com todas as entregas resolvidas aparecerão aqui.</div>'}</section>
    <section class="print-sheet ${printDensity}"><div class="print-brand"><img src="brand/logo-principal.png" alt="Grupo Cavalca"><div><small>GRUPO CAVALCA · CONTABILIDADE</small><h1>Ordem de fechamento · ${esc(monthName(state.month))}</h1></div></div><table><colgroup><col style="width:6%"><col style="width:51%"><col style="width:16%"><col style="width:10%"><col style="width:17%"></colgroup><thead><tr>${["Nº", "Empresa", "Prioridade", "Dia útil", "Previsão"].map((item) => `<th>${esc(item)}</th>`).join("")}</tr></thead><tbody>${printRows.map((row) => `<tr>${row.map((value) => `<td>${esc(value)}</td>`).join("")}</tr>`).join("")}</tbody></table><footer>Grupo Cavalca · Portal de Fechamento Contábil</footer></section>`;
}
const goalHeaders = ["Ordem", "Empresa", "Prioridade", "Dia útil", "Previsão", "Data de entrega", "Financeiro", "RH", "Estoque", "Fiscal", "Balancete"];
function orderedGoals() {
  return state.companies.filter((item) => isHistorical()
    ? state.targets.some((goal) => goal.company_id === item.id && goal.competence === state.month) : item.active)
    .map((company) => ({ ...company, goal: targetFor(company) }))
    .sort((a, b) => a.goal.category === b.goal.category ? a.goal.sort_order - b.goal.sort_order : a.goal.category === "HOLDING" ? -1 : 1);
}
function goalExportRows() {
  return orderedGoals().map((company, index) => {
    const goal = company.goal;
    return [index + 1, company.name, goal.category, goal.business_day || "", dateBR(isHistorical() ? goal.legacy_deadline : plannedDate(state.month, goal.business_day)),
      goal.official_close_date ? dateBR(goal.official_close_date) : goal.delivery_at ? brasilia(goal.delivery_at) : "Aguardando", ...departments.map((department) => { const receipt = receiptFor(company.id, department); return receipt?.received_at ? `${receiptStatusLabel(receipt.status)} · ${brasilia(receipt.received_at)}` : receiptStatusLabel(receipt?.status); })];
  });
}
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
}
function zipFiles(files) {
  const encoder = new TextEncoder(), parts = [], directory = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const path = encoder.encode(name), data = encoder.encode(body), crc = crc32(data);
    const local = new Uint8Array(30 + path.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
    view.setUint16(26, path.length, true); local.set(path, 30);
    parts.push(local, data); directory.push({ path, crc, size: data.length, offset }); offset += local.length + data.length;
  }
  const centralStart = offset;
  for (const entry of directory) {
    const header = new Uint8Array(46 + entry.path.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true); view.setUint32(16, entry.crc, true); view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true); view.setUint16(28, entry.path.length, true); view.setUint32(42, entry.offset, true);
    header.set(entry.path, 46); parts.push(header); offset += header.length;
  }
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, directory.length, true); endView.setUint16(10, directory.length, true);
  endView.setUint32(12, offset - centralStart, true); endView.setUint32(16, centralStart, true); parts.push(end);
  return new Blob(parts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function exportGoalsXlsx() {
  const exportRows = goalExportRows();
  const cell = (value, reference, style = 0) => typeof value === "number"
    ? `<c r="${reference}" s="${style}"><v>${value}</v></c>`
    : `<c r="${reference}" s="${style}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
  const rows = [
    `<row r="1" ht="32">${cell(`GRUPO CAVALCA · ORDEM DE FECHAMENTO · ${monthName(state.month).toUpperCase()}`, "A1", 1)}</row>`,
    `<row r="2" ht="25">${goalHeaders.map((value, index) => cell(value, `${String.fromCharCode(65 + index)}2`, 2)).join("")}</row>`,
    ...exportRows.map((values, rowIndex) => `<row r="${rowIndex + 3}" ht="22">${values.map((value, columnIndex) => cell(value, `${String.fromCharCode(65 + columnIndex)}${rowIndex + 3}`, rowIndex % 2 ? 4 : 3)).join("")}</row>`),
  ];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="9" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/><col min="3" max="4" width="14" customWidth="1"/><col min="5" max="6" width="22" customWidth="1"/><col min="7" max="11" width="24" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData><autoFilter ref="A2:K${Math.max(2, exportRows.length + 2)}"/><mergeCells count="1"><mergeCell ref="A1:K1"/></mergeCells></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF39373A"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF39373A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFB519"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="1" borderId="0" xfId="0" applyFill="1"/></cellXfs></styleSheet>`;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ordem de fechamento" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet, "xl/styles.xml": styles,
  };
  const url = URL.createObjectURL(zipFiles(files)), link = document.createElement("a");
  link.href = url; link.download = `ordem-fechamento-${state.month}.xlsx`; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function renderHistory() {
  const months = [...new Set([...state.history.map((item) => item.competence), ...state.states.map((item) => item.competence)])].sort();
  return `<div class="two-col"><section class="panel"><div class="panel-head"><h2>Resumo de ${esc(monthName(state.month))}</h2></div><div class="panel-body">
    <p><strong>${monthlyTasks().length}</strong> atividades; <strong>${monthlyTasks().filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length}</strong> finalizadas.</p>
    <p class="muted">Os fechamentos históricos preservam as datas já cadastradas, inclusive as incompletas, exibidas como no original. Os tempos em horas começam com os apontamentos feitos no painel.</p></div></section>
    <section class="panel"><div class="panel-head"><h2>Meses registrados</h2></div><div class="panel-body history-grid">${months.map((month) => { const count = state.history.filter((item) => item.competence === month).length || state.states.filter((item) => item.competence === month).length; return `<button class="history-month" data-action="choose-month" data-month="${month}">${esc(monthName(month))}<strong>${count}</strong><small>registros</small></button>`; }).join("") || '<div class="empty">Histórico ainda não migrado.</div>'}</div></section></div>`;
}
function renderSuggestions() {
  const suggestions = [...(state.suggestions || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const pendingIds = new Set(state.queue.filter((item) => item.table === "fc_improvement_suggestions").map((item) => item.row?.id));
  return `<section class="panel suggestions-panel"><div class="panel-head"><div><h2>Sugestões de melhoria</h2><p>Compartilhe ideias para facilitar o uso do painel. Todos os responsáveis podem acompanhar as sugestões e decisões.</p></div></div>
    <div class="panel-body">${state.collaborationError ? `<div class="notice warn">Não foi possível carregar as sugestões: ${esc(state.collaborationError)}</div>` : ""}
      <form id="suggestion-form" class="suggestion-form"><label class="field"><span>Sua sugestão</span><textarea class="input" name="body" maxlength="4000" minlength="10" rows="4" placeholder="O que pode melhorar no painel?" required>${esc(state.suggestionDraft)}</textarea></label><button class="btn primary" type="submit" ${state.collaborationReady ? "" : "disabled"}>Enviar sugestão</button></form>
      <h3 class="section-title">Sugestões registradas (${suggestions.length})</h3><div class="suggestion-list">${suggestions.length ? suggestions.map((item) => `<article class="suggestion-entry"><div class="suggestion-heading"><span class="badge ${item.status === "Aceita" ? "done" : item.status === "Rejeitada" ? "not-started" : "paused"}">${esc(item.status)}</span><small>${esc(memberName(item.author_id, "Usuário removido"))} · ${pendingIds.has(item.id) ? "Aguardando sincronização" : brasilia(item.created_at)}</small></div><p>${esc(item.body).replace(/\n/g, "<br>")}</p>
        ${item.status === "Pendente" && state.member?.is_admin && !pendingIds.has(item.id) ? `<div class="suggestion-decision"><label class="field"><span>Motivo da decisão</span><textarea class="input" data-suggestion-reason="${esc(item.id)}" maxlength="1000" rows="2" placeholder="Explique por que aceita ou rejeita esta sugestão">${esc(state.suggestionReasonDrafts[item.id] || "")}</textarea></label><div class="actions"><button class="btn compact primary" data-action="decide-suggestion" data-id="${esc(item.id)}" data-decision="Aceita">Aceitar</button><button class="btn compact danger" data-action="decide-suggestion" data-id="${esc(item.id)}" data-decision="Rejeitada">Rejeitar</button></div></div>` : ""}
        ${item.status !== "Pendente" ? `<div class="suggestion-outcome"><strong>Motivo:</strong> ${esc(item.decision_reason)}<small>Decisão de ${esc(memberName(item.decided_by, "Usuário removido"))} · ${brasilia(item.decided_at)}</small></div>` : ""}</article>`).join("") : '<div class="empty">Nenhuma sugestão cadastrada até o momento.</div>'}</div></div></section>`;
}
function renderClosingErrors() {
  const all = state.closingErrors || [];
  const search = state.errorSearch.trim().toLocaleLowerCase("pt-BR");
  const rows = all.filter((item) => (!state.errorStatusFilter || item.status === state.errorStatusFilter)
    && (!search || [item.company_name, item.assigned_user, item.requested_by, item.error_label, item.description].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(search))))
    .sort((a, b) => (a.status === "Corrigido") - (b.status === "Corrigido") || String(b.requested_at || "").localeCompare(String(a.requested_at || "")) || String(a.company_name).localeCompare(String(b.company_name), "pt-BR"));
  const companyNames = [...new Set([...all.map((item) => item.company_name), ...state.companies.map((item) => item.name)].filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const people = [...new Set([...all.map((item) => item.assigned_user), ...state.members.map((item) => item.name)].filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const pending = new Set(state.queue.filter((item) => item.table === "fc_closing_errors").map((item) => item.row?.id || item.where?.id));
  return `<section class="panel closing-errors"><div class="panel-head"><div><h2>Controle de erros</h2><p>Erros identificados nos fechamentos anteriores e acompanhamento das correções pela equipe. Os registros novos são feitos aqui, sem planilha externa.</p></div></div>
    <div class="panel-body">${state.errorFeatureError ? `<div class="notice warn">Não foi possível atualizar o controle de erros: ${esc(state.errorFeatureError)}</div>` : ""}
      <div id="closing-error-save-message" class="notice ${state.errorSaveFailed ? "warn" : ""}" role="status" ${state.errorSaveNotice ? "" : "hidden"}>${esc(state.errorSaveNotice)}</div>
      <div class="error-summary"><div><strong>${all.filter((item) => item.status === "Aberto").length}</strong><span>Aberto(s)</span></div><div><strong>${all.filter((item) => !["Aberto", "Corrigido"].includes(item.status)).length}</strong><span>Em andamento</span></div><div><strong>${all.filter((item) => item.status === "Corrigido").length}</strong><span>Corrigido(s)</span></div></div>
      <details class="error-editor" id="error-editor"><summary>Registrar novo erro ou editar item existente</summary>
        <form id="closing-error-form" class="form-grid" novalidate><input type="hidden" name="error_id"><label class="field"><span>Empresa</span><input class="input" name="company_name" list="error-companies" maxlength="200" required></label><label class="field"><span>Usuário / responsável</span><input class="input" name="assigned_user" list="error-people" maxlength="200"></label>
        <label class="field"><span>Quem solicitou</span><input class="input" name="requested_by" maxlength="200"></label><label class="field"><span>Data da solicitação</span><input class="input" name="requested_at" type="date"></label>
        <label class="field"><span>Erro / identificação</span><input class="input" name="error_label" maxlength="500"></label><label class="field"><span>Status</span><select class="select" name="status">${errorStatuses.map((status) => `<option value="${esc(status)}">${esc(status)}</option>`).join("")}</select></label>
        <label class="field wide"><span>Histórico / descrição do erro</span><textarea class="input" name="description" rows="4" maxlength="10000" required></textarea></label>
        <label class="field"><span>Corrigido por melhoria em sistema?</span><select class="select" name="system_improvement"><option value="">Não informado</option><option value="true">Sim</option><option value="false">Não</option></select></label><label class="field"><span>Data da correção</span><input class="input" name="correction_date" type="date"></label>
        <div class="actions wide"><button class="btn primary" type="submit" ${state.errorFeatureReady ? "" : "disabled"}>Salvar erro</button><button class="btn" type="button" data-action="clear-error-form">Limpar formulário</button></div></form></details>
      <datalist id="error-companies">${companyNames.map((name) => `<option value="${esc(name)}">`).join("")}</datalist><datalist id="error-people">${people.map((name) => `<option value="${esc(name)}">`).join("")}</datalist>
      <div class="error-filters"><label class="field"><span>Buscar</span><input class="input" id="error-search" value="${esc(state.errorSearch)}" placeholder="Empresa, erro, pessoa ou histórico"></label><label class="field"><span>Status</span><select class="select" id="error-status-filter"><option value="">Todos</option>${errorStatuses.map((status) => `<option value="${esc(status)}" ${state.errorStatusFilter === status ? "selected" : ""}>${esc(status)}</option>`).join("")}</select></label></div>
      <div class="table-wrap"><table class="error-table"><thead><tr><th>Empresa</th><th>Erro / histórico</th><th>Responsável / solicitação</th><th>Status</th><th>Melhoria em sistema</th><th>Correção</th><th></th></tr></thead><tbody>${rows.map((item) => `<tr><td data-label="Empresa"><strong>${esc(item.company_name)}</strong></td><td data-label="Erro / histórico"><strong>${esc(item.error_label || "Sem código")}</strong><small>${esc(item.description)}</small></td><td data-label="Responsável / solicitação">${esc(item.assigned_user || "—")}<small>Solicitado por ${esc(item.requested_by || "—")} · ${dateBR(item.requested_at)}</small></td><td data-label="Status"><span class="badge ${item.status === "Corrigido" ? "done" : item.status === "Aberto" ? "not-started" : "paused"}">${esc(item.status)}</span>${pending.has(item.id) ? '<small>Aguardando sincronização</small>' : ""}</td><td data-label="Melhoria em sistema">${item.system_improvement === null || item.system_improvement === undefined ? "Não informado" : item.system_improvement ? "Sim" : "Não"}</td><td data-label="Correção">${dateBR(item.correction_date)}</td><td><button class="btn compact" data-action="edit-closing-error" data-id="${esc(item.id)}" ${pending.has(item.id) ? "disabled" : ""}>Editar</button></td></tr>`).join("") || '<tr><td colspan="7" class="empty">Nenhum erro encontrado para este filtro.</td></tr>'}</tbody></table></div>
      <p class="muted">${rows.length} item(ns) exibido(s) de ${all.length}. Sem data de correção, o item permanece em aberto ou em andamento; “Corrigido” exige a data.</p></div></section>`;
}
function nextGeneralRoutineState(routine, action, occurredAt) {
  const elapsed = action !== "play" && routine.status === "Em andamento" && routine.started_at
    ? Math.max(0, Math.floor((Date.parse(occurredAt) - Date.parse(routine.started_at)) / 1000)) : 0;
  return {
    status: action === "play" ? "Em andamento" : action === "pause" ? "Pausada" : "Finalizada",
    total_seconds: Number(routine.total_seconds || 0) + elapsed,
    started_at: action === "play" ? occurredAt : null,
    first_started_at: routine.first_started_at || (action === "play" ? occurredAt : null),
    finished_at: action === "finish" ? occurredAt : null,
    updated_at: occurredAt,
  };
}
function generalRoutineSeconds(routine) {
  return Number(routine.total_seconds || 0) + (routine.status === "Em andamento" && routine.started_at
    ? Math.max(0, Math.floor((state.tick - Date.parse(routine.started_at)) / 1000)) : 0);
}
function generalRecurrenceFields(frequency, nextDate) {
  const monthly = frequency === "monthly";
  return `<label class="field"><span>Recorrência</span><select class="select" name="recurrence_frequency"><option value="none" ${monthly ? "" : "selected"}>Não recorrente</option><option value="monthly" ${monthly ? "selected" : ""}>Mensal</option></select></label>
    <label class="field"><span>Data da próxima execução</span><input class="input" type="date" name="next_scheduled_date" value="${esc(nextDate || "")}" ${monthly ? "required" : "disabled"}></label>
    <p class="muted wide general-recurrence-help">Ao finalizar esta rotina, uma nova será criada para a data informada. A sequência continua mensalmente.</p>`;
}
function renderGeneralRoutines() {
  const all = state.generalRoutines || [];
  const search = state.generalSearch.trim().toLocaleLowerCase("pt-BR");
  const list = all.filter((routine) => (!state.generalMineOnly || routine.responsible_id === state.member.id)
    && (!state.generalStatusFilter || routine.status === state.generalStatusFilter)
    && (!search || [routine.title, routine.description, memberName(routine.responsible_id)].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(search))))
    .sort((a, b) => (a.status === "Finalizada") - (b.status === "Finalizada") || String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const pending = new Set(state.queue.filter((item) => item.table?.startsWith("fc_general_") || ["fc_apply_general_routine", "fc_set_general_recurrence"].includes(item.name))
    .map((item) => item.row?.routine_id || item.row?.id || item.args?.p_routine_id));
  const pendingFinish = new Set(state.queue.filter((item) => item.name === "fc_apply_general_routine" && item.args?.p_action === "finish")
    .map((item) => item.args.p_routine_id));
  const responsibleOptions = state.members.filter((person) => person.active)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((person) => `<option value="${esc(person.id)}" ${person.id === (state.generalCreateDraft.responsible_id || state.member.id) ? "selected" : ""}>${esc(person.name)}</option>`).join("");
  return `<section class="panel general-routines"><div class="panel-head"><div><h2>Rotinas avulsas</h2><p>Atividades fora do fechamento contábil. O tempo e as anotações desta área não entram nos indicadores do balancete mensal.</p></div></div>
    <div class="panel-body">${state.generalError ? `<div class="notice warn">Não foi possível atualizar as rotinas avulsas: ${esc(state.generalError)}</div>` : ""}
      <div class="general-summary"><div><strong>${all.filter((item) => item.status !== "Finalizada").length}</strong><span>Em aberto</span></div><div><strong>${all.filter((item) => item.status === "Em andamento").length}</strong><span>Em andamento</span></div><div><strong>${all.filter((item) => item.status === "Finalizada").length}</strong><span>Finalizadas</span></div></div>
      <details class="general-create" ${state.generalCreateOpen ? "open" : ""}><summary>+ Cadastrar nova rotina</summary><form id="general-routine-form" class="form-grid"><label class="field"><span>Nome da rotina</span><input class="input" name="title" maxlength="200" minlength="3" required value="${esc(state.generalCreateDraft.title || "")}" placeholder="Ex.: Atualizar cadastro de fornecedores"></label><label class="field"><span>Responsável</span><select class="select" name="responsible_id" required>${responsibleOptions}</select></label><label class="field wide"><span>Descrição / objetivo</span><textarea class="input" name="description" rows="3" maxlength="4000" placeholder="Descreva o que precisa ser feito">${esc(state.generalCreateDraft.description || "")}</textarea></label>${generalRecurrenceFields(state.generalCreateDraft.recurrence_frequency || "none", state.generalCreateDraft.next_scheduled_date)}<button class="btn primary" type="submit" ${state.generalReady ? "" : "disabled"}>Cadastrar rotina</button></form></details>
      <div class="general-filters"><label class="field"><span>Buscar rotina</span><input class="input" id="general-search" value="${esc(state.generalSearch)}" placeholder="Nome, descrição ou responsável"></label><label class="field"><span>Status</span><select class="select" id="general-status-filter"><option value="">Todos</option>${["Não iniciada", "Em andamento", "Pausada", "Finalizada"].map((status) => `<option value="${esc(status)}" ${state.generalStatusFilter === status ? "selected" : ""}>${esc(status)}</option>`).join("")}</select></label><label class="general-mine"><input type="checkbox" id="general-mine" ${state.generalMineOnly ? "checked" : ""}> Somente minhas rotinas</label></div>
      <div class="general-list">${list.map((routine) => { const canControl = routine.responsible_id === state.member.id || state.member.is_admin;
        const entries = [
          ...state.generalEvents.filter((item) => item.routine_id === routine.id).map((item) => ({ type: "event", ...item })),
          ...state.generalNotes.filter((item) => item.routine_id === routine.id).map((item) => ({ type: "note", ...item })),
        ].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)) || String(a.id).localeCompare(String(b.id)));
        return `<article class="general-card"><div class="general-card-main"><div><h3>${esc(routine.title)}</h3><p>${esc(routine.description || "Sem descrição.")}</p><small>Responsável: ${esc(memberName(routine.responsible_id, "Usuário removido"))} · Criada em ${brasilia(routine.created_at)}</small>${routine.scheduled_date ? `<small class="general-schedule">Programada para ${dateBR(routine.scheduled_date)}</small>` : ""}${routine.recurrence_frequency === "monthly" ? `<small class="general-schedule">Recorrência mensal · ${routine.status === "Finalizada" ? "próxima ocorrência criada para" : "próxima execução em"} ${dateBR(routine.next_scheduled_date)}</small>` : ""}${routine.status === "Finalizada" && pendingFinish.has(routine.id) && routine.recurrence_frequency === "monthly" ? '<small>Próxima rotina será criada após sincronização.</small>' : ""}</div><div class="general-card-status"><span class="badge ${routine.status === "Finalizada" ? "done" : routine.status === "Em andamento" ? "running" : routine.status === "Pausada" ? "paused" : "not-started"}">${esc(routine.status)}</span><strong class="general-live-time" data-id="${esc(routine.id)}">${duration(generalRoutineSeconds(routine))}</strong><small>Tempo acumulado</small>${routine.first_started_at ? `<small>Início: ${brasilia(routine.first_started_at)}</small>` : ""}${routine.finished_at ? `<small>Fim: ${brasilia(routine.finished_at)}</small>` : ""}${pending.has(routine.id) ? '<small>Aguardando sincronização</small>' : ""}</div></div>
          <div class="general-card-actions"><button class="btn compact play" data-action="general-activity" data-kind="play" data-id="${esc(routine.id)}" ${!canControl || !["Não iniciada", "Pausada"].includes(routine.status) ? "disabled" : ""}>▶ PLAY</button><button class="btn compact pause" data-action="general-activity" data-kind="pause" data-id="${esc(routine.id)}" ${!canControl || routine.status !== "Em andamento" ? "disabled" : ""}>Ⅱ PAUSE</button><button class="btn compact stop" data-action="general-activity" data-kind="finish" data-id="${esc(routine.id)}" ${!canControl || !["Em andamento", "Pausada"].includes(routine.status) ? "disabled" : ""}>■ FINISH</button><button class="btn compact" data-action="general-details" data-id="${esc(routine.id)}">${state.generalOpenId === routine.id ? "Ocultar anotações" : `Anotações e histórico (${entries.length})`}</button></div>
          ${state.generalOpenId === routine.id ? `<div class="general-details"><h4>Acompanhamento da rotina</h4>${canControl && routine.status !== "Finalizada" ? `<form class="form-grid general-recurrence-form" data-form="general-recurrence" data-routine-id="${esc(routine.id)}"><h4 class="wide">Programação da recorrência</h4>${generalRecurrenceFields(state.generalRecurrenceDrafts[routine.id]?.recurrence_frequency ?? routine.recurrence_frequency ?? "none", state.generalRecurrenceDrafts[routine.id]?.next_scheduled_date ?? routine.next_scheduled_date)}<button class="btn" type="submit" ${state.generalReady ? "" : "disabled"}>Salvar recorrência</button></form>` : ""}<div class="general-timeline">${entries.length ? entries.map((entry) => `<div class="general-entry ${entry.type}"><strong>${entry.type === "note" ? "Anotação" : ({ play: "PLAY", pause: "PAUSE", finish: "FINISH" })[entry.action]}</strong><span>${entry.type === "note" ? esc(entry.body).replace(/\n/g, "<br>") : entry.elapsed_seconds ? `+ ${duration(entry.elapsed_seconds)} de trabalho` : "Registro de tempo"}</span><small>${esc(memberName(entry.author_id || entry.actor_id, "Usuário removido"))} · ${brasilia(entry.occurred_at)}</small></div>`).join("") : '<p class="muted">Ainda não há apontamentos nesta rotina.</p>'}</div>${routine.status !== "Finalizada" ? `<form data-form="general-note" data-routine-id="${esc(routine.id)}"><label class="field"><span>O que foi feito / observações</span><textarea class="input" name="body" rows="3" maxlength="4000" required placeholder="Registre o andamento, impedimentos ou próximos passos">${esc(state.generalNoteDrafts[routine.id] || "")}</textarea></label><button class="btn primary" type="submit" ${state.generalReady ? "" : "disabled"}>Salvar anotação</button></form>` : '<p class="muted">Rotina finalizada. O histórico permanece disponível para consulta.</p>'}</div>` : ""}</article>`;
      }).join("") || '<div class="empty">Nenhuma rotina encontrada. Cadastre uma nova ou ajuste os filtros.</div>'}</div></div></section>`;
}
function closingErrorNotice(message, failed = false) {
  state.errorSaveNotice = message;
  state.errorSaveFailed = failed;
  const element = $("#closing-error-save-message");
  if (element) {
    element.textContent = message;
    element.classList.toggle("warn", failed);
    element.hidden = !message;
  }
}
function updateClosingErrorRequirements(form) {
  const corrected = field(form, "status").value === "Corrigido";
  field(form, "correction_date").required = corrected;
  const existing = state.closingErrors.find((item) => item.id === field(form, "error_id").value);
  field(form, "system_improvement").required = corrected && !existing?.source_row;
}
function renderRegistry() {
  const companyOptions = state.companies.filter((item) => item.active).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
  const memberOptions = state.members.filter((item) => item.active).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
  const legacyOwners = [...new Set([...state.tasks, ...state.owners].filter((item) => !item.responsible_id && item.responsible_legacy_name).map((item) => item.responsible_legacy_name))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return `<div class="two-col"><section class="panel"><div class="panel-head"><h2>Responsáveis e acessos</h2></div><div class="panel-body">
    ${state.member?.is_admin ? `<form id="invite-form" class="form-grid"><label class="field"><span>Nome</span><input class="input" name="name" required></label><label class="field"><span>E-mail</span><input class="input" type="email" name="email" required></label><button class="btn primary" type="submit">Convidar responsável</button></form>` : '<p class="muted">Somente o administrador cadastra novos acessos.</p>'}
    <h3 class="section-title" style="margin-top:22px">Cadastrados com acesso</h3><div class="list">${state.members.filter((person) => person.active).map((person) => {
      const pending = state.invitePendingIds.includes(person.id);
      const accessStatus = person.is_admin ? "· administrador" : state.member?.is_admin && state.inviteStatus === "ready"
        ? pending ? "· convite pendente" : "· convite aceito ou acesso existente" : "";
      return `<div class="list-row"><div><input class="input" data-member-name="${esc(person.id)}" value="${esc(person.name)}" ${state.member?.is_admin ? "" : "disabled"}><small>${esc(person.email)} ${accessStatus}</small></div>${state.member?.is_admin ? `<div class="actions"><button class="btn compact" data-action="member-name" data-id="${esc(person.id)}">Salvar</button>${person.is_admin ? "" : `<button class="btn compact" data-action="resend-invite" data-id="${esc(person.id)}" aria-label="Reenviar convite para ${esc(person.name)}" ${pending ? "" : `disabled title="Disponível somente para convites ainda não aceitos"`}>Reenviar convite</button><button class="btn compact" data-action="promote-member" data-id="${esc(person.id)}" title="Conceder acesso administrativo a todas as telas">Tornar administrador</button>`}<button class="btn compact danger" data-action="delete-member" data-id="${esc(person.id)}" ${person.id === state.member.id ? "disabled" : ""}>Excluir</button></div>` : ""}</div>`;
    }).join("")}</div>
    <h3 class="section-title" style="margin-top:22px">Pré-cadastrados sem acesso</h3><p class="muted">Ao convidar com o mesmo nome, as rotinas são vinculadas à conta.</p><div class="list">${legacyOwners.map((name) => `<div class="list-row"><input class="input" data-legacy-name="${esc(name)}" value="${esc(name)}" ${state.member?.is_admin ? "" : "disabled"}>${state.member?.is_admin ? `<div class="actions"><button class="btn compact" data-action="legacy-name" data-old="${esc(name)}">Salvar</button><button class="btn compact danger" data-action="delete-legacy" data-old="${esc(name)}">Excluir</button></div>` : ""}</div>`).join("")}</div></div></section>
    <section class="panel"><div class="panel-head"><h2>Empresas</h2></div><div class="panel-body"><p class="notice warn">Um novo cadastro deverá respeitar o nome da empresa conforme o cartão de CNPJ</p><form id="company-form" class="form-grid"><label class="field wide"><span>Nome da empresa</span><input class="input" name="name" required></label><label class="field"><span>Prioridade inicial</span><select class="select" name="category"><option>DEMAIS</option><option>HOLDING</option></select></label><button class="btn primary" type="submit">Incluir empresa</button></form>
    <h3 class="section-title" style="margin-top:22px">Cadastradas</h3><div class="list">${state.companies.filter((item) => item.active).map((item) => `<div class="list-row"><input class="input" data-company-name="${esc(item.id)}" value="${esc(item.name)}" aria-label="Nome da empresa"> <button class="btn compact" data-action="company-name" data-id="${esc(item.id)}">Salvar</button></div>`).join("")}</div></div></section>
    <section class="panel"><div class="panel-head"><h2>Contas / rotinas</h2></div><div class="panel-body"><form id="task-form" class="form-grid"><label class="field wide"><span>Empresa</span><select class="select" name="company_id" required><option value="">Selecione</option>${companyOptions}</select></label><label class="field"><span>Conta / rotina</span><input class="input" name="account" required></label><label class="field"><span>Grupo</span><input class="input" name="group_name" value="OUTROS"></label><button class="btn primary" type="submit">Incluir rotina sem responsável</button></form>
    <h3 class="section-title" style="margin-top:22px">${state.tasks.filter((item) => item.active).length} rotinas cadastradas</h3><div class="list">${state.tasks.filter((item) => item.active).map((item) => `<div class="list-row"><div><strong>${esc(taskLabelFor(item).account)}</strong><small>${esc(companyName(item.company_id))} · ${esc(memberName(ownerFor(item.id)?.responsible_id, ownerFor(item.id)?.responsible_legacy_name))}</small></div></div>`).join("")}</div></div></section>
    <section class="panel"><div class="panel-head"><h2>Feriados adicionais</h2></div><div class="panel-body"><p class="muted">Use para feriados estaduais, municipais ou dias sem expediente confirmados pelo setor.</p><form id="holiday-form" class="form-grid"><label class="field"><span>Data</span><input class="input" type="date" name="date" required></label><label class="field"><span>Descrição</span><input class="input" name="name" required></label><button class="btn primary" type="submit">Adicionar feriado</button></form><div class="list" style="margin-top:20px">${state.holidays.sort((a, b) => a.date.localeCompare(b.date)).map((item) => `<div class="list-row"><span>${dateBR(item.date)} · ${esc(item.name)}</span></div>`).join("")}</div></div></section></div>`;
}
function renderVersions() {
  if (!state.member?.is_admin) return '<div class="notice warn">Esta área é exclusiva do administrador.</div>';
  const notes = [...state.releaseNotes].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  const corrections = [...state.corrections].sort((a, b) => String(b.corrected_at).localeCompare(String(a.corrected_at)));
  const labelEdits = [...state.taskLabelEdits].sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)));
  return `<div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Versões e atualizações</h2><p>Versão instalada: ${esc(APP_VERSION)}</p></div></div><div class="panel-body">
    ${state.adminDataError ? `<div class="notice warn">${esc(state.adminDataError)}</div>` : ""}
    <form id="release-form" class="form-grid"><label class="field"><span>Versão</span><input class="input" name="version" value="${esc(APP_VERSION)}" maxlength="40" required></label><label class="field"><span>Título da atualização</span><input class="input" name="title" maxlength="160" required></label><label class="field wide"><span>Descrição das mudanças / manutenção</span><textarea class="input" name="details" rows="5" maxlength="4000" required></textarea></label><button class="btn primary" type="submit" ${state.adminDataError ? "disabled" : ""}>Registrar atualização</button></form>
    <h3 class="section-title" style="margin-top:24px">Histórico de versões</h3><div class="update-list">${notes.length ? notes.map((note) => `<article class="update-entry"><div class="update-heading"><strong>${esc(note.version)} · ${esc(note.title)}</strong><small>${brasilia(note.published_at)}</small></div><p>${esc(note.details).replace(/\n/g, "<br>")}</p><small>Registrado por ${esc(memberName(note.created_by, "Sistema"))}</small></article>`).join("") : '<div class="empty">Nenhuma atualização registrada.</div>'}</div></div></section>
    <section class="panel"><div class="panel-head"><div><h2>Correções de apontamentos</h2><p>Histórico de tempos editados e registros retirados da execução.</p></div></div><div class="panel-body update-list">${corrections.length ? corrections.map((item) => { const task = state.tasks.find((row) => row.id === item.task_id); const timeEdit = item.correction_type === "time_edit", queueSkip = item.correction_type === "queue_skip"; return `<article class="update-entry"><div class="update-heading"><strong>${queueSkip ? "PAUSE local repetido · " : timeEdit ? "Tempo editado · " : "Registros retirados · "}${esc(task ? taskLabelFor(task, item.competence).account : item.task_id)}</strong><small>${brasilia(item.corrected_at)}</small></div><p>${esc(companyName(task?.company_id))} · ${esc(monthName(item.competence))}</p><p>Motivo: ${esc(item.reason)}</p><small>${queueSkip ? `Apontamento não enviado de ${brasilia(item.previous_state?.pending_occurred_at)}; nenhum tempo gravado foi alterado` : timeEdit ? `Tempo: ${duration(item.old_total_seconds ?? item.previous_state?.total_seconds)} → ${duration(item.new_total_seconds)}` : `${item.events_affected} registro(s) retirado(s)`} · por ${esc(memberName(item.corrected_by))}</small></article>`; }).join("") : '<div class="empty">Nenhuma correção administrativa registrada.</div>'}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>Alterações de rotinas</h2><p>Nomes e grupos corrigidos por competência, sem apagar os apontamentos.</p></div></div><div class="panel-body update-list">${labelEdits.length ? labelEdits.map((item) => { const task = state.tasks.find((row) => row.id === item.task_id); return `<article class="update-entry"><div class="update-heading"><strong>${esc(companyName(task?.company_id))} · ${esc(monthName(item.effective_competence))}</strong><small>${brasilia(item.changed_at)}</small></div><p>${esc(item.old_account)} → ${esc(item.new_account)}</p><small>Grupo: ${esc(item.old_group_name || "OUTROS")} → ${esc(item.new_group_name)} · por ${esc(memberName(item.changed_by))}</small></article>`; }).join("") : '<div class="empty">Nenhuma rotina editada.</div>'}</div></section></div>`;
}
function pendingDescription(item) {
  const taskId = item.args?.p_task_id || item.row?.task_id || item.where?.task_id || (item.table === "fc_tasks" ? item.row?.id : null);
  const task = state.tasks.find((row) => row.id === taskId) || state.queue.find((row) => (row.kind === "insert" || isLegacyTaskWrite(row)) && row.table === "fc_tasks" && row.row?.id === taskId)?.row;
  const companyId = task?.company_id || item.row?.company_id || item.where?.company_id;
  const company = state.companies.find((row) => row.id === companyId) || state.queue.find((row) => row.table === "fc_companies" && row.row?.id === companyId)?.row;
  const action = item.kind === "rpc" && item.name === "fc_apply_general_routine"
    ? ({ play: "PLAY", pause: "PAUSE", finish: "FINISH" })[item.args?.p_action] || "Apontamento"
    : item.kind === "rpc" && item.name === "fc_apply_activity"
    ? ({ play: "PLAY", pause: "PAUSE", stop: "STOP" })[item.args?.p_action] || "Apontamento"
    : item.table === "fc_general_routines" ? "Cadastro de rotina avulsa"
      : item.table === "fc_general_routine_notes" ? "Anotação de rotina avulsa"
      : item.table === "fc_task_comments" ? "Comentário de atividade"
      : item.table === "fc_improvement_suggestions" ? "Sugestão de melhoria"
    : item.table === "fc_tasks" && (item.kind === "insert" || isLegacyTaskWrite(item)) ? "Inclusão de rotina"
      : item.kind === "update" ? "Alteração de cadastro" : "Cadastro / ajuste";
  const generalId = item.args?.p_routine_id || item.row?.routine_id || (item.table === "fc_general_routines" ? item.row?.id : null);
  const general = state.generalRoutines.find((row) => row.id === generalId);
  return { action, target: general?.title || item.row?.title || [task?.account || item.row?.account, company?.name].filter(Boolean).join(" · ") || item.table || item.name || "Registro", month: generalId ? "Fora do fechamento" : item.args?.p_competence || item.row?.competence || item.where?.competence || "—", time: item.args?.p_occurred_at ? brasilia(item.args.p_occurred_at) : item.row?.occurred_at ? brasilia(item.row.occurred_at) : "—" };
}
function renderRecoveryPanel() {
  const records = state.queue.map(pendingDescription);
  const actions = records.filter((item) => ["PLAY", "PAUSE", "STOP", "FINISH"].includes(item.action)).length;
  return `<section class="panel recovery-panel" aria-label="Recuperação dos registros pendentes"><div class="panel-head"><div><h2>Recuperar registros pendentes</h2><p>${state.queue.length} operação(ões) neste navegador, incluindo ${actions} apontamento(s) de tempo.</p></div><span class="badge paused">Envio automático pausado</span></div>
    <div class="panel-body"><p>${state.queue.some(isLegacyTaskWrite) ? "Uma inclusão de rotina anterior foi recusada pelo servidor." : "O servidor recusou a primeira operação pendente."} Os registros seguintes estão preservados neste navegador. Confira a lista, baixe uma cópia de segurança e solicite a análise do administrador antes de tentar novamente. Não limpe os dados do site nem troque de navegador.</p>
    ${state.syncError ? `<div class="notice warn">Última falha: ${esc(state.syncError)}</div>` : ""}
    <div class="recovery-actions"><button class="btn" data-action="download-queue">Baixar cópia da fila (JSON)</button><label><input type="checkbox" id="queue-backup-confirm" ${state.recoveryBackupConfirmed ? "checked" : ""} ${state.recoveryBackupRequested ? "" : "disabled"}> Confirme que o arquivo foi salvo neste aparelho</label>${isDuplicatePauseBlocked() ? `<button class="btn danger" data-action="skip-duplicate-pause" ${!state.online || !state.recoveryBackupConfirmed || flushing ? "disabled" : ""}>Retirar PAUSE repetido</button>` : ""}<button class="btn primary" data-action="sync-queue" ${!state.online || !state.recoveryBackupConfirmed || flushing || isDuplicatePauseBlocked() ? "disabled" : ""}>Sincronizar após revisão</button></div>
    <small class="muted">A cópia contém informações das rotinas. Guarde-a em local restrito e não a publique no GitHub.</small>
    <details class="recovery-details" open><summary>Revisar ${records.length} operação(ões)</summary><div class="table-wrap"><table><thead><tr><th>#</th><th>Ação</th><th>Rotina / empresa</th><th>Competência</th><th>Horário · Brasília</th></tr></thead><tbody>${records.map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.action)}</td><td>${esc(item.target)}</td><td>${esc(item.month)}</td><td>${esc(item.time)}</td></tr>`).join("")}</tbody></table></div></details></div></section>`;
}
function downloadQueueBackup() {
  if (!state.recoveryHold || !state.queue.length || !state.session) return;
  const saved = JSON.parse(localStorage.getItem(queueKey()) || "[]");
  if (!Array.isArray(saved) || saved.length !== state.queue.length) return toast("A fila mudou. Recarregue a página e tente novamente.");
  const backup = { format: "fc-pending-queue-v1", exported_at: new Date().toISOString(), user_id: state.session.user.id, count: saved.length, queue: saved };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fechamento-pendencias-${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(/[ :]/g, "-")}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  state.recoveryBackupRequested = true;
  render();
  toast("Download solicitado. Confirme que o arquivo apareceu no aparelho antes de sincronizar.");
}
function render() {
  if (!state.session || state.needsPassword) return renderAuth();
  if (!state.ready) { $("#app").innerHTML = '<div class="loading">Carregando dados protegidos…</div>'; return; }
  if (!state.member) {
    $("#app").innerHTML = `<div class="auth-screen"><div class="auth-box"><h1>Acesso pendente</h1><p>${esc(state.error || "Peça ao administrador para liberar seu e-mail.")}</p><button class="btn" data-action="logout">Sair</button></div></div>`;
    return;
  }
  const content = state.tab === "Painel Geral" ? renderPanel() : state.tab === "Meu Painel" ? renderMyPanel() : state.tab === "Execução" ? renderExecution() : state.tab === "Rotinas avulsas" ? renderGeneralRoutines() : state.tab === "Metas" ? renderGoals() : state.tab === "Histórico" ? renderHistory() : state.tab === "Controle de erros" ? renderClosingErrors() : state.tab === "Sugestões de melhoria" ? renderSuggestions() : state.tab === "Versões" ? renderVersions() : renderRegistry();
  const recovering = state.recoveryHold && state.queue.length > 0;
  $("#app").innerHTML = `<header class="topbar"><div class="topbar-inner"><div class="brand"><img class="brand-logo" src="brand/logo-principal.png" alt="Grupo Cavalca"><strong>Fechamento contábil</strong></div><div class="top-actions">
    ${state.tab === "Rotinas avulsas" ? '<span class="general-month-note">Independente do mês</span>' : `<select class="select" id="month" aria-label="Mês de fechamento" style="width:auto" ${recovering ? "disabled" : ""}>${monthOptions()}</select>`}
    <span class="status-pill ${state.online && !recovering ? "" : "offline"}">${recovering ? `${state.queue.length} pendente(s) · em revisão` : state.online ? state.queue.length ? `${state.queue.length} pendente(s)` : "Sincronizado" : `Offline · ${state.queue.length} pendente(s)`}</span>
    <span style="font-size:12px">${esc(state.member.name)}</span><button class="btn compact" data-action="logout" ${recovering ? "disabled" : ""}>Sair</button></div></div></header>
    <main class="shell ${["Execução", "Metas", "Controle de erros", "Rotinas avulsas"].includes(state.tab) ? "wide-workspace" : ["Painel Geral", "Meu Painel"].includes(state.tab) ? "dashboard-workspace" : ""}">${state.error ? `<div class="notice warn">${esc(state.error)}</div>` : ""}
    ${recovering ? renderRecoveryPanel() : ""}<div ${recovering ? "inert" : ""}><nav class="tabs" aria-label="Seções">${[...tabNames, ...(state.member.is_admin ? ["Versões"] : [])].map((name) => `<button data-action="tab" data-tab="${name}" class="${state.tab === name ? "active" : ""}">${name}</button>`).join("")}</nav>${content}</div>${!recovering && state.tab === "Execução" ? renderCommentsPanel() : ""}</main>`;
  document.querySelectorAll('[data-action="task-owner"]').forEach((element) => { element.value = ownerFor(element.dataset.id)?.responsible_id || ""; });
  if (state.tab === "Execução") applyExecutionFilters();
  if (state.tab === "Metas") updateReceiptPreview();
}
function changeLocal(table, row, keys) {
  const array = state[table];
  const index = array.findIndex((item) => keys.every((key) => item[key] === row[key]));
  if (index < 0) array.push(row); else array[index] = { ...array[index], ...row };
}
function saveGoal(companyId, values) {
  const company = state.companies.find((item) => item.id === companyId);
  if (!company) return;
  const existing = state.targets.find((item) => item.company_id === companyId && item.competence === state.month);
  const row = { ...targetFor(company), ...values, updated_at: new Date().toISOString() };
  changeLocal("targets", row, ["company_id", "competence"]);
  if (existing) enqueue({ kind: "update", table: "fc_targets", where: { company_id: companyId, competence: state.month }, values: { ...values, updated_at: row.updated_at } });
  else enqueue({ kind: "upsert", table: "fc_targets", row, conflict: "company_id,competence" });
}
function act(taskId, action) {
  if (isHistorical()) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !taskInMonth(task)) return;
  if (action === "play" && !ownerFor(taskId)?.responsible_id) {
    state.executionOwnerWarning = taskId;
    render();
    return toast("Esta tarefa não pode ser iniciada sem um responsável definido.");
  }
  state.executionOwnerWarning = "";
  const now = new Date().toISOString();
  const previous = taskState(taskId) || { task_id: taskId, competence: state.month, status: "Não iniciado", total_seconds: 0 };
  if (action === "play" && previous.status === "Em andamento") return;
  if (action === "pause" && previous.status !== "Em andamento") return toast("Inicie a rotina antes de pausá-la.");
  if (action === "stop" && previous.status === "Finalizado") return;
  const elapsed = action !== "play" && previous.status === "Em andamento" && previous.started_at ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(previous.started_at)) / 1000)) : 0;
  const row = { ...previous, status: action === "play" ? "Em andamento" : action === "pause" ? "Pausado" : "Finalizado", total_seconds: previous.total_seconds + elapsed,
    started_at: action === "play" ? now : null, first_started_at: previous.first_started_at || (action === "play" ? now : null),
    finished_at: action === "stop" ? now : null, updated_at: now, last_actor_id: state.member.id };
  changeLocal("states", row, ["task_id", "competence"]);
  const companyTasks = state.tasks.filter((item) => item.company_id === task.company_id && taskInMonth(item));
  let goal = state.targets.find((item) => item.company_id === task.company_id && item.competence === state.month);
  if (!goal) {
    goal = targetFor(state.companies.find((item) => item.id === task.company_id));
    state.targets.push(goal);
  }
  goal.delivery_at = companyTasks.every((item) => state.states.find((entry) => entry.task_id === item.id && entry.competence === state.month)?.status === "Finalizado")
    ? companyTasks.map((item) => state.states.find((entry) => entry.task_id === item.id && entry.competence === state.month)?.finished_at).filter(Boolean).sort().at(-1) : null;
  enqueue({ kind: "rpc", name: "fc_apply_activity", args: { p_event_id: uid(), p_task_id: taskId, p_competence: state.month, p_action: action, p_occurred_at: now } });
}
function actGeneralRoutine(id, action) {
  const routine = state.generalRoutines.find((item) => item.id === id);
  if (!state.generalReady || !routine) return toast("Esta rotina ainda não está disponível para apontamentos.");
  if (routine.responsible_id !== state.member.id && !state.member.is_admin) return toast("Somente o responsável ou um administrador pode controlar esta rotina.");
  if (action === "play" && !["Não iniciada", "Pausada"].includes(routine.status)) return;
  if (action === "pause" && routine.status !== "Em andamento") return toast("Inicie a rotina antes de pausá-la.");
  if (action === "finish" && !["Em andamento", "Pausada"].includes(routine.status)) return toast("Inicie a rotina antes de finalizá-la.");
  if (action === "finish" && !confirm(`Finalizar a rotina “${routine.title}”? O cronômetro será encerrado${routine.recurrence_frequency === "monthly" ? ` e uma nova rotina será criada para ${dateBR(routine.next_scheduled_date)} após a sincronização` : ""}. As anotações ficarão disponíveis para consulta.`)) return;
  const now = new Date().toISOString(), eventId = uid();
  const next = nextGeneralRoutineState(routine, action, now);
  const elapsed = Number(next.total_seconds) - Number(routine.total_seconds || 0);
  Object.assign(routine, next);
  state.generalEvents.push({ id: eventId, routine_id: id, action, actor_id: state.member.id, occurred_at: now, elapsed_seconds: elapsed });
  enqueue({ kind: "rpc", name: "fc_apply_general_routine", args: { p_event_id: eventId, p_routine_id: id, p_action: action, p_occurred_at: now } });
}
async function resetActivity(taskId, button) {
  if (!state.member?.is_admin || isHistorical()) return;
  if (!state.online || state.queue.length) return toast("Conecte-se e sincronize os registros pendentes antes de corrigir apontamentos.");
  const task = state.tasks.find((item) => item.id === taskId);
  const activity = taskState(taskId);
  if (!task || !activity || (activity.status === "Não iniciado" && !activity.total_seconds && !activity.first_started_at)) return;
  const month = state.month;
  const reason = prompt(`Correção administrativa · ${task.account} · ${companyName(task.company_id)} · ${monthName(month)}\n\nTodos os registros PLAY/PAUSE/STOP desta rotina neste mês serão retirados do tempo e dos indicadores. Informe o motivo:`);
  if (reason === null) return;
  if (reason.trim().length < 8) return toast("Descreva o motivo da correção com pelo menos 8 caracteres.");
  if (!confirm(`Confirmar a retirada de TODOS os apontamentos de ${task.account} em ${monthName(month)}? O tempo, início e fim voltarão a zero. A correção ficará registrada para auditoria.`)) return;
  button.disabled = true; button.textContent = "Corrigindo…";
  try {
    const { error } = await client.rpc("fc_reset_activity", { p_task_id: taskId, p_competence: month, p_reason: reason.trim() });
    if (error) throw error;
    await loadData();
    toast("Apontamentos retirados. Os indicadores e a data de entrega foram atualizados.");
  } catch (error) { button.disabled = false; button.textContent = "Limpar marcação"; toast(`Correção não aplicada: ${error.message || error}`); }
}
async function editActivityTime(taskId, button) {
  if (!state.member?.is_admin || isHistorical()) return;
  if (!state.online || state.queue.length) return toast("Conecte-se e sincronize os registros pendentes antes de editar o tempo.");
  const task = state.tasks.find((item) => item.id === taskId);
  const activity = taskState(taskId);
  if (!task || !activity?.first_started_at) return;
  if (!["Pausado", "Finalizado"].includes(activity.status)) return toast("Pause ou finalize a tarefa antes de editar seu tempo.");
  const month = state.month;
  const previous = duration(activity.total_seconds);
  const answer = prompt(`Editar tempo · ${task.account} · ${companyName(task.company_id)} · ${monthName(month)}\n\nInforme o tempo TOTAL correto em horas:minutos:segundos (HH:MM:SS):`, previous);
  if (answer === null) return;
  const parts = answer.trim().split(":");
  if (parts.length !== 3 || !/^\d{1,3}$/.test(parts[0]) || !/^[0-5]\d$/.test(parts[1]) || !/^[0-5]\d$/.test(parts[2])) {
    return toast("Use o formato HH:MM:SS, por exemplo 01:30:00.");
  }
  const seconds = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  if (seconds === activity.total_seconds) return toast("O novo tempo é igual ao registrado.");
  const reason = prompt(`Tempo atual: ${previous}\nNovo tempo: ${duration(seconds)}\n\nInforme o motivo da correção:`);
  if (reason === null) return;
  if (reason.trim().length < 8 || reason.trim().length > 500) return toast("Informe um motivo entre 8 e 500 caracteres.");
  if (!confirm(`Confirmar o ajuste do tempo total de ${previous} para ${duration(seconds)} em ${monthName(month)}? O ajuste e o motivo ficarão registrados em Versões. Os PLAY/PAUSE/STOP originais serão preservados. Peça aos demais usuários que sincronizem apontamentos offline antes de confirmar.`)) return;
  button.disabled = true; button.textContent = "Salvando…";
  try {
    const { error } = await client.rpc("fc_adjust_activity_time", { p_task_id: taskId, p_competence: month, p_new_total_seconds: seconds, p_reason: reason.trim() });
    if (error) throw error;
    await loadData();
    toast("Tempo corrigido. A alteração está registrada em Versões.");
  } catch (error) { button.disabled = false; button.textContent = "Editar tempo"; toast(`Tempo não alterado: ${error.message || error}`); }
}
async function editTaskLabel(taskId, button) {
  if (!state.member?.is_admin || isHistorical() || !state.taskLabelsReady) return;
  if (!state.online || state.queue.length) return toast("Conecte-se e sincronize os registros pendentes antes de editar uma rotina.");
  const task = monthlyTasks().find((item) => item.id === taskId && !item.historic);
  if (!task) return toast("Rotina não encontrada neste mês.");
  const month = state.month;
  const account = prompt(`Editar rotina · ${companyName(task.company_id)} · ${monthName(month)}\n\nInforme o novo nome da conta / rotina:`, task.account);
  if (account === null) return;
  const group = prompt(`Grupo sintético de “${account.trim()}”:`, executionGroup(task));
  if (group === null) return;
  const newAccount = account.trim(), newGroup = group.trim();
  if (!newAccount || newAccount.length > 250 || !newGroup || newGroup.length > 120)
    return toast("Informe um nome de até 250 caracteres e um grupo de até 120 caracteres.");
  if (newAccount === task.account && newGroup === executionGroup(task)) return toast("O nome e o grupo não foram alterados.");
  if (!confirm(`Salvar a alteração de “${task.account}” para “${newAccount}” a partir de ${monthName(month)}?\n\nMeses anteriores manterão o nome antigo. A tarefa, responsável e todos os PLAY/PAUSE/STOP e tempos permanecerão os mesmos. A edição ficará registrada em Versões.`)) return;
  button.disabled = true; button.textContent = "Salvando…";
  try {
    const { error } = await client.rpc("fc_edit_task_label", {
      p_task_id: taskId, p_competence: month, p_account: newAccount, p_group_name: newGroup,
    });
    if (error) throw error;
    await loadData();
    toast("Rotina atualizada neste mês e nos seguintes. O histórico anterior foi preservado.");
  } catch (error) { button.disabled = false; button.textContent = "Editar rotina"; toast(`Rotina não alterada: ${error.message || error}`); }
}
async function retireTask(taskId, button) {
  if (!state.member?.is_admin || isHistorical()) return;
  if (!state.online || state.queue.length) return toast("Conecte-se e sincronize os registros pendentes antes de excluir uma tarefa.");
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !taskInMonth(task)) return;
  const month = state.month;
  const reason = prompt(`Excluir tarefa · ${task.account} · ${companyName(task.company_id)}\n\nA tarefa deixará de aparecer em ${monthName(month)} e nos meses seguintes. Os meses anteriores serão preservados. Informe o motivo:`);
  if (reason === null) return;
  if (reason.trim().length < 8 || reason.trim().length > 500) return toast("Informe um motivo entre 8 e 500 caracteres.");
  if (!confirm(`Confirmar a exclusão de ${task.account} a partir de ${monthName(month)}? Se houver apontamentos neste mês, corrija-os primeiro. Peça que os demais usuários sincronizem registros offline antes de continuar.`)) return;
  button.disabled = true; button.textContent = "Excluindo…";
  try {
    const { error } = await client.rpc("fc_retire_task", { p_task_id: taskId, p_competence: month, p_reason: reason.trim() });
    if (error) throw error;
    await loadData();
    toast("Tarefa retirada deste mês e dos próximos. Os meses anteriores foram preservados.");
  } catch (error) { button.disabled = false; button.textContent = "Excluir tarefa"; toast(`Tarefa não excluída: ${error.message || error}`); }
}
async function promoteMember(memberId, button) {
  if (!state.member?.is_admin) return;
  if (!state.online) return toast("Conecte-se à internet para alterar o perfil de acesso.");
  const person = state.members.find((item) => item.id === memberId && item.active);
  if (!person || person.is_admin) return;
  if (!confirm(`Tornar ${person.name} administrador(a)? Este perfil acessará todas as telas e poderá alterar cadastros, corrigir apontamentos, excluir tarefas e conceder acesso administrativo a outros responsáveis.`)) return;
  button.disabled = true; button.textContent = "Atualizando…";
  try {
    const { error } = await client.rpc("fc_promote_member", { p_member_id: memberId });
    if (error) throw error;
    await loadData();
    toast(`${person.name} agora tem acesso de administrador(a).`);
  } catch (error) { button.disabled = false; button.textContent = "Tornar administrador"; toast(`Perfil não alterado: ${error.message || error}`); }
}
async function inviteRequest(body) {
  const { data, error } = await client.functions.invoke("fc-invite-member", { body });
  if (error || !data?.ok) {
    let detail = data?.error;
    if (!detail && error?.context?.json) {
      try { detail = (await error.context.json())?.error; } catch { /* Resposta sem JSON. */ }
    }
    throw new Error(detail || error?.message || "Função de convites indisponível.");
  }
  return data;
}
async function loadInviteStatuses() {
  if (!state.member?.is_admin || !state.online) return;
  state.inviteStatus = "loading";
  try {
    const data = await inviteRequest({ action: "status" });
    state.invitePendingIds = data.pendingIds || [];
    state.inviteStatus = "ready";
  } catch (error) {
    state.inviteStatus = "error";
    toast(`Não foi possível consultar os convites: ${error.message}`);
  }
  if (state.tab === "Cadastros") render();
}
async function inviteMember(form) {
  if (!state.online) return toast("Convites exigem conexão com a internet.");
  const email = field(form, "email").value.trim().toLowerCase();
  const name = field(form, "name").value.trim();
  if (!email || name.length < 2) return toast("Informe nome e e-mail válidos.");
  let data;
  try { data = await inviteRequest({ email, name }); }
  catch (error) { return toast(`Convite não enviado: ${error.message}`); }
  form.reset(); toast(data.existingUser
    ? "Acesso liberado. A pessoa pode entrar com a senha que já usa neste Supabase."
    : "Convite enviado. O responsável definirá a senha no primeiro acesso.");
  await loadData();
  if (state.tab === "Cadastros") void loadInviteStatuses();
}
document.addEventListener("submit", async (event) => {
  const form = event.target;
  // Um campo name="id" mascara form.id em navegadores; leia o atributo do form diretamente.
  const formId = form.getAttribute("id");
  if (!["auth-form", "invite-form", "company-form", "task-form", "holiday-form", "release-form", "comment-form", "suggestion-form", "closing-error-form", "general-routine-form"].includes(formId) && !["general-note", "general-recurrence"].includes(form.dataset.form)) return;
  event.preventDefault();
  try {
    if (formId === "auth-form") {
      const password = field(form, "password").value;
      if (state.needsPassword) {
        if (password !== field(form, "confirm").value) throw new Error("As senhas não coincidem.");
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        state.needsPassword = false; history.replaceState(null, "", location.pathname); await loadData();
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email: field(form, "email").value.trim(), password });
        if (error) throw error;
        state.session = data.session; loadCache(); await loadData();
      }
    } else if (formId === "invite-form") await inviteMember(form);
    else if (formId === "general-routine-form") {
      if (!state.generalReady) throw new Error("As rotinas avulsas ainda não estão disponíveis neste aparelho.");
      const title = field(form, "title").value.trim();
      const description = field(form, "description").value.trim() || null;
      const responsibleId = field(form, "responsible_id").value;
      const frequency = field(form, "recurrence_frequency").value;
      const nextDate = frequency === "monthly" ? field(form, "next_scheduled_date").value : null;
      if (title.length < 3 || title.length > 200 || !state.members.some((item) => item.id === responsibleId && item.active))
        throw new Error("Informe um nome e um responsável ativo para a rotina.");
      if (frequency === "monthly" && !nextDate) throw new Error("Informe a data da próxima execução mensal.");
      const row = { id: uid(), title, description, responsible_id: responsibleId, created_by: state.member.id,
        recurrence_frequency: frequency, next_scheduled_date: nextDate, recurrence_day: nextDate ? Number(nextDate.slice(-2)) : null };
      state.generalRoutines.push({ ...row, created_at: new Date().toISOString(), status: "Não iniciada", total_seconds: 0, started_at: null, first_started_at: null, finished_at: null });
      state.generalOpenId = row.id;
      state.generalCreateDraft = {}; state.generalCreateOpen = false;
      state.generalSearch = ""; state.generalStatusFilter = ""; state.generalMineOnly = false;
      enqueue({ kind: "insert", table: "fc_general_routines", row });
    }
    else if (form.dataset.form === "general-recurrence") {
      if (!state.generalReady) throw new Error("As rotinas avulsas ainda não estão disponíveis neste aparelho.");
      const routine = state.generalRoutines.find((item) => item.id === form.dataset.routineId);
      if (!routine || routine.status === "Finalizada") throw new Error("Esta rotina já foi finalizada.");
      if (routine.responsible_id !== state.member.id && !state.member.is_admin)
        throw new Error("Somente o responsável ou um administrador pode alterar a recorrência.");
      const frequency = field(form, "recurrence_frequency").value;
      const nextDate = frequency === "monthly" ? field(form, "next_scheduled_date").value : null;
      if (!['none', 'monthly'].includes(frequency) || (frequency === "monthly" && !nextDate))
        throw new Error("Informe a data da próxima execução mensal.");
      const anchorDay = nextDate ? (routine.recurrence_frequency === "monthly" && routine.next_scheduled_date === nextDate
        ? routine.recurrence_day : Number(nextDate.slice(-2))) : null;
      Object.assign(routine, { recurrence_frequency: frequency, next_scheduled_date: nextDate, recurrence_day: anchorDay });
      delete state.generalRecurrenceDrafts[routine.id];
      enqueue({ kind: "rpc", name: "fc_set_general_recurrence", args: {
        p_routine_id: routine.id, p_frequency: frequency, p_next_scheduled_date: nextDate,
      } });
    }
    else if (form.dataset.form === "general-note") {
      if (!state.generalReady) throw new Error("As anotações ainda não estão disponíveis neste aparelho.");
      const routine = state.generalRoutines.find((item) => item.id === form.dataset.routineId);
      if (!routine || routine.status === "Finalizada") throw new Error("Esta rotina já foi finalizada.");
      const body = field(form, "body").value.trim();
      if (!body || body.length > 4000) throw new Error("Informe uma anotação de até 4.000 caracteres.");
      const row = { id: uid(), routine_id: routine.id, author_id: state.member.id, body, occurred_at: new Date().toISOString() };
      state.generalNotes.push({ ...row, created_at: row.occurred_at });
      delete state.generalNoteDrafts[routine.id];
      enqueue({ kind: "insert", table: "fc_general_routine_notes", row });
    }
    else if (formId === "closing-error-form") {
      if (!state.errorFeatureReady) throw new Error("O controle de erros ainda não está disponível neste aparelho.");
      updateClosingErrorRequirements(form);
      const id = field(form, "error_id").value;
      const existing = id ? state.closingErrors.find((item) => item.id === id) : null;
      if (id && !existing) throw new Error("Este erro não está mais disponível para edição.");
      const status = field(form, "status").value;
      if (!errorStatuses.includes(status)) throw new Error("Selecione um status válido.");
      const correctionDate = field(form, "correction_date").value || null;
      const improvementValue = field(form, "system_improvement").value;
      if (status === "Corrigido" && !correctionDate) throw new Error("Informe a data da correção para concluir o erro.");
      if (status !== "Corrigido" && correctionDate) throw new Error("A data da correção só pode ser informada quando o status for Corrigido.");
      if (status === "Corrigido" && !improvementValue && !existing?.source_row) throw new Error("Informe se a correção veio de melhoria em sistema.");
      if (!form.checkValidity()) { form.reportValidity(); throw new Error("Revise os campos obrigatórios e as datas antes de salvar."); }
      const values = {
        company_name: field(form, "company_name").value.trim(), assigned_user: field(form, "assigned_user").value.trim() || null,
        requested_by: field(form, "requested_by").value.trim() || null, requested_at: field(form, "requested_at").value || null,
        error_label: field(form, "error_label").value.trim() || null, description: field(form, "description").value.trim(),
        status, system_improvement: status === "Corrigido" ? improvementValue === "" ? null : improvementValue === "true" : null,
        correction_date: correctionDate, updated_by: state.member.id,
      };
      if (values.company_name.length < 2 || !values.description) throw new Error("Informe empresa e descrição do erro.");
      if (existing) {
        if (state.queue.some((item) => item.table === "fc_closing_errors" && (item.where?.id === id || item.row?.id === id)))
          throw new Error("Este erro ainda tem uma alteração aguardando sincronização. Confira as pendências antes de editá-lo novamente.");
        if (state.online) {
          const button = form.querySelector('[type="submit"]');
          button.disabled = true;
          closingErrorNotice("Salvando a alteração no servidor…");
          try {
            const saved = await updateClosingError(id, values);
            Object.assign(existing, saved);
            closingErrorNotice("Alteração confirmada no servidor. Se o filtro estiver em ‘Aberto’, um item corrigido sairá dessa lista.");
            try { saveCache(); } catch { /* A gravação no servidor já foi confirmada. */ }
            render(); toast("Erro atualizado e confirmado no servidor.");
          } finally { button.disabled = false; }
        } else {
          Object.assign(existing, values);
          closingErrorNotice("Alteração guardada neste aparelho; aguarde a sincronização antes de considerar o erro corrigido.");
          enqueue({ kind: "update", table: "fc_closing_errors", where: { id }, values });
        }
      } else {
        const row = { id: uid(), ...values, created_by: state.member.id };
        state.closingErrors.push(row);
        closingErrorNotice("Novo erro guardado; aguardando confirmação do servidor.");
        enqueue({ kind: "insert", table: "fc_closing_errors", row });
      }
    }
    else if (formId === "comment-form") {
      const taskId = form.dataset.taskId, task = monthlyTasks().find((item) => item.id === taskId && !item.historic);
      const body = field(form, "body").value.trim();
      if (!state.collaborationReady || !task) throw new Error("Comentários indisponíveis nesta atividade.");
      if (body.length < 1 || body.length > 2000) throw new Error("Informe um comentário de até 2.000 caracteres.");
      const row = { id: uid(), task_id: taskId, competence: state.month, author_id: state.member.id, body };
      state.taskComments.push({ ...row, created_at: new Date().toISOString() });
      state.commentsMonth = state.month; delete state.commentDrafts[taskId];
      enqueue({ kind: "insert", table: "fc_task_comments", row });
    } else if (formId === "suggestion-form") {
      const body = field(form, "body").value.trim();
      if (!state.collaborationReady) throw new Error("As sugestões ainda não estão disponíveis.");
      if (body.length < 10 || body.length > 4000) throw new Error("Descreva a sugestão em 10 a 4.000 caracteres.");
      const row = { id: uid(), author_id: state.member.id, body };
      state.suggestions.push({ ...row, status: "Pendente", created_at: new Date().toISOString() });
      state.suggestionDraft = "";
      enqueue({ kind: "insert", table: "fc_improvement_suggestions", row });
    }
    else if (formId === "company-form") {
      if (isHistorical()) throw new Error("Selecione um mês atual ou futuro para cadastrar empresas.");
      const name = field(form, "name").value.trim(), category = field(form, "category").value;
      if (name.length < 2) throw new Error("Informe o nome da empresa.");
      if (state.companies.some((item) => item.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) throw new Error("Esta empresa já está cadastrada.");
      const id = uid();
      const company = { id, name, source_name: name, category, active: true };
      state.companies.push(company); enqueue({ kind: "upsert", table: "fc_companies", row: company, conflict: "id" });
      const goal = { company_id: id, competence: state.month, category, sort_order: state.targets.length + 1, business_day: null, planned_date: null, delivery_at: null };
      state.targets.push(goal); enqueue({ kind: "upsert", table: "fc_targets", row: goal, conflict: "company_id,competence" });
      const review = { id: `review-${id}`, company_id: id, account: "REVISÃO DE BALANCETE", group_name: "ENCERRAMENTO", responsible_id: null, responsible_legacy_name: null, created_competence: state.month, active: true };
      state.tasks.push(review); enqueue({ kind: "insert", table: "fc_tasks", row: review });
      form.reset(); toast("Empresa e revisão cadastradas."); render();
    } else if (formId === "task-form") {
      const company_id = field(form, "company_id").value, account = field(form, "account").value.trim();
      if (!company_id || !account) throw new Error("Informe empresa e rotina.");
      if (isHistorical()) throw new Error("Não é possível incluir rotinas em meses históricos.");
      const row = { id: uid(), company_id, account, group_name: field(form, "group_name").value.trim() || "OUTROS", responsible_id: null, responsible_legacy_name: null, created_competence: state.month, active: true };
      state.tasks.push(row); enqueue({ kind: "insert", table: "fc_tasks", row });
      const goal = state.targets.find((item) => item.company_id === company_id && item.competence === state.month);
      if (goal?.delivery_at) saveGoal(company_id, { delivery_at: null });
      form.reset(); toast("Rotina cadastrada."); render();
    } else if (formId === "release-form") {
      if (!state.member?.is_admin) throw new Error("Somente o administrador pode registrar versões.");
      if (!state.online) throw new Error("Conecte-se à internet para registrar uma atualização.");
      const version = field(form, "version").value.trim();
      const title = field(form, "title").value.trim();
      const details = field(form, "details").value.trim();
      if (!version || title.length < 3 || details.length < 10) throw new Error("Informe versão, título e uma descrição de pelo menos 10 caracteres.");
      const { error } = await client.from("fc_release_notes").insert({ version, title, details, created_by: state.member.id });
      if (error) throw error;
      toast("Atualização registrada."); await loadData();
    } else if (formId === "holiday-form") {
      const row = { date: field(form, "date").value, name: field(form, "name").value.trim(), created_by: state.member.id };
      if (!row.date || !row.name) throw new Error("Informe data e descrição.");
      changeLocal("holidays", row, ["date"]); enqueue({ kind: "upsert", table: "fc_holidays", row, conflict: "date" }); form.reset();
    }
  } catch (error) {
    if (formId === "closing-error-form") closingErrorNotice(`Não foi possível salvar: ${error.message || String(error)}`, true);
    toast(error.message || String(error));
    const message = $("#auth-error"); if (message) message.textContent = error.message || String(error);
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search") { state.query = event.target.value; const pos = event.target.selectionStart; render(); const input = $("#search"); input.focus(); input.setSelectionRange(pos, pos); }
  if (event.target.id === "general-search") { state.generalSearch = event.target.value; const pos = event.target.selectionStart; render(); const input = $("#general-search"); input.focus(); input.setSelectionRange(pos, pos); }
  if (event.target.id === "error-search") { state.errorSearch = event.target.value; const pos = event.target.selectionStart; render(); const input = $("#error-search"); input.focus(); input.setSelectionRange(pos, pos); }
  if (event.target.form?.id === "comment-form") state.commentDrafts[event.target.form.dataset.taskId] = event.target.value;
  if (event.target.form?.id === "general-routine-form") { state.generalCreateDraft[event.target.name] = event.target.value; state.generalCreateOpen = true; }
  if (event.target.form?.dataset.form === "general-recurrence") {
    const id = event.target.form.dataset.routineId;
    state.generalRecurrenceDrafts[id] ||= {};
    state.generalRecurrenceDrafts[id][event.target.name] = event.target.value;
  }
  if (event.target.form?.dataset.form === "general-note") state.generalNoteDrafts[event.target.form.dataset.routineId] = event.target.value;
  if (event.target.form?.id === "suggestion-form") state.suggestionDraft = event.target.value;
  if (event.target.matches("[data-suggestion-reason]")) state.suggestionReasonDrafts[event.target.dataset.suggestionReason] = event.target.value;
});
document.addEventListener("change", (event) => {
  const element = event.target;
  if (element.form?.getAttribute("id") === "closing-error-form" && element.name === "status") {
    updateClosingErrorRequirements(element.form);
    return;
  }
  if (element.form?.id === "general-routine-form" || element.form?.dataset.form === "general-recurrence") {
    if (element.form.id === "general-routine-form") { state.generalCreateDraft[element.name] = element.value; state.generalCreateOpen = true; }
    else {
      const id = element.form.dataset.routineId;
      state.generalRecurrenceDrafts[id] ||= {};
      state.generalRecurrenceDrafts[id][element.name] = element.value;
    }
    if (element.name === "recurrence_frequency") {
      const dateInput = field(element.form, "next_scheduled_date");
      dateInput.disabled = element.value !== "monthly";
      dateInput.required = element.value === "monthly";
      if (dateInput.disabled) {
        dateInput.value = "";
        if (element.form.id === "general-routine-form") state.generalCreateDraft.next_scheduled_date = "";
        else state.generalRecurrenceDrafts[element.form.dataset.routineId].next_scheduled_date = "";
      }
    }
    return;
  }
  if (element.id === "general-status-filter") { state.generalStatusFilter = element.value; render(); return; }
  if (element.id === "general-mine") { state.generalMineOnly = element.checked; render(); return; }
  if (element.id === "error-status-filter") { state.errorStatusFilter = element.value; render(); return; }
  if (element.id === "queue-backup-confirm") { state.recoveryBackupConfirmed = element.checked && state.recoveryBackupRequested; render(); return; }
  if (element.matches("[data-status-filter]")) {
    const status = element.dataset.statusFilter;
    state.statusFilters = element.checked ? [...state.statusFilters, status] : state.statusFilters.filter((item) => item !== status);
    state.statusFilters = executionStatuses.filter((item) => state.statusFilters.includes(item));
    applyExecutionFilters(); return;
  }
  if (element.matches("[data-group-filter]")) {
    const group = element.dataset.groupFilter;
    state.groupFilters = element.checked ? [...state.groupFilters, group] : state.groupFilters.filter((item) => item !== group);
    applyExecutionFilters(); return;
  }
  if (element.matches("[data-my-company-filter], [data-analysis-company-filter]")) {
    const key = element.matches("[data-my-company-filter]") ? "myPanelCompanyFilters" : "analysisCompanyFilters";
    const companyId = element.dataset.myCompanyFilter || element.dataset.analysisCompanyFilter;
    state[key] = element.checked ? [...state[key], companyId] : state[key].filter((id) => id !== companyId);
    const filterId = key === "myPanelCompanyFilters" ? "my-panel-company-filter" : "analysis-company-filter";
    render();
    const filter = document.getElementById(filterId); if (filter) filter.open = true;
    return;
  }
  if (element.id === "month") { state.month = element.value; state.commentTaskId = ""; state.query = ""; state.groupFilters = []; state.myPanelCompanyFilters = []; state.analysisCompanyFilters = []; state.executionOwnerWarning = ""; receiptEditor = null; render(); if (state.online) void loadData(); return; }
  if (element.id === "company-filter") { state.companyFilter = element.value; render(); return; }
  if (element.id === "owner-filter") { state.ownerFilter = element.value; render(); return; }
  const { action, id, department } = element.dataset;
  if (action === "task-owner") {
    const task = state.tasks.find((item) => item.id === id); if (!task) return;
    const row = { task_id: id, competence: state.month, responsible_id: element.value || null, responsible_legacy_name: null };
    if (state.executionOwnerWarning === id && row.responsible_id) state.executionOwnerWarning = "";
    changeLocal("owners", row, ["task_id", "competence"]);
    enqueue({ kind: "upsert", table: "fc_month_owners", row, conflict: "task_id,competence" });
  } else if (action === "goal-category") saveGoal(id, { category: element.value });
  else if (action === "goal-day") {
    const day = element.value ? Number(element.value) : null;
    if (day && (day < 1 || day > 23)) return toast("Informe um dia útil entre 1 e 23.");
    const date = plannedDate(state.month, day);
    if (day && !date) return toast("Este mês não possui tantos dias úteis. Escolha um número menor.");
    saveGoal(id, { business_day: day, planned_date: date });
  }
});
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const { action, id } = button.dataset;
  if (action === "copy-month-tasks") {
    if (!state.member?.is_admin || state.month < "2026-09") return;
    if (!state.online || state.queue.length) return toast("Conecte-se e sincronize os registros pendentes antes de copiar a lista.");
    const source = state.month, target = adjacentCompetence(source, 1);
    const sourceTasks = monthlyTasks();
    if (!sourceTasks.length) return toast("Não há rotinas no mês selecionado para copiar.");
    const unfinished = sourceTasks.filter((task) => statusOf(task) !== "Finalizado").length;
    const warning = unfinished ? `\n\nAtenção: ${unfinished} rotina(s) ainda não estão finalizadas no mês de origem. Você poderá repetir a cópia para acrescentar novos cadastros.` : "";
    if (!confirm(`Copiar a lista de ${monthName(source)} para ${monthName(target)}?\n\nSerão copiados somente cadastros e responsáveis. Os registros de execução não serão copiados, e tarefas já existentes ou iniciadas no destino permanecerão intactas.${warning}`)) return;
    button.disabled = true;
    const { data, error } = await client.rpc("fc_copy_month_tasks", { p_source_competence: source });
    if (error) { button.disabled = false; return toast(`Cópia não realizada: ${error.message}`); }
    await loadData();
    toast(`${data?.added ?? 0} rotina(s) acrescentada(s) em ${monthName(target)}. Selecione o mês de destino para conferir.`);
    return;
  }
  if (action === "general-activity") { actGeneralRoutine(id, button.dataset.kind); return; }
  if (action === "general-details") { state.generalOpenId = state.generalOpenId === id ? "" : id; render(); return; }
  if (action === "clear-error-form") { const form = $("#closing-error-form"); form?.reset(); if (form) { field(form, "error_id").value = ""; updateClosingErrorRequirements(form); } closingErrorNotice(""); return; }
  if (action === "edit-closing-error") {
    const item = state.closingErrors.find((row) => row.id === id);
    const form = $("#closing-error-form");
    if (!item || !form) return;
    field(form, "error_id").value = item.id;
    for (const name of ["company_name", "assigned_user", "requested_by", "requested_at", "error_label", "description", "status", "correction_date"])
      field(form, name).value = item[name] || "";
    field(form, "system_improvement").value = item.system_improvement === null || item.system_improvement === undefined ? "" : String(item.system_improvement);
    updateClosingErrorRequirements(form);
    closingErrorNotice("");
    $("#error-editor").open = true;
    $("#error-editor").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "download-queue") { downloadQueueBackup(); return; }
  if (action === "skip-duplicate-pause") { await skipDuplicatePause(); return; }
  if (action === "sync-queue") {
    if (!state.recoveryHold || !state.recoveryBackupRequested || !state.recoveryBackupConfirmed || !state.online) return;
    if (!confirm(`Confirma que revisou as ${state.queue.length} operações pendentes e salvou a cópia de segurança? Elas serão enviadas na ordem original. Em caso de erro, o envio será interrompido.`)) return;
    state.recoveryApproved = true; state.syncError = ""; render(); await flush(); return;
  }
  if (action === "clear-status-filter") { state.statusFilters = []; document.querySelectorAll("[data-status-filter]").forEach((input) => { input.checked = false; }); applyExecutionFilters(); return; }
  if (action === "clear-group-filter") { state.groupFilters = []; document.querySelectorAll("[data-group-filter]").forEach((input) => { input.checked = false; }); applyExecutionFilters(); return; }
  if (action === "clear-my-panel-company-filter" || action === "clear-analysis-company-filter") {
    state[action === "clear-my-panel-company-filter" ? "myPanelCompanyFilters" : "analysisCompanyFilters"] = [];
    render(); return;
  }
  if (action === "tab") {
    state.tab = button.dataset.tab;
    state.commentTaskId = "";
    if (state.tab === "Versões" && !state.member?.is_admin) state.tab = "Painel Geral";
    render();
    if (state.tab === "Cadastros") void loadInviteStatuses();
  }
  else if (action === "open-comments") { state.commentTaskId = id; render(); }
  else if (action === "close-comments") { state.commentTaskId = ""; render(); }
  else if (action === "decide-suggestion") {
    if (!state.member?.is_admin || !state.online) return toast("Somente um administrador conectado pode decidir sugestões.");
    const suggestion = state.suggestions.find((item) => item.id === id);
    const decision = button.dataset.decision, reason = document.querySelector(`[data-suggestion-reason="${CSS.escape(id)}"]`)?.value.trim();
    if (!suggestion || suggestion.status !== "Pendente" || !["Aceita", "Rejeitada"].includes(decision)) return;
    if (!reason || reason.length < 8 || reason.length > 1000) return toast("Informe um motivo de 8 a 1.000 caracteres para a decisão.");
    button.disabled = true;
    const { data, error } = await client.from("fc_improvement_suggestions")
      .update({ status: decision, decision_reason: reason, decided_by: state.member.id, decided_at: new Date().toISOString() })
      .eq("id", id).eq("status", "Pendente").select();
    if (error) { button.disabled = false; return toast(`Decisão não registrada: ${error.message}`); }
    if (!data?.length) { await loadData(); return toast("Esta sugestão já foi decidida por outro administrador."); }
    delete state.suggestionReasonDrafts[id];
    toast(`Sugestão ${decision.toLowerCase()} com motivo registrado.`); await loadData();
  }
  else if (action === "activity") act(id, button.dataset.kind);
  else if (action === "my-execution") { state.tab = "Execução"; state.ownerFilter = state.member.id; state.companyFilter = ""; state.query = ""; state.statusFilters = []; state.groupFilters = []; render(); }
  else if (action === "edit-time") await editActivityTime(id, button);
  else if (action === "edit-task-label") await editTaskLabel(id, button);
  else if (action === "reset-activity") await resetActivity(id, button);
  else if (action === "retire-task") await retireTask(id, button);
  else if (action === "choose-month") { state.month = button.dataset.month; state.groupFilters = []; state.tab = "Execução"; render(); }
  else if (action === "promote-member") await promoteMember(id, button);
  else if (action === "resend-invite") {
    if (!state.online) return toast("O reenvio exige conexão com a internet.");
    const person = state.members.find((item) => item.id === id);
    if (!state.member?.is_admin || !person || !state.invitePendingIds.includes(id)) return;
    button.disabled = true; button.textContent = "Enviando…";
    try {
      await inviteRequest({ action: "resend", memberId: id });
      toast(`Convite reenviado para ${person.name}.`);
      await loadInviteStatuses();
    } catch (error) {
      toast(`Convite não reenviado: ${error.message}`);
      button.disabled = false; button.textContent = "Reenviar convite";
    }
  }
  else if (action === "delete-member") {
    const person = state.members.find((item) => item.id === id);
    if (!state.member?.is_admin || !person || person.id === state.member.id) return;
    if (!state.online || state.queue.length) return toast("Sincronize os registros pendentes antes de excluir um acesso.");
    if (!confirm(`Excluir o acesso de ${person.name}? A exclusão só será aceita se não houver registros de execução. As rotinas atribuídas ficarão sem responsável.`)) return;
    button.disabled = true;
    const { error } = await client.rpc("fc_remove_member", { p_member_id: id });
    if (error) { button.disabled = false; return toast(`Responsável não excluído: ${error.message}`); }
    toast(`Acesso de ${person.name} excluído do fechamento.`); await loadData(); void loadInviteStatuses();
  }
  else if (action === "member-name") {
    const member = state.members.find((item) => item.id === id);
    const name = document.querySelector(`[data-member-name="${CSS.escape(id)}"]`)?.value.trim();
    if (!member || !name || name.length < 2) return toast("Informe um nome válido.");
    member.name = name; enqueue({ kind: "update", table: "fc_members", where: { id }, values: { name } });
  } else if (action === "legacy-name") {
    const oldName = button.dataset.old;
    const name = document.querySelector(`[data-legacy-name="${CSS.escape(oldName)}"]`)?.value.trim();
    if (!name || name.length < 2) return toast("Informe um nome válido.");
    const matches = [
      ...state.tasks.filter((item) => !item.responsible_id && item.responsible_legacy_name === oldName).map((item) => ({ item, table: "fc_tasks", where: { id: item.id } })),
      ...state.owners.filter((item) => !item.responsible_id && item.responsible_legacy_name === oldName).map((item) => ({ item, table: "fc_month_owners", where: { task_id: item.task_id, competence: item.competence } })),
    ];
    for (const { item, table, where } of matches) {
      item.responsible_legacy_name = name;
      enqueue({ kind: "update", table, where, values: { responsible_legacy_name: name } });
    }
    toast(`${matches.length} vínculo(s) atualizado(s).`);
  } else if (action === "delete-legacy") {
    const oldName = button.dataset.old;
    if (!state.member?.is_admin || !confirm(`Excluir o pré-cadastro de ${oldName}? As rotinas ficarão sem responsável.`)) return;
    const matches = [
      ...state.tasks.filter((item) => !item.responsible_id && item.responsible_legacy_name === oldName).map((item) => ({ item, table: "fc_tasks", where: { id: item.id } })),
      ...state.owners.filter((item) => !item.responsible_id && item.responsible_legacy_name === oldName).map((item) => ({ item, table: "fc_month_owners", where: { task_id: item.task_id, competence: item.competence } })),
    ];
    for (const { item, table, where } of matches) {
      item.responsible_legacy_name = null;
      enqueue({ kind: "update", table, where, values: { responsible_legacy_name: null } });
    }
    toast(`Pré-cadastro de ${oldName} excluído.`);
  } else if (action === "company-name") {
    const company = state.companies.find((item) => item.id === id);
    const name = document.querySelector(`[data-company-name="${CSS.escape(id)}"]`)?.value.trim();
    if (!company || !name || name.length < 2) return toast("Informe um nome válido.");
    if (state.companies.some((item) => item.id !== id && item.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) return toast("Esta empresa já está cadastrada.");
    company.name = name; enqueue({ kind: "update", table: "fc_companies", where: { id }, values: { name } });
  } else if (action === "move") {
    const company = state.companies.find((item) => item.id === id); if (!company) return;
    const inDeliveredBoard = companyDeliveriesComplete(id);
    const ordered = orderedGoals().filter((item) => companyDeliveriesComplete(item.id) === inDeliveredBoard);
    const index = ordered.findIndex((item) => item.id === id), other = ordered[index + (button.dataset.direction === "up" ? -1 : 1)];
    if (!other || other.goal.category !== ordered[index].goal.category) return;
    const previousOrder = ordered[index].goal.sort_order, nextOrder = other.goal.sort_order;
    saveGoal(id, { sort_order: nextOrder }); saveGoal(other.id, { sort_order: previousOrder });
  } else if (action === "print-goals") {
    window.print();
  } else if (action === "print-closing-monthly") {
    const monthly = button.closest(".closing-monthly");
    if (!monthly) return;
    monthly.open = true;
    document.body.classList.add("print-closing-monthly");
    window.addEventListener("afterprint", () => document.body.classList.remove("print-closing-monthly"), { once: true });
    window.print();
  } else if (action === "xlsx-goals") {
    exportGoalsXlsx();
  } else if (action === "forgot-password") {
    const email = prompt("Informe o e-mail cadastrado para receber o link de recuperação:");
    if (!email) return;
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.href.split("#")[0] });
    toast(error ? error.message : "Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha.");
  } else if (action === "logout") {
    if (state.queue.length) return toast("Há registros pendentes. Sincronize antes de sair para não perdê-los.");
    localStorage.removeItem(cacheKey()); localStorage.removeItem(queueKey()); localStorage.removeItem(recoveryKey()); localStorage.removeItem(recoveryErrorKey());
    await client.auth.signOut(); state.session = null; state.member = null; state.ready = false; render();
  }
});
window.addEventListener("online", () => { state.online = true; void flush(); render(); });
window.addEventListener("offline", () => { state.online = false; render(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.commentTaskId) { state.commentTaskId = ""; render(); } });
setInterval(() => {
  state.tick = Date.now();
  if (state.tab === "Rotinas avulsas") {
    document.querySelectorAll(".general-live-time").forEach((element) => {
      const routine = state.generalRoutines.find((item) => item.id === element.dataset.id);
      if (routine) element.textContent = duration(generalRoutineSeconds(routine));
    });
  }
  if (state.tab !== "Execução") return;
  document.querySelectorAll(".live-time").forEach((element) => { element.textContent = duration(currentSeconds(taskState(element.dataset.id))); });
}, 1000);
setInterval(() => { if (state.session && state.member && state.online) state.queue.length ? void flush() : void loadData(); }, 45000);
client.auth.onAuthStateChange((_event, session) => {
  if (_event === "PASSWORD_RECOVERY") state.needsPassword = true;
  if (session && !state.session) { state.session = session; loadCache(); setTimeout(() => void loadData(), 0); }
});
(async () => {
  const { data } = await client.auth.getSession();
  state.session = data.session;
  if (expiredAuthLink) history.replaceState(null, "", location.pathname + location.search);
  if (state.session) { loadCache(); await loadData(); }
  else renderAuth();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();

