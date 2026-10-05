import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const snippets = source.slice(source.indexOf("function myMonthlyTasks()"), source.indexOf("function renderAuth()"))
  + source.slice(source.indexOf("function renderMyPanel()"), source.indexOf("function renderExecution()"));

function setup(tasks, historical = false) {
  const state = {
    member: { id: "ana", name: "Ana Silva", is_admin: true },
    members: [{ id: "ana", name: "Ana Silva" }, { id: "bia", name: "Bia Souza" }],
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
