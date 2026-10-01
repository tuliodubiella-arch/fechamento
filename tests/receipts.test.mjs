import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../receipts.js", import.meta.url), "utf8");
const pureFunctions = source.slice(0, source.indexOf("function receiptDatabase"));
const context = vm.createContext({ Intl, Date, String, Number, Object, Set });
vm.runInContext(pureFunctions, context);
const parse = (value) => vm.runInContext(`parseReceiptEmailDate(${JSON.stringify(value)})`, context);

test("aceita o horário do e-mail com ou sem dia da semana em Brasília", () => {
  assert.equal(parse("qui 01/10/2026 11:45"), "2026-10-01T14:45:00.000Z");
  assert.equal(parse("01/10/2026 11:45"), "2026-10-01T14:45:00.000Z");
  assert.equal(parse("sáb 03/10/2026 09:02"), "2026-10-03T12:02:00.000Z");
});

test("rejeita data inválida, dia da semana divergente e texto excedente", () => {
  for (const value of ["qui 02/10/2026 11:45", "31/02/2026 11:45", "01/10/2026 25:45", "01/10/2026 11:99", "Recebido em 01/10/2026 11:45"]) {
    assert.equal(parse(value), null, value);
  }
});

test("a interface nova não pede print e mantém o histórico anterior", () => {
  assert.doesNotMatch(source, /type="file"|Tesseract|receipt-image/);
  assert.match(source, /Lançado no painel em/);
  assert.match(source, /Ver print anterior/);
  assert.match(source, /source: "manual"/);
});
