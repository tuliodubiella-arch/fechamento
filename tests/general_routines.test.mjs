import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261019_general_routines.sql", import.meta.url), "utf8");
const recurrenceMigration = readFileSync(new URL("../supabase/migrations/20261020_general_routine_recurrence.sql", import.meta.url), "utf8");
const functions = source.slice(source.indexOf("function nextGeneralRoutineState("), source.indexOf("function renderRegistry()"));
const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

test("PLAY, PAUSE e FINISH acumulam apenas o tempo em andamento", () => {
  const context = vm.createContext({});
  vm.runInContext(functions, context);
  const initial = { status: "Não iniciada", total_seconds: 0, started_at: null, first_started_at: null };
  const playing = vm.runInContext("nextGeneralRoutineState", context)(initial, "play", "2026-10-19T13:00:00Z");
  const paused = vm.runInContext("nextGeneralRoutineState", context)(playing, "pause", "2026-10-19T13:10:00Z");
  const resumed = vm.runInContext("nextGeneralRoutineState", context)(paused, "play", "2026-10-19T13:30:00Z");
  const finished = vm.runInContext("nextGeneralRoutineState", context)(resumed, "finish", "2026-10-19T13:35:00Z");
  assert.equal(paused.total_seconds, 600);
  assert.equal(resumed.total_seconds, 600);
  assert.equal(finished.total_seconds, 900);
  assert.equal(finished.status, "Finalizada");
  assert.equal(finished.finished_at, "2026-10-19T13:35:00Z");
  assert.equal(finished.first_started_at, "2026-10-19T13:00:00Z");
});

test("tela mantém rotinas fora do mês e protege anotações HTML", () => {
  const state = {
    member: { id: "person-1", is_admin: false }, members: [{ id: "person-1", name: "Ana", active: true }],
    generalRoutines: [{ id: "r1", title: "Inventário <especial>", description: "Conferir documentos", responsible_id: "person-1", created_at: "2026-10-19T13:00:00Z", status: "Pausada", total_seconds: 600, first_started_at: "2026-10-19T13:00:00Z" }],
    generalEvents: [], generalNotes: [{ id: "n1", routine_id: "r1", author_id: "person-1", body: "<script>anotação</script>", occurred_at: "2026-10-19T13:10:00Z" }],
    generalSearch: "", generalStatusFilter: "", generalMineOnly: false, generalOpenId: "r1", generalCreateOpen: false, generalCreateDraft: {}, generalRecurrenceDrafts: {}, generalNoteDrafts: {}, generalReady: true, generalError: "", queue: [], tick: Date.parse("2026-10-19T13:10:00Z"),
  };
  const context = vm.createContext({ state, esc, duration: (seconds) => String(seconds), brasilia: (value) => value,
    dateBR: (value) => value, memberName: () => "Ana" });
  vm.runInContext(functions, context);
  const html = vm.runInContext("renderGeneralRoutines()", context);
  assert.match(html, /Rotinas avulsas/);
  assert.match(html, /não entram nos indicadores do balancete mensal/);
  assert.match(html, /&lt;especial&gt;/);
  assert.match(html, /&lt;script&gt;anotação&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /▶ PLAY/);
  assert.match(html, /■ FINISH/);
  assert.match(html, /Salvar anotação/);
  assert.match(html, /Programação da recorrência/);
  assert.match(html, /Data da próxima execução/);
  assert.match(html, /Salvar recorrência/);
  state.generalNoteDrafts.r1 = "Rascunho preservado";
  assert.match(vm.runInContext("renderGeneralRoutines()", context), /Rascunho preservado/);
  state.generalStatusFilter = "Finalizada";
  assert.doesNotMatch(vm.runInContext("renderGeneralRoutines()", context), /data-id="r1"/);
});

test("recorrência mensal exibe data programada e sucessora sem afetar fechamento", () => {
  const state = {
    member: { id: "person-1", is_admin: false }, members: [{ id: "person-1", name: "Ana", active: true }],
    generalRoutines: [{ id: "next", title: "Conferência mensal", description: "Conferir", responsible_id: "person-1",
      created_at: "2026-10-20T13:00:00Z", status: "Não iniciada", total_seconds: 0,
      scheduled_date: "2027-02-28", recurrence_frequency: "monthly", next_scheduled_date: "2027-03-31", recurrence_day: 31 }],
    generalEvents: [], generalNotes: [], generalSearch: "", generalStatusFilter: "", generalMineOnly: false,
    generalOpenId: "", generalCreateOpen: false, generalCreateDraft: { recurrence_frequency: "monthly", next_scheduled_date: "2027-01-31" },
    generalRecurrenceDrafts: {}, generalNoteDrafts: {}, generalReady: true, generalError: "", queue: [], tick: Date.now(),
  };
  const context = vm.createContext({ state, esc, duration: (seconds) => String(seconds), brasilia: (value) => value,
    dateBR: (value) => value, memberName: () => "Ana" });
  vm.runInContext(functions, context);
  const html = vm.runInContext("renderGeneralRoutines()", context);
  assert.match(html, /Programada para 2027-02-28/);
  assert.match(html, /próxima execução em 2027-03-31/);
  assert.match(html, /value="2027-01-31" required/);
  assert.match(html, /não entram nos indicadores do balancete mensal/);
});

test("banco restringe escrita e registra eventos idempotentes", () => {
  for (const table of ["fc_general_routines", "fc_general_routine_events", "fc_general_routine_notes"])
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.match(migration, /if not public\.fc_is_member\(\)/i);
  assert.match(migration, /v_routine\.responsible_id <> auth\.uid\(\) and not public\.fc_is_admin\(\)/i);
  assert.match(migration, /select \* into v_routine from public\.fc_general_routines where id = p_routine_id for update/i);
  assert.match(migration, /where id = p_event_id/i);
  assert.doesNotMatch(migration, /grant (insert|update|delete) .*fc_general_routine_events to authenticated/i);
});

test("recorrência só cria sucessora no FINISH e impede duplicação", () => {
  assert.match(recurrenceMigration, /constraint fc_general_routines_previous_unique unique \(previous_routine_id\)/i);
  assert.match(recurrenceMigration, /if p_action = 'finish' and v_routine\.recurrence_frequency = 'monthly'/i);
  assert.match(recurrenceMigration, /values\s*\(p_event_id, v_routine\.title, v_routine\.description, v_routine\.responsible_id/i);
  assert.match(recurrenceMigration, /if found then[\s\S]*return v_routine;[\s\S]*if p_action = 'finish'/i);
  assert.match(recurrenceMigration, /v_routine\.responsible_id <> auth\.uid\(\) and not public\.fc_is_admin\(\)/i);
  assert.match(recurrenceMigration, /scheduled_date is null and previous_routine_id is null/i);
  assert.match(recurrenceMigration, /revoke all on function public\.fc_set_general_recurrence/i);
});

test("anotação repetida após perda de resposta não duplica por diferença de fuso", async () => {
  const code = source.slice(source.indexOf("async function insertCollaborationRecord("), source.indexOf("async function flush()"));
  const row = { id: "n1", routine_id: "r1", author_id: "m1", body: "Feito", occurred_at: "2026-10-19T13:00:00.000Z" };
  const existing = { ...row, occurred_at: "2026-10-19T13:00:00+00:00" };
  const client = { from: () => ({ insert: async () => ({ error: { code: "23505" } }), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }) }) };
  const context = vm.createContext({ client });
  vm.runInContext(code, context);
  const result = await vm.runInContext("insertCollaborationRecord", context)({ table: "fc_general_routine_notes", row });
  assert.equal(result.error, null);
});
