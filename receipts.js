/* A data do e-mail é informada pelo usuário; o horário do lançamento é guardado à parte. */
const RECEIPT_BUCKET = "fc-receipt-evidence";
let receiptEditor = null;
let receiptSyncing = false;
let pendingReceiptItems = [];

function receiptStatusLabel(status) {
  return status === "Recebido" ? "Recebido" : status === "Parcial" ? "Recebido parcial" : status || "Pendente";
}

function receiptDeliveriesFor(companyId, department) {
  return state.receiptDeliveries.filter((item) => item.company_id === companyId && item.competence === state.month && item.department === department)
    .sort((a, b) => String(a.delivered_at).localeCompare(String(b.delivered_at)));
}
function pendingReceiptRows(companyId, department) {
  return pendingReceiptItems.filter((item) => item.user_id === state.member?.id && item.row.company_id === companyId
    && item.row.competence === state.month && item.row.department === department).map((item) => item.row);
}
function receiptStatusFor(companyId, department) {
  const receipt = receiptFor(companyId, department);
  const pendingRows = pendingReceiptRows(companyId, department);
  return receipt?.status === "Recebido" || pendingRows.some((item) => item.completeness === "Completa") ? "Recebido"
    : pendingRows.length ? "Parcial" : receipt?.status || "Pendente";
}
function companyDeliveriesComplete(companyId) {
  return departments.every((department) => ["Recebido", "N/A"].includes(receiptStatusFor(companyId, department)));
}
function renderReceiptCell(company, department) {
  const receipt = receiptFor(company.id, department);
  const pendingRows = pendingReceiptRows(company.id, department);
  const status = receiptStatusFor(company.id, department);
  const lastEmailAt = [receipt?.received_at, ...pendingRows.map((item) => item.delivered_at)].filter(Boolean).sort().at(-1);
  const count = receiptDeliveriesFor(company.id, department).length;
  const pending = pendingRows.length;
  const canRegister = !isHistorical() && state.receiptFeatureReady;
  return `<td class="receipt-cell" data-label="${esc(department)}"><strong class="receipt-status ${status === "Recebido" ? "complete" : status === "Parcial" ? "partial" : ""}">${esc(receiptStatusLabel(status))}</strong>
    <small>${lastEmailAt ? brasilia(lastEmailAt) : status === "N/A" ? "Não aplicável" : "Aguardando"}</small>
    ${canRegister ? `<select class="select receipt-status-select" aria-label="Status de ${esc(department)} para ${esc(company.name)}" data-action="receipt-status" data-id="${esc(company.id)}" data-department="${department}">
      <option value="Pendente" ${status === "Pendente" ? "selected" : ""}>Pendente</option><option value="Parcial" ${status === "Parcial" ? "selected" : ""}>Recebido parcial</option><option value="Recebido" ${status === "Recebido" ? "selected" : ""}>Recebido</option><option value="N/A" ${status === "N/A" ? "selected" : ""}>N/A</option></select>` : ""}
    <button class="btn compact" type="button" data-action="receipt-open" data-id="${esc(company.id)}" data-department="${department}" ${canRegister || count ? "" : "disabled"}>${canRegister ? "Registrar / ver entregas" : `Ver ${count} entrega(s)`}</button>
    ${pending ? `<small class="receipt-pending">${pending} entrega(s) aguardando sincronização</small>` : ""}</td>`;
}
function renderReceiptPanel() {
  if (!receiptEditor) return "";
  const { companyId, department } = receiptEditor;
  const company = state.companies.find((item) => item.id === companyId);
  if (!company) return "";
  const history = receiptDeliveriesFor(companyId, department);
  const draft = receiptEditor.draft || {};
  const pending = pendingReceiptItems.filter((item) => item.user_id === state.member?.id && item.row.company_id === companyId
    && item.row.competence === state.month && item.row.department === department);
  const entries = [...history.map((item) => ({ ...item, pending: false })), ...pending.map((item) => ({ ...item.row, pending: true }))]
    .sort((a, b) => String(b.delivered_at).localeCompare(String(a.delivered_at)));
  return `<section class="panel receipt-panel" id="receipt-panel"><div class="panel-head"><div><h2>Entregas de ${esc(department.toUpperCase())}</h2><p>${esc(company.name)} · ${esc(monthName(state.month))}</p></div><button class="btn compact" type="button" data-action="receipt-close">Fechar</button></div><div class="panel-body">
    ${!state.receiptFeatureReady ? '<div class="notice warn">O cadastro de entregas ainda está sendo configurado. Os registros anteriores permanecem preservados.</div>' : ""}
    ${!isHistorical() && state.receiptFeatureReady ? `<form id="receipt-form" class="receipt-form">
      <label class="field"><span>Data e hora do e-mail recebido · Brasília/DF</span><input id="receipt-delivered-at" name="delivered_at" class="input" type="text" inputmode="text" autocomplete="off" placeholder="qui 01/10/2026 11:45" value="${esc(draft.deliveredAt || "")}" required><small>Cole o horário mostrado no e-mail: qui 01/10/2026 11:45 ou 01/10/2026 11:45. Não use o horário do lançamento no painel.</small></label>
      <label class="field"><span>Esta entrega foi parcial ou completa?</span><select name="completeness" class="select" required><option value="" ${!draft.completeness ? "selected" : ""}>Selecione</option><option value="Parcial" ${draft.completeness === "Parcial" ? "selected" : ""}>Parcial — mantém o item aberto</option><option value="Completa" ${draft.completeness === "Completa" ? "selected" : ""}>Completa — encerra o item</option></select></label>
      <div class="receipt-preview" id="receipt-status-preview" role="status" aria-live="polite">Cole a data e hora do e-mail e informe se a entrega foi parcial ou completa.</div>
      <label class="field"><span>O que foi entregue ou ainda falta? (opcional)</span><textarea name="note" class="input" rows="2" maxlength="500">${esc(draft.note || "")}</textarea></label>
      <button class="btn primary" type="submit">Registrar entrega</button></form>` : ""}
    <h3 class="section-title">Histórico de recebimentos</h3><div class="receipt-history">${entries.length ? entries.map((item) => `<div class="receipt-entry"><div><strong>${item.completeness === "Completa" ? "Recebido" : "Recebido parcial"}${item.pending ? " · aguardando sincronização" : ""}</strong><small>E-mail recebido em ${brasilia(item.delivered_at)}</small>${item.source === "legacy" ? '<small>Registro anterior; horário do lançamento original não disponível.</small>' : `<small>Lançado no painel em ${brasilia(item.recorded_at)}</small>`}${item.note ? `<p>${esc(item.note)}</p>` : ""}</div>${item.evidence_path ? `<button class="btn compact" type="button" data-action="receipt-view" data-id="${esc(item.id)}" ${item.pending ? 'data-pending="true"' : ""}>Ver print anterior</button>` : ""}</div>`).join("") : '<p class="muted">Nenhuma entrega registrada para este setor neste mês.</p>'}</div>
  </div></section>`;
}

