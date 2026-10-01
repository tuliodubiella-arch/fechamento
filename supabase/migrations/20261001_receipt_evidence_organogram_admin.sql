-- Entregas parciais/completas com evidência privada; organograma só para administradores.
begin;

-- A planilha antiga só tinha Recebido/Pendente/N/A. Preserve os registros e admita Parcial.
do $$
declare v_constraint record;
begin
  for v_constraint in
    select conname from pg_constraint
    where conrelid = 'public.fc_receipts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.fc_receipts drop constraint %I', v_constraint.conname);
  end loop;
end $$;
alter table public.fc_receipts
  add constraint fc_receipts_status_valid check (status in ('Pendente','Parcial','Recebido','N/A')),
  add constraint fc_receipts_timestamp_valid check (
    (status in ('Parcial','Recebido') and received_at is not null)
    or (status in ('Pendente','N/A') and received_at is null)
  );

create table if not exists public.fc_receipt_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  competence text not null,
  department text not null check (department in ('financeiro','rh','estoque','fiscal')),
  completeness text not null check (completeness in ('Parcial','Completa')),
  delivered_at timestamptz not null,
  evidence_path text,
  note text check (char_length(note) <= 500),
  source text not null default 'print' check (source in ('print','legacy')),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.fc_members(id),
  foreign key (company_id, competence) references public.fc_targets(company_id, competence) on delete cascade,
  check ((source = 'legacy' and evidence_path is null)
    or (source = 'print' and evidence_path is not null and recorded_by is not null))
);
create index if not exists fc_receipt_deliveries_lookup
  on public.fc_receipt_deliveries (competence, company_id, department, delivered_at);
create unique index if not exists fc_receipt_deliveries_legacy_unique
  on public.fc_receipt_deliveries (company_id, competence, department) where source = 'legacy';

-- Mostra os recebimentos anteriores como histórico, sem inventar prints.
insert into public.fc_receipt_deliveries
  (company_id, competence, department, completeness, delivered_at, source, recorded_by)
select company_id, competence, department, 'Completa', received_at, 'legacy', updated_by
from public.fc_receipts where status = 'Recebido' and received_at is not null
on conflict do nothing;

alter table public.fc_receipt_deliveries enable row level security;
revoke all on public.fc_receipt_deliveries from anon, authenticated;
grant select, insert on public.fc_receipt_deliveries to authenticated;
drop policy if exists fc_receipt_deliveries_read on public.fc_receipt_deliveries;
create policy fc_receipt_deliveries_read on public.fc_receipt_deliveries
  for select to authenticated using ((select public.fc_is_member()));
drop policy if exists fc_receipt_deliveries_insert on public.fc_receipt_deliveries;
create policy fc_receipt_deliveries_insert on public.fc_receipt_deliveries
  for insert to authenticated with check (
    (select public.fc_is_member()) and recorded_by = (select auth.uid())
    and source = 'print' and evidence_path like (select auth.uid())::text || '/%'
  );

create or replace function public.fc_apply_receipt_delivery()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.source = 'legacy' then return new; end if;
  insert into public.fc_receipts (company_id, competence, department, status, received_at, updated_by)
  values (new.company_id, new.competence, new.department,
    case when new.completeness = 'Completa' then 'Recebido' else 'Parcial' end,
    new.delivered_at, new.recorded_by)
  on conflict (company_id, competence, department) do update
  set status = case when public.fc_receipts.status = 'Recebido' or excluded.status = 'Recebido'
      then 'Recebido' else excluded.status end,
      received_at = greatest(public.fc_receipts.received_at, excluded.received_at),
      updated_by = excluded.updated_by;
  return new;
end;
$$;
drop trigger if exists fc_apply_receipt_delivery_insert on public.fc_receipt_deliveries;
create trigger fc_apply_receipt_delivery_insert after insert on public.fc_receipt_deliveries
  for each row execute function public.fc_apply_receipt_delivery();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fc-receipt-evidence', 'fc-receipt-evidence', false, 5242880,
  array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists fc_receipt_evidence_read on storage.objects;
create policy fc_receipt_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'fc-receipt-evidence' and (select public.fc_is_member()));
drop policy if exists fc_receipt_evidence_insert on storage.objects;
create policy fc_receipt_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fc-receipt-evidence' and (select public.fc_is_member())
    and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Uma política permissiva genérica de Storage não poderá abrir este bucket por engano.
drop policy if exists fc_receipt_evidence_read_guard on storage.objects;
create policy fc_receipt_evidence_read_guard on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'fc-receipt-evidence' or (select public.fc_is_member()));
drop policy if exists fc_receipt_evidence_insert_guard on storage.objects;
create policy fc_receipt_evidence_insert_guard on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'fc-receipt-evidence' or ((select public.fc_is_member())
    and (storage.foldername(name))[1] = (select auth.uid())::text));

-- RLS: remover políticas permissivas de leitura anteriores do organograma.
do $$
declare v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'org_workspace'
      and cmd in ('SELECT','ALL')
  loop
    execute format('drop policy %I on public.org_workspace', v_policy.policyname);
  end loop;
end $$;
alter table public.org_workspace enable row level security;
revoke all on public.org_workspace from anon, authenticated;
grant select, insert, update on public.org_workspace to authenticated;
create policy org_workspace_admin_read on public.org_workspace
  for select to authenticated using ((select public.fc_is_admin()));
drop policy if exists org_workspace_insert on public.org_workspace;
create policy org_workspace_insert on public.org_workspace
  for insert to authenticated with check ((select public.fc_is_admin()) and updated_by = (select auth.uid()));
drop policy if exists org_workspace_update on public.org_workspace;
create policy org_workspace_update on public.org_workspace
  for update to authenticated using ((select public.fc_is_admin()))
  with check ((select public.fc_is_admin()) and updated_by = (select auth.uid()));

commit;

