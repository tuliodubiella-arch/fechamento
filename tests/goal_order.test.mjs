import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261103_monthly_goal_order.sql", import.meta.url), "utf8");
const code = source.slice(source.indexOf("function moveGoal("), source.indexOf("function goalExportRows()"));

test("empates de ordem são resolvidos ao arrastar e a competência fica isolada", () => {
  const companies = ["A", "B", "C", "D"].map((id) => ({ id }));
  const targets = companies.map((company, index) => ({ company_id: company.id, competence: "2026-10", category: index < 3 ? "HOLDING" : "DEMAIS", sort_order: 9999 }));
  targets.push({ company_id: "A", competence: "2026-11", category: "HOLDING", sort_order: 7 });
  const state = { month: "2026-10", companies, targets };
  const queued = [], notices = [];
  const context = vm.createContext({ state, toast: (message) => notices.push(message),
    orderedGoals: () => companies.map((company) => ({ ...company, goal: targets.find((row) => row.company_id === company.id && row.competence === state.month) })),
    companyDeliveriesComplete: () => false,
    targetFor: (company) => targets.find((row) => row.company_id === company.id && row.competence === state.month),
    changeLocal: (_table, row) => { Object.assign(targets.find((item) => item.company_id === row.company_id && item.competence === row.competence), row); },
    enqueue: (item) => queued.push(item),
  });
  vm.runInContext(code, context);
  context.moveGoal("C", "A");
  assert.deepEqual(Array.from(queued[0].args.p_company_ids), ["C", "A", "B", "D"]);
  assert.deepEqual(targets.filter((row) => row.competence === "2026-10").map((row) => row.sort_order), [2, 3, 1, 4]);
  assert.equal(targets.find((row) => row.competence === "2026-11").sort_order, 7);
  context.moveGoal("D", "A");
  assert.equal(queued.length, 1, "não mistura HOLDING com DEMAIS");
  assert.match(notices.at(-1), /mesma prioridade/);
});

test("reordenação no banco é atômica e limitada a membro e competência", () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /not public\.fc_is_member\(\)/i);
  assert.match(migration, /p_competence < '2026-10'/i);
  assert.match(migration, /update public\.fc_targets t[\s\S]*t\.competence = p_competence/i);
  assert.match(migration, /cardinality\(p_company_ids\) <> v_expected/i);
  assert.match(migration, /revoke all .* from public, anon/i);
});
