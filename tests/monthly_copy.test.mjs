import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20261020_monthly_task_copy.sql", import.meta.url), "utf8");
const policy = readFileSync(new URL("../supabase/migrations/20261020_monthly_copy_policy_scope.sql", import.meta.url), "utf8");
const concurrency = readFileSync(new URL("../supabase/migrations/20261020_monthly_copy_concurrency.sql", import.meta.url), "utf8");
const september = readFileSync(new URL("../supabase/migrations/20261020_copy_from_september.sql", import.meta.url), "utf8");

test("novembro em diante não herda lista virtual; cópia, cadastro novo e tarefa iniciada aparecem", () => {
  const state = { month: "2026-11", owners: [], states: [] };
  const context = vm.createContext({ state, legacyCutoff: "2026-09" });
  vm.runInContext(app.slice(app.indexOf("function ownerFor("), app.indexOf("function monthlyTasks()")), context);
  const inMonth = vm.runInContext("taskInMonth", context);
  const existing = { id: "old", created_competence: "2026-09", active: true };
  assert.equal(inMonth(existing, "2026-10"), true);
  assert.equal(inMonth(existing, "2026-11"), false);
  state.owners.push({ task_id: "old", competence: "2026-11", responsible_id: null });
  assert.equal(inMonth(existing, "2026-11"), true);
  assert.equal(inMonth({ id: "new", created_competence: "2026-11", active: true }, "2026-11"), true);
  state.states.push({ task_id: "started", competence: "2026-11", status: "Em andamento", total_seconds: 1 });
  assert.equal(inMonth({ id: "started", created_competence: "2026-09", active: true }, "2026-11"), true);
  assert.equal(inMonth({ id: "retired", created_competence: "2026-09", active: false, retired_competence: "2026-11" }, "2026-11"), false);
});

test("competência seguinte cruza dezembro e mantém ano correto", () => {
  const context = vm.createContext({});
  vm.runInContext(app.slice(app.indexOf("function adjacentCompetence("), app.indexOf("function duration(")), context);
  assert.equal(vm.runInContext('adjacentCompetence("2026-10", 1)', context), "2026-11");
  assert.equal(vm.runInContext('adjacentCompetence("2026-12", 1)', context), "2027-01");
  assert.equal(vm.runInContext('adjacentCompetence("2027-01", -1)', context), "2026-12");
});

test("mês copiado para ano posterior continua selecionável", () => {
  const state = { owners: [{ competence: "2029-01" }], month: "2029-01" };
  const context = vm.createContext({ state, monthName: (month) => month, esc: String });
  vm.runInContext(app.slice(app.indexOf("function monthOptions()"), app.indexOf("function memberName(")), context);
  assert.match(vm.runInContext("monthOptions()", context), /value="2029-01" selected/);
});

test("cópia é administrativa, não transfere execução e não atualiza linhas existentes", () => {
  assert.match(sql, /if not public\.fc_is_admin\(\)/i);
  assert.match(sql, /on conflict \(task_id, competence\) do nothing/i);
  assert.match(sql, /not exists \(select 1 from public\.fc_activity_events e[\s\S]*e\.competence = v_target/i);
  assert.match(sql, /not exists \(select 1 from public\.fc_targets g[\s\S]*g\.delivery_at is not null/i);
  assert.doesNotMatch(sql.slice(sql.indexOf("create function public.fc_copy_month_tasks"), sql.indexOf("-- O cronômetro")), /insert into public\.fc_activity_(events|states)/i);
  assert.match(sql, /if p_competence >= '2026-11' then return/i);
  assert.match(sql, /if v_next_competence < '2026-11' then/i);
  assert.match(app, /data-action="copy-month-tasks"/);
  assert.match(policy, /s\.competence = fc_month_owners\.competence/);
  assert.match(policy, /e\.competence = fc_month_owners\.competence/);
  assert.match(concurrency, /order by g\.company_id for update/i);
  assert.match(september, /p_source_competence < '2026-09'/);
  assert.match(september, /order by g\.company_id for update/i);
  assert.match(september, /on conflict \(task_id, competence\) do nothing/i);
});

test("botão aparece ao administrador e orienta mês futuro ainda sem lista", () => {
  const state = { month: "2026-10", member: { is_admin: true }, online: true, queue: [],
    query: "", companyFilter: "", ownerFilter: "", statusFilters: [], groupFilters: [],
    companies: [], members: [], states: [], taskComments: [], commentsMonth: "", executionOwnerWarning: "" };
  const task = { id: "t1", account: "BANCOS", group_name: "FINANCEIRO", company_name: "Empresa A",
    owner_name: "Ana", company_id: "a", responsible_id: "m" };
  const context = vm.createContext({ state, monthlyTasks: () => [task], adjacentCompetence: (month) => month === "2026-09" ? "2026-10" : month === "2026-10" ? "2026-11" : "2026-12",
    monthName: (month) => month, executionStatuses: [], executionGroup: (item) => item.group_name,
    statusOf: () => "Não iniciado", taskState: () => null, currentSeconds: () => 0,
    duration: () => "00:00:00", brasilia: () => "—", dateBR: () => "—", badge: () => "—", esc: String });
  vm.runInContext(app.slice(app.indexOf("function renderExecution()"), app.indexOf("function renderGoals()")), context);
  assert.match(vm.runInContext("renderExecution()", context), /Copiar rotinas para 2026-11/);
  state.month = "2026-09";
  assert.match(vm.runInContext("renderExecution()", context), /Copiar rotinas para 2026-10/);
  state.member.is_admin = false;
  assert.doesNotMatch(vm.runInContext("renderExecution()", context), /data-action="copy-month-tasks"/);
  state.month = "2026-11";
  context.monthlyTasks = () => [];
  assert.match(vm.runInContext("renderExecution()", context), /ainda não foi copiada/);
});
