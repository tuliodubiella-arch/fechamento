import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261013_comments_suggestions.sql", import.meta.url), "utf8");
const code = source.slice(source.indexOf("function renderCommentsPanel()"), source.indexOf("function applyExecutionFilters()"))
  + source.slice(source.indexOf("function renderSuggestions()"), source.indexOf("function renderRegistry()"));
const esc = (value) => String(value ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function setup(admin = false) {
  const state = {
    month: "2026-10", commentsMonth: "2026-10", commentTaskId: "task-1", commentDrafts: {}, suggestionDraft: "",
    suggestionReasonDrafts: {}, collaborationReady: true, collaborationError: "", taskComments: [], suggestions: [], queue: [],
    member: { id: "m1", is_admin: admin },
  };
  const context = vm.createContext({ state, esc, monthName: () => "outubro de 2026", brasilia: () => "13/10/2026, 10:00:00",
    memberName: (id) => id === "m1" ? "Ana" : "Bia", monthlyTasks: () => [{ id: "task-1", account: "BANCOS", company_name: "Empresa A" }] });
  vm.runInContext(code, context);
  return { state, context };
}

test("comentários ficam ligados à atividade e competência, com autor e proteção HTML", () => {
  const { state, context } = setup();
  state.taskComments = [
    { id: "c1", task_id: "task-1", competence: "2026-10", author_id: "m1", body: "Conciliação parcial", created_at: "2026-10-13T13:00:00Z" },
    { id: "c2", task_id: "task-2", competence: "2026-10", author_id: "m1", body: "Outra rotina", created_at: "2026-10-13T13:00:00Z" },
    { id: "c3", task_id: "task-1", competence: "2026-09", author_id: "m1", body: "Outro mês", created_at: "2026-10-13T13:00:00Z" },
    { id: "c4", task_id: "task-1", competence: "2026-10", author_id: "m1", body: "<script>alert(1)</script>", created_at: "2026-10-13T13:00:00Z" },
  ];
  const html = vm.runInContext("renderCommentsPanel()", context);
  assert.match(html, /Conciliação parcial/);
  assert.match(html, /Ana · 13\/10\/2026/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /Outra rotina|Outro mês|<script>/);
  assert.match(html, /data-task-id="task-1"/);
});

test("somente administrador vê aceitar e rejeitar; decisão e motivo aparecem para todos", () => {
  const { state, context } = setup();
  state.suggestions = [
    { id: "s1", author_id: "m1", body: "Melhorar o filtro", status: "Pendente", created_at: "2026-10-13T13:00:00Z" },
    { id: "s2", author_id: "m1", body: "Criar aviso", status: "Rejeitada", decision_reason: "Já existe alerta", decided_by: "m2", decided_at: "2026-10-13T13:00:00Z", created_at: "2026-10-13T12:00:00Z" },
  ];
  const regular = vm.runInContext("renderSuggestions()", context);
  assert.match(regular, /Melhorar o filtro/);
  assert.match(regular, /Já existe alerta/);
  assert.doesNotMatch(regular, /data-action="decide-suggestion"/);
  state.member.is_admin = true;
  const admin = vm.runInContext("renderSuggestions()", context);
  assert.match(admin, /data-decision="Aceita"/);
  assert.match(admin, /data-decision="Rejeitada"/);
  assert.match(admin, /Motivo da decisão/);
});

test("novas tabelas exigem membro ativo e decisões exigem administrador", () => {
  assert.match(migration, /alter table public\.fc_task_comments enable row level security/i);
  assert.match(migration, /alter table public\.fc_improvement_suggestions enable row level security/i);
  assert.match(migration, /author_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /using \(\(select public\.fc_is_admin\(\)\) and status = 'Pendente'\)/i);
  assert.match(migration, /length\(trim\(decision_reason\)\) between 8 and 1000/i);
  assert.doesNotMatch(migration, /grant delete .*authenticated/i);
});
