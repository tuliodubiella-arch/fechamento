/* Os prints são processados no navegador; o texto reconhecido nunca é enviado ou armazenado. */
const RECEIPT_BUCKET = "fc-receipt-evidence";
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
let receiptEditor = null;
let receiptPreviewUrl = null;
let receiptSyncing = false;
let pendingReceiptItems = [];

function receiptDeliveriesFor(companyId, department) {
  return state.receiptDeliveries.filter((item) => item.company_id === companyId && item.competence === state.month && item.department === department)
    .sort((a, b) => String(a.delivered_at).localeCompare(String(b.delivered_at)));
}
function renderReceiptCell(company, department) {
  const receipt = receiptFor(company.id, department);
  const status = receipt?.status === "Recebido" ? "Completo" : receipt?.status || "Pendente";
  const count = receiptDeliveriesFor(company.id, department).length;
  const pending = pendingReceiptItems.filter((item) => item.user_id === state.member?.id && item.row.company_id === company.id
    && item.row.competence === state.month && item.row.department === department).length;
  const canRegister = !isHistorical() && state.receiptFeatureReady;
  return `<td class="receipt-cell"><strong class="receipt-status ${status === "Completo" ? "complete" : status === "Parcial" ? "partial" : ""}">${esc(status)}</strong>
    <small>${receipt?.received_at ? brasilia(receipt.received_at) : status === "N/A" ? "Não aplicável" : "Aguardando"}</small>
    <button class="btn compact" type="button" data-action="receipt-open" data-id="${esc(company.id)}" data-department="${department}" ${canRegister || count ? "" : "disabled"}>${canRegister ? "Registrar / ver entregas" : `Ver ${count} entrega(s)`}</button>
    ${pending ? `<small class="receipt-pending">${pending} print(s) pendente(s) de envio</small>` : ""}
    ${canRegister && !count ? `<button class="btn compact" type="button" data-action="receipt-na" data-id="${esc(company.id)}" data-department="${department}">${status === "N/A" ? "Reativar" : "Marcar N/A"}</button>` : ""}</td>`;
}
function renderReceiptPanel() {
  if (!receiptEditor) return "";
  const { companyId, department } = receiptEditor;
  const company = state.companies.find((item) => item.id === companyId);
  if (!company) return "";
  const history = receiptDeliveriesFor(companyId, department);
  const pending = pendingReceiptItems.filter((item) => item.user_id === state.member?.id && item.row.company_id === companyId
    && item.row.competence === state.month && item.row.department === department);
  const entries = [...history.map((item) => ({ ...item, pending: false })), ...pending.map((item) => ({ ...item.row, pending: true }))]
    .sort((a, b) => String(b.delivered_at).localeCompare(String(a.delivered_at)));
  return `<section class="panel receipt-panel" id="receipt-panel"><div class="panel-head"><div><h2>Entregas de ${esc(department.toUpperCase())}</h2><p>${esc(company.name)} · ${esc(monthName(state.month))}</p></div><button class="btn compact" type="button" data-action="receipt-close">Fechar</button></div><div class="panel-body">
    ${!state.receiptFeatureReady ? '<div class="notice warn">O cadastro de evidências ainda está sendo configurado. Os registros anteriores permanecem preservados.</div>' : ""}
    ${!isHistorical() && state.receiptFeatureReady ? `<form id="receipt-form" class="receipt-form"><label class="field"><span>Print do e-mail recebido</span><input id="receipt-image" class="input" type="file" accept="image/png,image/jpeg,image/webp" required><small>PNG, JPG ou WebP, até 5 MB. O print será salvo como evidência, mas o texto reconhecido não será guardado. Recorte informações desnecessárias antes de enviar.</small></label>
      <div class="receipt-preview"><img id="receipt-preview-image" alt="Prévia do print" hidden><p id="receipt-ocr-status" class="muted">Selecione o print para localizar a data e hora.</p></div>
      <label class="field"><span>Datas encontradas no print</span><select id="receipt-candidates" class="select" disabled><option value="">Aguardando leitura da imagem</option></select></label>
      <label class="field"><span>Data e hora do recebimento do e-mail · Brasília/DF</span><input id="receipt-delivered-at" name="delivered_at" class="input" type="datetime-local" step="1" required><small>Confirme este horário antes de registrar. Se a leitura não o localizar, informe-o manualmente.</small></label>
      <label class="field"><span>Esta entrega foi</span><select name="completeness" class="select" required><option value="Parcial">Parcial — mantém o item aberto</option><option value="Completa">Completa — encerra o item</option></select></label>
      <label class="field"><span>O que foi entregue ou ainda falta? (opcional)</span><textarea name="note" class="input" rows="2" maxlength="500"></textarea></label>
      <button class="btn primary" type="submit">Registrar entrega e print</button></form>` : ""}
    <h3 class="section-title">Histórico de recebimentos</h3><div class="receipt-history">${entries.length ? entries.map((item) => `<div class="receipt-entry"><div><strong>${item.completeness === "Completa" ? "Completa" : "Parcial"}${item.pending ? " · aguardando sincronização" : ""}</strong><small>E-mail recebido em ${brasilia(item.delivered_at)}</small>${item.note ? `<p>${esc(item.note)}</p>` : ""}${item.source === "legacy" ? '<small>Registro anterior, sem print anexado.</small>' : ""}</div>${item.evidence_path ? `<button class="btn compact" type="button" data-action="receipt-view" data-id="${esc(item.id)}" ${item.pending ? 'data-pending="true"' : ""}>Ver print</button>` : ""}</div>`).join("") : '<p class="muted">Nenhuma entrega registrada para este setor neste mês.</p>'}</div>
  </div></section>`;
}

