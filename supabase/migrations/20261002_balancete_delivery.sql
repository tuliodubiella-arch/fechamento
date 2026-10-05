-- Balancete usa o mesmo histórico de entregas dos demais setores.
begin;

alter table public.fc_receipts
  drop constraint if exists fc_receipts_department_check,
  drop constraint if exists fc_receipts_department_valid;
alter table public.fc_receipts
  add constraint fc_receipts_department_valid
  check (department in ('financeiro','rh','estoque','fiscal','balancete'));

alter table public.fc_receipt_deliveries
  drop constraint if exists fc_receipt_deliveries_department_check,
  drop constraint if exists fc_receipt_deliveries_department_valid;
alter table public.fc_receipt_deliveries
  add constraint fc_receipt_deliveries_department_valid
  check (department in ('financeiro','rh','estoque','fiscal','balancete'));

insert into public.fc_release_notes (version, title, details)
values ('2026.10.05.1', 'Entrega do balancete e quadros de metas',
  'Balancete passa a ter registro de entregas parciais ou completas com horário do e-mail e do lançamento. As metas separam empresas com entregas pendentes das que possuem todos os cinco itens recebidos ou marcados como não aplicáveis, sem alterar a ordem mensal nem os registros existentes.')
on conflict (version, title) do nothing;

commit;
