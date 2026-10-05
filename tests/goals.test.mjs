import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const renderSource = source.slice(source.indexOf("function renderGoals()"), source.indexOf("const goalHeaders"));

test("metas separam entregas pendentes das completas sem renumerar a ordem mensal", () => {
  const companies = [
    { id: "a", name: "Empresa A", goal: { category: "HOLDING", sort_order: 1, business_day: 1 } },
    { id: "b", name: "Empresa B", goal: { category: "HOLDING", sort_order: 2, business_day: 2 } },
    { id: "c", name: "Empresa C", goal: { category: "DEMAIS", sort_order: 3, business_day: 3 } },
  ];
  const context = vm.createContext({
    state: { month: "2026-09" }, departments: ["financeiro", "rh", "estoque", "fiscal", "balancete"],
    orderedGoals: () => companies, companyDeliveriesComplete: (id) => id === "b",
    dateBR: (value) => value || "—", plannedDate: () => "2026-10-01", isHistorical: () => false,
    esc: (value) => String(value ?? ""), brasilia: (value) => value, renderReceiptCell: () => "<td>Recebimento</td>",
    renderReceiptPanel: () => "", monthName: () => "setembro de 2026",
  });
  vm.runInContext(renderSource, context);
  const html = vm.runInContext("renderGoals()", context);
  const visible = html.slice(0, html.indexOf('<section class="print-sheet'));
  const pending = visible.slice(0, visible.indexOf("Empresas com entregas concluídas"));
  const delivered = visible.slice(visible.indexOf("Empresas com entregas concluídas"));
  assert.match(pending, /Entregas pendentes · 2 empresa\(s\)/);
  assert.match(pending, /<strong>1<\/strong><\/td><td><strong>Empresa A/);
  assert.match(pending, /<strong>3<\/strong><\/td><td><strong>Empresa C/);
  assert.doesNotMatch(pending, /<td><strong>Empresa B/);
  assert.match(delivered, /<strong>2<\/strong><\/td><td><strong>Empresa B/);
  assert.doesNotMatch(delivered, /<td><strong>Empresa A/);
  assert.match(visible, /<th>balancete<\/th>/);
});