function receiptDatesFromText(text) {
  const dates = new Set();
  const add = (day, month, year, hour, minute, second = "00") => {
    const y = Number(year) < 100 ? 2000 + Number(year) : Number(year);
    const d = Number(day), m = Number(month), h = Number(hour), min = Number(minute), sec = Number(second);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || h > 23 || min > 59 || sec > 59) return;
    dates.add(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`);
  };
  const numeric = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\s*(?:,|às?|as)?\s*(\d{1,2})[:h](\d{2})(?::(\d{2}))?/gi;
  for (const match of text.matchAll(numeric)) add(match[1], match[2], match[3], match[4], match[5], match[6]);
  const months = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const written = /(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\s*(?:,|às?|as)?\s*(\d{1,2})[:h](\d{2})(?::(\d{2}))?/gi;
  for (const match of normalized.matchAll(written)) add(match[1], months[match[2]], match[3], match[4], match[5], match[6]);
  return [...dates];
}
async function readReceiptImage(file) {
  const status = document.getElementById("receipt-ocr-status");
  const choices = document.getElementById("receipt-candidates");
  const time = document.getElementById("receipt-delivered-at");
  if (!status || !choices || !time) return;
  status.textContent = "Lendo a data e hora no print…";
  choices.disabled = true;
  let worker;
  try {
    if (!window.Tesseract) throw new Error("O leitor de imagens ainda não está disponível neste aparelho.");
    worker = await window.Tesseract.createWorker("por");
    const { data } = await worker.recognize(file);
    if (document.getElementById("receipt-image")?.files?.[0] !== file || !status.isConnected) return;
    const dates = receiptDatesFromText(data.text || "");
    choices.replaceChildren(...dates.map((value) => { const option = document.createElement("option"); option.value = value; option.textContent = new Date(`${value}-03:00`).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }); return option; }));
    choices.disabled = !dates.length;
    if (dates.length) {
      time.value = dates[0];
      status.textContent = `${dates.length} data(s) e horário(s) encontrados. Confira se o primeiro corresponde ao recebimento do e-mail.`;
    } else status.textContent = "A leitura não encontrou data e hora juntas. Informe o horário manualmente com base no print.";
  } catch (error) { status.textContent = `Não foi possível ler automaticamente: ${error.message || error}. Informe o horário manualmente.`; }
  finally { if (worker) await worker.terminate(); }
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
        const { error: uploadError } = await client.storage.from(RECEIPT_BUCKET).upload(item.row.evidence_path, item.file, { contentType: item.file.type, upsert: false });
        if (uploadError && !/already exists|duplicate/i.test(uploadError.message || "")) throw uploadError;
        const { error: insertError } = await client.from("fc_receipt_deliveries").insert(item.row);
        if (insertError && insertError.code !== "23505") throw insertError;
      }
      await receiptStore("delete", item.id);
    }
    if (items.length) { pendingReceiptItems = await receiptStore("all"); await loadData(); toast("Entregas e prints sincronizados."); }
  } catch (error) { toast(`Envio de prints pendente: ${error.message || error}`); }
  finally { receiptSyncing = false; }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const { action, id, department } = button.dataset;
  if (action === "receipt-open") {
    receiptEditor = { companyId: id, department };
    render(); document.getElementById("receipt-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action === "receipt-close") {
    receiptEditor = null; if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl); receiptPreviewUrl = null; render();
  } else if (action === "receipt-na") {
    if (!state.receiptFeatureReady || isHistorical()) return;
    const previous = receiptFor(id, department);
    const nextStatus = previous?.status === "N/A" ? "Pendente" : "N/A";
    if (nextStatus === "N/A" && receiptDeliveriesFor(id, department).length) return toast("Há entregas registradas. Não é possível marcar este setor como N/A.");
    const row = { company_id: id, competence: state.month, department, status: nextStatus, received_at: null, updated_by: state.member.id };
    changeLocal("receipts", row, ["company_id", "competence", "department"]);
    if (!state.targets.some((item) => item.company_id === id && item.competence === state.month)) saveGoal(id, {});
    enqueue({ kind: "upsert", table: "fc_receipts", row, conflict: "company_id,competence,department" });
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
  if (event.target.id === "receipt-candidates") document.getElementById("receipt-delivered-at").value = event.target.value;
  if (event.target.id !== "receipt-image") return;
  const file = event.target.files?.[0]; if (!file) return;
  const status = document.getElementById("receipt-ocr-status");
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > RECEIPT_MAX_BYTES) {
    event.target.value = ""; status.textContent = "Use um print PNG, JPG ou WebP de até 5 MB."; return;
  }
  if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
  receiptPreviewUrl = URL.createObjectURL(file);
  const image = document.getElementById("receipt-preview-image"); image.src = receiptPreviewUrl; image.hidden = false;
  void readReceiptImage(file);
});
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "receipt-form") return;
  event.preventDefault();
  if (!receiptEditor || !state.member || !state.receiptFeatureReady) return;
  const form = event.target, file = document.getElementById("receipt-image")?.files?.[0];
  const local = form.elements.namedItem("delivered_at")?.value;
  if (!file || !local || !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > RECEIPT_MAX_BYTES) return toast("Selecione um print válido e confirme a data e hora.");
  const deliveredAt = new Date(`${local}-03:00`);
  if (Number.isNaN(deliveredAt.getTime()) || deliveredAt.getTime() > Date.now() + 5 * 60000) return toast("Confira a data e hora do recebimento.");
  const completeness = form.elements.namedItem("completeness")?.value;
  if (!confirm(`Confirmar entrega ${completeness.toLowerCase()} de ${receiptEditor.department.toUpperCase()} recebida em ${deliveredAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}? O horário deve ser o do e-mail, não o do upload.`)) return;
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const id = crypto.randomUUID(), ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const row = { id, company_id: receiptEditor.companyId, competence: state.month, department: receiptEditor.department,
      completeness, delivered_at: deliveredAt.toISOString(), evidence_path: `${state.member.id}/${id}.${ext}`,
      note: form.elements.namedItem("note")?.value.trim() || null, recorded_by: state.member.id };
    await receiptStore("put", { id, user_id: state.member.id, row, file });
    receiptEditor = null; if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl); receiptPreviewUrl = null;
    await refreshPendingReceipts();
    toast(navigator.onLine ? "Entrega salva; enviando print…" : "Entrega salva neste aparelho; o print será enviado quando houver conexão.");
    void syncReceiptPending();
  } catch (error) { button.disabled = false; toast(`Entrega não salva: ${error.message || error}`); }
});
window.addEventListener("online", () => void syncReceiptPending());
document.addEventListener("DOMContentLoaded", () => void refreshPendingReceipts());

