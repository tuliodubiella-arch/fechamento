import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8").split("async function allRows")[0];
const recoveryUiSource = readFileSync(new URL("../app.js", import.meta.url), "utf8").split("function pendingDescription")[1].split("function render()")[0];

function setup(queue, handlers = {}) {
  const storage = new Map();
  const userId = "11111111-1111-4111-8111-111111111111";
  storage.set(`fc_queue_${userId}`, JSON.stringify(queue));
  const calls = [];
  const client = {
    from(table) {
      return {
        async insert(row) { calls.push(["insert", table, row.id]); return handlers.insert?.(row) || { error: null }; },
        select() { return { eq() { return { async maybeSingle() { return handlers.existing || { data: null, error: null }; } }; } }; },
      };
    },
    async rpc(name, args) { calls.push(["rpc", name, args.p_action]); return handlers.rpc?.(args) || { error: null }; },
  };
  const context = vm.createContext({
    window: { supabase: { createClient: () => client } },
    URLSearchParams,
    document: { querySelector: () => ({ textContent: "", classList: { add() {}, remove() {} } }) },
    setTimeout: () => 1,
    clearTimeout() {},
    location: { hash: "" },
    navigator: { onLine: true },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    render() {}, toast() {}, async loadData() {},
  });
  vm.runInContext(source, context);
  vm.runInContext(`state.session = { user: { id: "${userId}" } }; state.members = [{ id: "${userId}", active: true }]; loadCache();`, context);
  return { context, storage, calls, userId };
}

const task = { id: "task-new", company_id: "company-one", account: "BANCOS", group_name: "FECHAMENTO FINANCEIRO", responsible_id: null, responsible_legacy_name: null, created_competence: "2026-09", active: true };
const queue = [
  { kind: "upsert", table: "fc_tasks", row: task, conflict: "id" },
  { kind: "rpc", name: "fc_apply_activity", args: { p_action: "play" } },
  { kind: "rpc", name: "fc_apply_activity", args: { p_action: "stop" } },
];

test("fila antiga fica retida antes do envio", async () => {
  const { context, storage, calls, userId } = setup(queue);
  assert.equal(vm.runInContext("state.recoveryHold", context), true);
  await vm.runInContext("flush()", context);
  assert.deepEqual(calls, []);
  assert.equal(storage.get(`fc_recovery_hold_${userId}`), "1");
  assert.equal(JSON.parse(storage.get(`fc_queue_${userId}`)).length, 3);
});

test("após autorização inclui a rotina e envia os apontamentos na ordem", async () => {
  const { context, storage, calls, userId } = setup(queue);
  await vm.runInContext("state.recoveryApproved = true; flush()", context);
  assert.deepEqual(calls, [["insert", "fc_tasks", "task-new"], ["rpc", "fc_apply_activity", "play"], ["rpc", "fc_apply_activity", "stop"]]);
  assert.equal(JSON.parse(storage.get(`fc_queue_${userId}`)).length, 0);
  assert.equal(storage.has(`fc_recovery_hold_${userId}`), false);
});

test("erro interrompe o envio e conserva o restante da fila", async () => {
  const { context, storage, calls, userId } = setup(queue, { rpc: () => ({ error: { message: "Falha de teste" } }) });
  await vm.runInContext("state.recoveryApproved = true; flush()", context);
  assert.deepEqual(calls, [["insert", "fc_tasks", "task-new"], ["rpc", "fc_apply_activity", "play"]]);
  assert.equal(JSON.parse(storage.get(`fc_queue_${userId}`)).length, 2);
  assert.equal(storage.get(`fc_recovery_hold_${userId}`), "1");
  assert.equal(vm.runInContext("state.recoveryApproved", context), false);
});

test("erro de regra no primeiro apontamento pausa a fila do usuário sem apagar os demais", async () => {
  const pending = [
    { kind: "rpc", name: "fc_apply_activity", args: { p_action: "pause", p_competence: "2026-09" } },
    ...Array.from({ length: 11 }, () => ({ kind: "rpc", name: "fc_apply_activity", args: { p_action: "stop", p_competence: "2026-09" } })),
  ];
  const { context, storage, calls, userId } = setup(pending, { rpc: () => ({ error: { code: "P0001", message: "A rotina não está em andamento" } }) });
  await vm.runInContext("flush()", context);
  assert.equal(JSON.parse(storage.get(`fc_queue_${userId}`)).length, 12);
  assert.equal(storage.get(`fc_recovery_hold_${userId}`), "1");
  assert.equal(storage.get(`fc_recovery_error_${userId}`), "A rotina não está em andamento");
  await vm.runInContext("flush()", context);
  assert.deepEqual(calls, [["rpc", "fc_apply_activity", "pause"]]);
});

test("falha de rede mantém tentativa futura sem entrar em revisão", async () => {
  const pending = [{ kind: "rpc", name: "fc_apply_activity", args: { p_action: "play" } }];
  const { context, storage, userId } = setup(pending, { rpc: () => ({ error: { message: "Failed to fetch" } }) });
  await vm.runInContext("flush()", context);
  assert.equal(JSON.parse(storage.get(`fc_queue_${userId}`)).length, 1);
  assert.equal(storage.has(`fc_recovery_hold_${userId}`), false);
});

test("inclusão já recebida pelo servidor não duplica a rotina", async () => {
  const { context, calls, storage, userId } = setup(queue, { insert: () => ({ error: { code: "23505" } }), existing: { data: task, error: null } });
  await vm.runInContext("state.recoveryApproved = true; flush()", context);
  assert.deepEqual(calls, [["insert", "fc_tasks", "task-new"], ["rpc", "fc_apply_activity", "play"], ["rpc", "fc_apply_activity", "stop"]]);
  assert.equal(JSON.parse(storage.get(`fc_queue_${userId}`)).length, 0);
});

test("revisão mostra o total e os apontamentos antes de liberar o envio", () => {
  const { context } = setup(queue);
  vm.runInContext(`function pendingDescription${recoveryUiSource}`, context);
  const html = vm.runInContext("renderRecoveryPanel()", context);
  assert.match(html, /3 operação\(ões\)/);
  assert.match(html, /2 apontamento\(s\) de tempo/);
  assert.match(html, /Baixar cópia da fila/);
  assert.match(html, /disabled>Sincronizar após revisão/);
  assert.match(html, /PLAY/);
  assert.match(html, /STOP/);
});
