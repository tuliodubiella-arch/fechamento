import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const snippets = source.slice(source.indexOf("function statusOf(task)"), source.indexOf("function renderAuth()"))
  + source.slice(source.indexOf("function renderExecution()"), source.indexOf("function renderGoals()"));

test("filtro de grupo sintético aceita múltiplos grupos e combina com o status", () => {
  const tasks = [
    { id: "t1", account: "BANCO", group_name: "FINANCEIRO", company_name: "Empresa A", owner_name: "Ana", company_id: "a", responsible_id: "m" },
    { id: "t2", account: "IMPOSTO", group_name: "FISCAL", company_name: "Empresa A", owner_name: "Ana", company_id: "a", responsible_id: "m" },
    { id: "t3", account: "OUTRA", group_name: "ESTOQUE", company_name: "Empresa A", owner_name: "Ana", company_id: "a", responsible_id: "m" },
  ];
  const state = { query: "", companyFilter: "", ownerFilter: "", statusFilters: [], groupFilters: [],
    companies: [{ id: "a", name: "Empresa A", active: true }], members: [{ id: "m", name: "Ana", active: true }], member: { is_admin: false } };
  const context = vm.createContext({ state, monthlyTasks: () => tasks, executionStatuses: ["Não iniciado", "Em andamento", "Pausado", "Finalizado"],
    taskState: (id) => ({ status: id === "t3" ? "Pausado" : "Finalizado" }), currentSeconds: () => 0, duration: () => "00:00:00",
    brasilia: () => "—", dateBR: () => "—", esc: (value) => String(value ?? "") });
  vm.runInContext(snippets, context);
  const html = vm.runInContext("renderExecution()", context);
  assert.match(html, /data-group-filter="FINANCEIRO"/);
  assert.match(html, /data-group-filter="FISCAL"/);
  assert.match(html, /data-execution-group="FINANCEIRO"/);
  assert.match(html, /data-execution-group="FISCAL"/);

  const rows = [
    { dataset: { executionStatus: "Finalizado", executionGroup: "FINANCEIRO" }, classList: { toggle(_class, hidden) { this.hidden = hidden; } } },
    { dataset: { executionStatus: "Finalizado", executionGroup: "FISCAL" }, classList: { toggle(_class, hidden) { this.hidden = hidden; } } },
    { dataset: { executionStatus: "Pausado", executionGroup: "ESTOQUE" }, classList: { toggle(_class, hidden) { this.hidden = hidden; } } },
  ];
  const filters = Object.fromEntries(["#status-filter", "#group-filter"].map((key) => [key, {
    summary: { textContent: "" }, button: { disabled: false },
    querySelector(selector) { return selector === "summary" ? this.summary : this.button; },
  }]));
  const empty = { hidden: true }, footer = { textContent: "" };
  context.$ = (selector) => filters[selector] || (selector === ".execution-empty" ? empty : footer);
  context.document = { querySelectorAll: () => rows };
  state.statusFilters = ["Finalizado"];
  state.groupFilters = ["FINANCEIRO", "FISCAL"];
  vm.runInContext("applyExecutionFilters()", context);
  assert.deepEqual(rows.map((row) => row.classList.hidden), [false, false, true]);
  assert.match(filters["#group-filter"].summary.textContent, /2 grupos selecionados/);
  assert.match(footer.textContent, /2 atividade\(s\)/);
  state.groupFilters = ["FINANCEIRO"];
  vm.runInContext("applyExecutionFilters()", context);
  assert.deepEqual(rows.map((row) => row.classList.hidden), [false, true, true]);
});

test("status usa o tom certo para cada etapa", () => {
  const context = vm.createContext({ esc: (value) => value, taskState: () => null });
  vm.runInContext(snippets.slice(0, snippets.indexOf("function renderExecution()")), context);
  assert.match(vm.runInContext('badge("Não iniciado")', context), /badge not-started/);
  assert.match(vm.runInContext('badge("Em andamento")', context), /badge running/);
  assert.match(vm.runInContext('badge("Finalizado")', context), /badge done/);
  assert.match(vm.runInContext('badge("Pausado")', context), /badge paused/);
});

test("filtros de empresas, responsáveis e grupos sintéticos ficam em ordem alfabética", () => {
  const tasks = [
    { id: "t1", account: "A", group_name: "ZETAS", company_name: "Zebra", owner_name: "Zoe", company_id: "z", responsible_id: "z" },
    { id: "t2", account: "B", group_name: "ÁGUA", company_name: "Águia", owner_name: "Álvaro", company_id: "a", responsible_id: "a" },
    { id: "t3", account: "C", group_name: "BANCOS", company_name: "Beta", owner_name: "Beatriz", company_id: "b", responsible_id: "b" },
  ];
  const state = { query: "", companyFilter: "", ownerFilter: "", statusFilters: [], groupFilters: [],
    companies: [{ id: "z", name: "Zebra", active: true }, { id: "b", name: "Beta", active: true }, { id: "a", name: "Águia", active: true }],
    members: [{ id: "z", name: "Zoe", active: true }, { id: "b", name: "Beatriz", active: true }, { id: "a", name: "Álvaro", active: true }],
    member: { is_admin: false } };
  const context = vm.createContext({ state, monthlyTasks: () => tasks, executionStatuses: [],
    taskState: () => null, currentSeconds: () => 0, duration: () => "00:00:00",
    brasilia: () => "—", dateBR: () => "—", esc: (value) => String(value ?? "") });
  vm.runInContext(snippets, context);
  const html = vm.runInContext("renderExecution()", context);
  const companies = html.match(/<select id="company-filter"[\s\S]*?<\/select>/)[0];
  const members = html.match(/<select id="owner-filter"[\s\S]*?<\/select>/)[0];
  const groups = html.match(/<details id="group-filter"[\s\S]*?<\/details>/)[0];
  assert.ok(companies.indexOf("Águia") < companies.indexOf("Beta") && companies.indexOf("Beta") < companies.indexOf("Zebra"));
  assert.ok(members.indexOf("Álvaro") < members.indexOf("Beatriz") && members.indexOf("Beatriz") < members.indexOf("Zoe"));
  assert.ok(groups.indexOf('data-group-filter="ÁGUA"') < groups.indexOf('data-group-filter="BANCOS"')
    && groups.indexOf('data-group-filter="BANCOS"') < groups.indexOf('data-group-filter="ZETAS"'));
  assert.deepEqual(state.companies.map((item) => item.id), ["z", "b", "a"]);
});
