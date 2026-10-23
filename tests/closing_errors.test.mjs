import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261013_closing_errors.sql", import.meta.url), "utf8");
const code = source.slice(source.indexOf("function renderClosingErrors()"), source.indexOf("function renderRegistry()"));
const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const dateBR = (date) => date ? date.split("-").reverse().join("/") : "—";

test("controle mostra erros históricos, status e datas sem expor HTML", () => {
  const state = {
    closingErrors: [
      { id: "one", company_name: "Empresa A", assigned_user: "Ana", requested_by: "Bia", requested_at: "2026-10-01", error_label: "ERRO 1", description: "<script>erro</script>", status: "Aberto", correction_date: null, system_improvement: null },
      { id: "two", company_name: "Empresa B", assigned_user: "Carlos", requested_at: "2026-09-25", description: "Falha corrigida", status: "Corrigido", correction_date: "2026-10-02", system_improvement: null, source_row: 4 },
    ], companies: [], members: [], queue: [], errorSearch: "", errorStatusFilter: "", errorFeatureReady: true, errorFeatureError: "",
  };
  const context = vm.createContext({ state, esc, dateBR, errorStatuses: ["Aberto", "Em análise", "Em correção", "Aguardando validação", "Corrigido"] });
  vm.runInContext(code, context);
  const html = vm.runInContext("renderClosingErrors()", context);
  assert.match(html, /Empresa A/);
  assert.match(html, /02\/10\/2026/);
  assert.match(html, /Não informado/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Registrar novo erro/);
  assert.match(html, /Aguardando validação/);
  assert.match(html, /id="closing-error-form"[^>]*novalidate/);
  assert.match(html, /id="closing-error-save-message"/);
  state.errorStatusFilter = "Aberto";
  const filtered = vm.runInContext("renderClosingErrors()", context);
  assert.match(filtered, /Empresa A/);
  assert.doesNotMatch(filtered, /data-id="two"/);
});

test("edição só confirma correção quando o servidor devolve a linha atualizada", async () => {
  const updateCode = source.slice(source.indexOf("async function updateClosingError("), source.indexOf("async function flush()"));
  const values = { status: "Corrigido", correction_date: "2026-10-23" };
  let response = { data: [{ id: "one", ...values }], error: null };
  const client = { from: () => ({ update: () => ({ eq: () => ({ select: async () => response }) }) }) };
  const context = vm.createContext({ client });
  vm.runInContext(updateCode, context);
  assert.equal((await context.updateClosingError("one", values)).status, "Corrigido");
  response = { data: [], error: null };
  await assert.rejects(context.updateClosingError("one", values), /não confirmou a atualização/);
  response = { data: [{ id: "one", status: "Aberto", correction_date: null }], error: null };
  await assert.rejects(context.updateClosingError("one", values), /não confirmou a atualização/);
  response = { data: null, error: new Error("permissão negada") };
  await assert.rejects(context.updateClosingError("one", values), /permissão negada/);
});

test("migração protege o controle e exige data para status corrigido", () => {
  assert.match(migration, /alter table public\.fc_closing_errors enable row level security/i);
  assert.match(migration, /public\.fc_is_member\(\)/i);
  assert.match(migration, /status = 'Corrigido' and correction_date is not null/i);
  assert.match(migration, /status <> 'Corrigido' and correction_date is null/i);
  assert.match(migration, /source_row integer unique/i);
  assert.doesNotMatch(migration, /grant delete .*authenticated/i);
});
