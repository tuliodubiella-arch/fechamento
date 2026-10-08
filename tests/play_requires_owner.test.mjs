import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const actSource = source.slice(source.indexOf("function act(taskId, action)"), source.indexOf("async function resetActivity("));

test("PLAY sem responsável mostra alerta e não gera apontamento", () => {
  const state = { month: "2026-10", member: { id: "user" }, tasks: [{ id: "task", company_id: "company" }],
    states: [], targets: [], companies: [{ id: "company" }], executionOwnerWarning: "" };
  const messages = [], queued = [];
  const context = vm.createContext({ state, isHistorical: () => false, taskInMonth: () => true, ownerFor: () => null,
    render: () => {}, toast: (message) => messages.push(message), enqueue: (item) => queued.push(item),
    taskState: () => null, uid: () => "event", targetFor: () => ({}), changeLocal: () => {} });
  vm.runInContext(actSource, context);
  vm.runInContext('act("task", "play")', context);
  assert.equal(state.executionOwnerWarning, "task");
  assert.match(messages[0], /não pode ser iniciada sem um responsável definido/);
  assert.equal(queued.length, 0);
  assert.equal(state.states.length, 0);
});

test("PLAY com responsável segue o fluxo de registro", () => {
  const state = { month: "2026-10", member: { id: "user" }, tasks: [{ id: "task", company_id: "company" }],
    states: [], targets: [], companies: [{ id: "company" }], executionOwnerWarning: "task" };
  const queued = [];
  const context = vm.createContext({ state, isHistorical: () => false, taskInMonth: () => true,
    ownerFor: () => ({ responsible_id: "user" }), render: () => {}, toast: () => {}, enqueue: (item) => queued.push(item),
    taskState: () => null, uid: () => "event", targetFor: () => ({ company_id: "company", competence: "2026-10" }),
    changeLocal: (_table, row) => state.states.push(row) });
  vm.runInContext(actSource, context);
  vm.runInContext('act("task", "play")', context);
  assert.equal(state.executionOwnerWarning, "");
  assert.equal(state.states[0].status, "Em andamento");
  assert.equal(queued[0].name, "fc_apply_activity");
});
