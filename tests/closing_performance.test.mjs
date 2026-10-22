import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function brasilia("), source.indexOf("const cacheKey"));
const chart = source.slice(source.indexOf("function businessDaysToClose("), source.indexOf("function renderPanel()"));
const state = {
  month: "2026-09", tick: Date.parse("2026-10-22T12:00:00Z"), holidays: [], companies: [],
  targets: [
    { competence: "2026-08", category: "HOLDING", official_close_date: "2026-09-16" },
    { competence: "2026-08", category: "DEMAIS", official_close_date: "2026-09-17" },
    { competence: "2026-09", category: "HOLDING", delivery_at: "2026-10-01T14:45:00Z" },
    { competence: "2026-09", category: "DEMAIS", delivery_at: null },
  ],
};
const context = vm.createContext({ state, Intl, Date, Set, Map, esc: (value) => String(value) });
vm.runInContext(helpers + chart, context);

test("dias úteis usam calendário de Cascavel, ignoram fins de semana e incluem o encerramento", () => {
  assert.equal(vm.runInContext('businessDaysToClose("2026-05", "2026-06-05")', context), 4); // Corpus Christi 04/06.
  assert.equal(vm.runInContext('businessDaysToClose("2026-08", "2026-09-16")', context), 11); // 07/09 excluído.
  assert.equal(vm.runInContext('businessDaysToClose("2026-07", "2026-07-31")', context), 0); // Antes do mês seguinte.
});

test("gráfico separa categorias, marca pendência e não confunde média com cumprimento da meta", () => {
  const report = vm.runInContext('closingPerformance("2026")', context);
  assert.equal(report.months.length, 2);
  assert.equal(report.months[0].holding.average, 11);
  assert.equal(report.months[0].demais.average, 12);
  assert.equal(report.months[0].geral.late, 1);
  assert.equal(report.months[1].geral.closed, 1);
  assert.equal(report.months[1].geral.total, 2);
  const html = vm.runInContext("renderClosingPerformance()", context);
  assert.match(html, /1 fora da meta/);
  assert.match(html, /1 pendente\(s\)/);
  assert.match(html, /Acumulado 2026/);
  assert.match(html, /meta: até 11 dias úteis/);
});