function parseReceiptEmailDate(value) {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const match = normalized.match(/^(?:(dom|seg|ter|qua|qui|sex|sab)\.?[,]?[\s]+)?(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, weekday, dayText, monthText, yearText, hourText, minuteText] = match;
  const day = Number(dayText), month = Number(monthText), year = Number(yearText), hour = Number(hourText), minute = Number(minuteText);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  if (calendarDay.getUTCFullYear() !== year || calendarDay.getUTCMonth() !== month - 1 || calendarDay.getUTCDate() !== day) return null;
  if (weekday && ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][calendarDay.getUTCDay()] !== weekday) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]));
    const seen = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    instant += target - seen;
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]));
  if ([parts.year, parts.month, parts.day, parts.hour, parts.minute].join("-") !== [year, month, day, hour, minute].join("-")) return null;
  return new Date(instant).toISOString();
}
function updateReceiptPreview() {
  const form = document.getElementById("receipt-form"), preview = document.getElementById("receipt-status-preview");
  if (!form || !preview) return;
  const value = form.elements.namedItem("delivered_at").value.trim();
  const complete = form.elements.namedItem("completeness").value;
  const iso = parseReceiptEmailDate(value);
  if (!value) preview.textContent = "Cole a data e hora do e-mail e informe se a entrega foi parcial ou completa.";
  else if (!iso) preview.textContent = "Confira a data e hora. Use, por exemplo, qui 01/10/2026 11:45 ou 01/10/2026 11:45.";
  else if (Date.parse(iso) > Date.now() + 5 * 60000) preview.textContent = "O horário do e-mail está no futuro. Confira antes de registrar.";
  else if (!complete) preview.textContent = `E-mail recebido em ${brasilia(iso)}. Informe se a entrega foi parcial ou completa.`;
  else {
    const alreadyComplete = receiptEditor && (receiptFor(receiptEditor.companyId, receiptEditor.department)?.status === "Recebido"
      || pendingReceiptItems.some((item) => item.user_id === state.member?.id && item.row.company_id === receiptEditor.companyId
        && item.row.competence === state.month && item.row.department === receiptEditor.department && item.row.completeness === "Completa"));
    preview.textContent = `Status após salvar: ${alreadyComplete || complete === "Completa" ? "Recebido" : "Recebido parcial"} · e-mail recebido em ${brasilia(iso)}. O horário do lançamento será registrado separadamente.`;
  }
}

function receiptDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fc_receipt_queue_v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pending", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function receiptStore(method, value) {
  const db = await receiptDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("pending", method === "all" ? "readonly" : "readwrite");
      const store = tx.objectStore("pending");
      const request = method === "all" ? store.getAll() : method === "put" ? store.put(value) : store.delete(value);
      if (method === "all") request.onsuccess = () => resolve(request.result);
      else tx.oncomplete = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function refreshPendingReceipts() {
  try { pendingReceiptItems = await receiptStore("all"); }
  catch { pendingReceiptItems = []; }
  if (state.session && state.tab === "Metas") render();
}
async function ensureReceiptTarget(row) {
  const { data, error } = await client.from("fc_targets").select("company_id").eq("company_id", row.company_id).eq("competence", row.competence).maybeSingle();
  if (error) throw error;
  if (data) return;
  const company = state.companies.find((item) => item.id === row.company_id);
  if (!company) throw new Error("Empresa não encontrada.");
  const { error: insertError } = await client.from("fc_targets").insert({ company_id: row.company_id, competence: row.competence,
    category: company.category, sort_order: 9999, business_day: null, planned_date: null, delivery_at: null });
  if (insertError && insertError.code !== "23505") throw insertError;
}
async function syncReceiptPending() {
  if (receiptSyncing || !navigator.onLine || !state.member || !state.receiptFeatureReady) return;
  receiptSyncing = true;
  try {
    const items = (await receiptStore("all")).filter((item) => item.user_id === state.member.id);
    for (const item of items) {
      const { data: existing, error: lookupError } = await client.from("fc_receipt_deliveries").select("id").eq("id", item.id).maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) {
        await ensureReceiptTarget(item.row);
        if (item.row.evidence_path) {
          if (!item.file) throw new Error("Um print antigo pendente não está mais disponível neste navegador.");
          const { error: uploadError } = await client.storage.from(RECEIPT_BUCKET).upload(item.row.evidence_path, item.file, { contentType: item.file.type, upsert: false });
          if (uploadError && !/already exists|duplicate/i.test(uploadError.message || "")) throw uploadError;
        }
        const row = item.row.evidence_path ? { ...item.row, source: "print" } : item.row;
        const { error: insertError } = await client.from("fc_receipt_deliveries").insert(row);
        if (insertError && insertError.code !== "23505") throw insertError;
      }
      await receiptStore("delete", item.id);
    }
    if (items.length) { pendingReceiptItems = await receiptStore("all"); await loadData(); toast("Entregas sincronizadas."); }
  } catch (error) { toast(`Sincronização das entregas pendente: ${error.message || error}`); }
  finally { receiptSyncing = false; }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const { action, id, department } = button.dataset;
  if (action === "receipt-open") {
    receiptEditor = { companyId: id, department, draft: {} };
    render(); document.getElementById("receipt-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action === "receipt-close") {
    receiptEditor = null; render();
  } else if (action === "receipt-view") {
    const pending = button.dataset.pending === "true";
    const item = pending ? pendingReceiptItems.find((entry) => entry.id === id)?.row : state.receiptDeliveries.find((entry) => entry.id === id);
    if (!item?.evidence_path) return;
    const tab = window.open("", "_blank");
    try {
      const file = pending ? pendingReceiptItems.find((entry) => entry.id === id)?.file
        : (await client.storage.from(RECEIPT_BUCKET).download(item.evidence_path)).data;
      if (!file) throw new Error("Print indisponível.");
      const url = URL.createObjectURL(file);
      if (tab) { tab.opener = null; tab.location.href = url; }
      else toast("O navegador bloqueou a abertura do print. Permita novas abas para este site.");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { tab?.close(); toast(`Não foi possível abrir o print: ${error.message || error}`); }
  }
});
document.addEventListener("change", (event) => {
  if (event.target.name === "completeness" && event.target.closest("#receipt-form")) {
    if (receiptEditor) receiptEditor.draft.completeness = event.target.value;
    return updateReceiptPreview();
  }
  if (event.target.dataset.action !== "receipt-status" || !state.receiptFeatureReady || isHistorical() || !state.member) return;
  const { id, department } = event.target.dataset, nextStatus = event.target.value;
  const current = receiptFor(id, department)?.status || "Pendente";
  if (nextStatus === current && !pendingReceiptItems.some((item) => item.user_id === state.member.id
    && item.row.company_id === id && item.row.competence === state.month && item.row.department === department)) return;
  if (nextStatus === "Parcial" || nextStatus === "Recebido") {
    receiptEditor = { companyId: id, department, draft: { completeness: nextStatus === "Recebido" ? "Completa" : "Parcial" } };
    render();
    document.getElementById("receipt-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const hasDeliveries = receiptDeliveriesFor(id, department).length || pendingReceiptItems.some((item) => item.user_id === state.member.id
    && item.row.company_id === id && item.row.competence === state.month && item.row.department === department);
  if (hasDeliveries) { render(); return toast("Há recebimentos registrados para este setor. O histórico não pode ser apagado ao mudar o status."); }
  const row = { company_id: id, competence: state.month, department, status: nextStatus, received_at: null, updated_by: state.member.id };
  changeLocal("receipts", row, ["company_id", "competence", "department"]);
  if (!state.targets.some((item) => item.company_id === id && item.competence === state.month)) saveGoal(id, {});
  enqueue({ kind: "upsert", table: "fc_receipts", row, conflict: "company_id,competence,department" });
});
document.addEventListener("input", (event) => {
  if (!receiptEditor || !event.target.closest("#receipt-form")) return;
  if (event.target.id === "receipt-delivered-at") {
    receiptEditor.draft.deliveredAt = event.target.value;
    updateReceiptPreview();
  } else if (event.target.name === "note") receiptEditor.draft.note = event.target.value;
});
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "receipt-form") return;
  event.preventDefault();
  if (!receiptEditor || !state.member || !state.receiptFeatureReady) return;
  const form = event.target;
  const deliveredAt = parseReceiptEmailDate(form.elements.namedItem("delivered_at")?.value);
  if (!deliveredAt || Date.parse(deliveredAt) > Date.now() + 5 * 60000) return toast("Confira o formato e a data e hora do e-mail recebido.");
  const completeness = form.elements.namedItem("completeness")?.value;
  if (!["Parcial", "Completa"].includes(completeness)) return toast("Informe se a entrega foi parcial ou completa.");
  if (!confirm(`Confirmar entrega ${completeness.toLowerCase()} de ${receiptEditor.department.toUpperCase()}?\n\nE-mail recebido em ${brasilia(deliveredAt)}. O momento do lançamento será registrado separadamente.`)) return;
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const id = crypto.randomUUID();
    const row = { id, company_id: receiptEditor.companyId, competence: state.month, department: receiptEditor.department,
      completeness, delivered_at: deliveredAt, evidence_path: null, source: "manual", recorded_at: new Date().toISOString(),
      note: form.elements.namedItem("note")?.value.trim() || null, recorded_by: state.member.id };
    await receiptStore("put", { id, user_id: state.member.id, row });
    receiptEditor = null;
    await refreshPendingReceipts();
    toast(navigator.onLine ? "Entrega salva; sincronizando…" : "Entrega salva neste aparelho; será sincronizada quando houver conexão.");
    void syncReceiptPending();
  } catch (error) { button.disabled = false; toast(`Entrega não salva: ${error.message || error}`); }
});
window.addEventListener("online", () => void syncReceiptPending());
document.addEventListener("DOMContentLoaded", () => void refreshPendingReceipts());

