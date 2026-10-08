import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const snippets = source.slice(source.indexOf("function myMonthlyTasks()"), source.indexOf("function renderAuth()"))
  + source.slice(source.indexOf("function renderGeneralCards()"), source.indexOf("function renderPanel()"))
  + source.slice(source.indexOf("function renderMyPanel()"), source.indexOf("function renderExecution()"));

function setup(tasks, historical = false) {
  const state = {
    member: { id: "ana", name: "Ana Silva", is_admin: true },
    members: [{ id: "ana", name: "Ana Silva" }, { id: "bia", name: "Bia Souza" }],
    companies: [...new Map(tasks.filter((task) => task.company_id).map((task) => [task.company_id, { id: task.company_id, name: task.company_name, active: true }])).values()],
    states: [], receipts: [], myPanelCompanyFilters: [], analysisCompanyFilters: [],
    month: historical ? "2026-08" : "2026-10",
  };
  const context = vm.createContext({ state, monthlyTasks: () => tasks, isHistorical: () => historical,
    taskState: (id) => ({ status: id === "mine-done" ? "Finalizado" : "Não iniciado", total_seconds: id === "mine-done" ? 3600 : 0 }),
    currentSeconds: (activity) => activity?.total_seconds || 0, duration: (seconds) => `${seconds}s`,
    monthName: () => "outubro de 2026", esc: (value) => String(value ?? "") });
  vm.runInContext(snippets, context);
  return { context, state };
}

test("Meu Painel mostra apenas tarefas atribuídas ao usuário, inclusive quando ele é administrador", () => {
  const { context } = setup([
    { id: "mine-done", account: "BANCOS", group_name: "FINANCEIRO", company_name: "Empresa A", responsible_id: "ana" },
    { id: "mine-open", account: "ESTOQUE", group_name: "ESTOQUE", company_name: "Empresa B", responsible_id: "ana" },
    { id: "someone-else", account: "FISCAL SIGILOSO", group_name: "FISCAL", company_name: "Empresa C", responsible_id: "bia" },
    { id: "unassigned", account: "SEM DONO", group_name: "OUTROS", company_name: "Empresa D", responsible_id: null },
  ]);
  assert.equal(vm.runInContext("myMonthlyTasks().length", context), 2);
  const html = vm.runInContext("renderMyPanel()", context);
  assert.match(html, /BANCOS/);
  assert.match(html, /ESTOQUE/);
  assert.match(html, /50%/);
  assert.match(html, /3600s/);
  assert.doesNotMatch(html, /FISCAL SIGILOSO|Empresa C|SEM DONO|Empresa D/);
});

test("mês histórico usa somente nome completo único do responsável", () => {
  const { context, state } = setup([
    { id: "h1", historic: true, account: "MINHA", owner_name: " Ana  Silva ", company_name: "Empresa A" },
    { id: "h2", historic: true, account: "OUTRA", owner_name: "Ana", company_name: "Empresa B" },
  ], true);
  assert.equal(vm.runInContext("myMonthlyTasks().length", context), 1);
  assert.match(vm.runInContext("renderMyPanel()", context), /MINHA/);
  state.members.push({ id: "other-ana", name: "Ana Silva" });
  assert.equal(vm.runInContext("myMonthlyTasks().length", context), 0);
});

test("análise comparativa aparece somente para Tulio administrador", () => {
  const tasks = [{ id: "other", account: "BANCOS", group_name: "FINANCEIRO", company_name: "Empresa A", company_id: "a", responsible_id: "bia" }];
  const { context, state } = setup(tasks);
  assert.doesNotMatch(vm.runInContext("renderMyPanel()", context), /Tempo por tipo de tarefa e empresa/);
  state.member = { id: "tulio", name: "Tulio", email: "tulio.dubiella@gmail.com", is_admin: false };
  assert.doesNotMatch(vm.runInContext("renderMyPanel()", context), /Tempo por tipo de tarefa e empresa/);
  state.member.is_admin = true;
  const html = vm.runInContext("renderMyPanel()", context);
  assert.match(html, /Tempo por tipo de tarefa e empresa/);
  assert.match(html, /Empresa A/);
  assert.match(html, /Tarefas por empresa/);
  assert.match(html, /Tempo por grupo sintético/);
  assert.match(html, /Nenhuma tarefa vinculada nesta competência/);
  state.member.email = "outro@exemplo.com";
  assert.doesNotMatch(vm.runInContext("renderMyPanel()", context), /Tempo por tipo de tarefa e empresa/);
});

