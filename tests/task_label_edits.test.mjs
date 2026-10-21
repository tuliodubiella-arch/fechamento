import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20261021_task_label_edits.sql", import.meta.url), "utf8");

test("edição em outubro preserva o título de setembro e vale nos meses seguintes", () => {
  const state = { taskLabelEdits: [
    { id: "a", task_id: "t1", effective_competence: "2026-10", new_account: "INTEGRAÇÃO 01 a 13/09", new_group_name: "INTEGRAÇÕES", changed_at: "2026-10-21T10:00:00Z" },
    { id: "b", task_id: "t1", effective_competence: "2026-11", new_account: "INTEGRAÇÃO 01 a 13/10", new_group_name: "INTEGRAÇÕES", changed_at: "2026-11-20T10:00:00Z" },
  ] };
  const context = vm.createContext({ state });
  vm.runInContext(app.slice(app.indexOf("function taskLabelFor("), app.indexOf("function taskInMonth(")), context);
  const task = { id: "t1", account: "INTEGRAÇÃO 01 a 13/08", group_name: "INTEGRAÇÕES" };
  assert.equal(vm.runInContext("taskLabelFor", context)(task, "2026-09").account, task.account);
  assert.equal(vm.runInContext("taskLabelFor", context)(task, "2026-10").account, "INTEGRAÇÃO 01 a 13/09");
  assert.equal(vm.runInContext("taskLabelFor", context)(task, "2026-11").account, "INTEGRAÇÃO 01 a 13/10");
});

test("a correção mantém o mesmo identificador da tarefa e registra uma trilha administrativa", () => {
  assert.match(app, /data-action="edit-task-label"/);
  assert.match(app, /state\.member\?\.is_admin[\s\S]*data-action="edit-task-label"/);
  assert.match(app, /client\.rpc\("fc_edit_task_label"/);
  assert.match(sql, /if not public\.fc_is_admin\(\)/i);
  assert.match(sql, /fc_internal\.task_in_month\(p_task_id, p_competence\)/i);
  assert.match(sql, /g\.delivery_at is not null/i);
  assert.match(sql, /revoke update \(account, group_name\) on public\.fc_tasks from authenticated/i);
  assert.match(sql, /old_account, old_group_name,[\s\S]*new_account, new_group_name, changed_by/i);
  assert.doesNotMatch(sql, /update public\.fc_tasks set account/i);
  assert.doesNotMatch(sql, /delete from public\.fc_activity_/i);
});