test("tempo por grupo e empresa distingue total de média finalizada e filtra empresas", () => {
  const { context, state } = setup([
    { id: "a-done", account: "BANCOS", group_name: "FINANCEIRO", company_name: "Empresa A", company_id: "a", owner_name: "Ana", responsible_id: "ana" },
    { id: "a-running", account: "CAIXAS", group_name: "FINANCEIRO", company_name: "Empresa A", company_id: "a", owner_name: "Ana", responsible_id: "ana" },
    { id: "b-done", account: "BANCOS", group_name: "FINANCEIRO", company_name: "Empresa B", company_id: "b", owner_name: "Bia", responsible_id: "bia" },
    { id: "fiscal", account: "IMPOSTOS", group_name: "FISCAL", company_name: "Empresa C", company_id: "c", owner_name: "Bia", responsible_id: "bia" },
  ]);
  state.member = { id: "tulio", name: "Tulio", email: "tulio.dubiella@gmail.com", is_admin: true };
  context.taskState = (id) => ({ status: { "a-done": "Finalizado", "a-running": "Em andamento", "b-done": "Finalizado" }[id] || "Não iniciado",
    total_seconds: { "a-done": 3600, "a-running": 600, "b-done": 1800 }[id] || 0 });
  state.analysisCompanyFilters = ["a", "b"];
  const html = vm.runInContext("renderTeamTimeAnalysis()", context);
  assert.match(html, /Empresa A<\/td><td>1\/2<\/td><td><strong>4200s<\/strong>/);
  assert.match(html, /4200s<\/strong>.*?3600s<\/td>/s);
  assert.match(html, /Empresa B<\/td><td>1\/1<\/td><td><strong>1800s<\/strong>/);
  assert.doesNotMatch(html, /<td>Empresa C<\/td>|<strong>IMPOSTOS<\/strong>/);
  assert.match(html, /data-analysis-company-filter="a" checked/);
  assert.match(html, /data-analysis-company-filter="b" checked/);
  assert.match(html, /Conciliações mais demoradas por empresa/);
});

test("gráficos do Tulio compartilham filtro de empresas sem reduzir os indicadores gerais", () => {
  const { context, state } = setup([
    { id: "a", account: "BANCOS", group_name: "FINANCEIRO", company_name: "Empresa A", company_id: "a", responsible_id: "bia" },
    { id: "b", account: "CAIXAS", group_name: "FINANCEIRO", company_name: "Empresa B", company_id: "b", responsible_id: "bia" },
    { id: "c", account: "FISCAL", group_name: "FISCAL", company_name: "Empresa C", company_id: "c", responsible_id: "bia" },
  ]);
  state.member = { id: "tulio", name: "Tulio", email: "tulio.dubiella@gmail.com", is_admin: true };
  state.myPanelCompanyFilters = ["a", "b"];
  const html = vm.runInContext("renderMyPanel()", context);
  const charts = html.slice(html.indexOf('<div class="two-col">'), html.indexOf('<details class="panel my-routines-collapsed">'));
  assert.match(html, /<span>Atividades<\/span><strong>3<\/strong>/);
  assert.match(charts, /Empresa A|Empresa B/);
  assert.doesNotMatch(charts, /Empresa C|FISCAL/);
  assert.match(html, /data-my-company-filter="a" checked/);
  assert.match(html, /data-my-company-filter="b" checked/);
});

test("rotinas atribuídas ao Tulio geram alerta no quadro recolhido", () => {
  const { context, state } = setup([{ id: "mine-done", account: "BANCOS", group_name: "FINANCEIRO", company_name: "Empresa A", company_id: "a", responsible_id: "tulio" }]);
  state.member = { id: "tulio", name: "Tulio", email: "tulio.dubiella@gmail.com", is_admin: true };
  const html = vm.runInContext("renderMyPanel()", context);
  assert.match(html, /<details class="panel my-routines-collapsed">/);
  assert.match(html, /my-task-alert[^>]*>1 vinculada\(s\)/);
  assert.match(html, /BANCOS/);
});
