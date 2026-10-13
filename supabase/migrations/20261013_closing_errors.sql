-- Controle contínuo dos erros encontrados nos fechamentos.
begin;

create table if not exists public.fc_closing_errors (
  id uuid primary key default gen_random_uuid(),
  source_row integer unique,
  company_name text not null check (length(trim(company_name)) between 2 and 200),
  assigned_user text check (assigned_user is null or length(assigned_user) <= 200),
  requested_by text check (requested_by is null or length(requested_by) <= 200),
  requested_at date,
  error_label text check (error_label is null or length(error_label) <= 500),
  description text not null check (length(trim(description)) between 1 and 10000),
  status text not null default 'Aberto' check (status in ('Aberto', 'Em análise', 'Em correção', 'Aguardando validação', 'Corrigido')),
  system_improvement boolean,
  correction_date date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint fc_closing_errors_status_date_check check (
    (status = 'Corrigido' and correction_date is not null and (source_row is not null or system_improvement is not null))
    or (status <> 'Corrigido' and correction_date is null)
  )
);
create index if not exists fc_closing_errors_status_date_idx on public.fc_closing_errors(status, requested_at desc);
alter table public.fc_closing_errors enable row level security;
revoke all on public.fc_closing_errors from public, anon, authenticated;
grant select on public.fc_closing_errors to authenticated;
grant insert (id, company_name, assigned_user, requested_by, requested_at, error_label,
  description, status, system_improvement, correction_date, created_by, updated_by)
  on public.fc_closing_errors to authenticated;
grant update (company_name, assigned_user, requested_by, requested_at, error_label,
  description, status, system_improvement, correction_date, updated_by)
  on public.fc_closing_errors to authenticated;
create policy fc_closing_errors_read on public.fc_closing_errors
  for select to authenticated using ((select public.fc_is_member()));
create policy fc_closing_errors_insert on public.fc_closing_errors
  for insert to authenticated with check (
    (select public.fc_is_member()) and source_row is null and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );
create policy fc_closing_errors_update on public.fc_closing_errors
  for update to authenticated using ((select public.fc_is_member()))
  with check ((select public.fc_is_member()) and updated_by = (select auth.uid()));

create or replace function public.fc_touch_closing_error()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.fc_touch_closing_error() from public, anon, authenticated;
create trigger fc_touch_closing_error before update on public.fc_closing_errors
  for each row execute function public.fc_touch_closing_error();

insert into public.fc_release_notes (version, title, details)
values ('2026.10.13.2', 'Controle de erros de fechamento',
  'Nova tela para registrar, acompanhar e corrigir erros identificados nos fechamentos. Os registros históricos foram importados uma única vez; a equipe pode cadastrar novos itens e acompanhar os estágios de análise, correção e validação, com data da correção e indicação de melhoria em sistema.')
on conflict (version, title) do nothing;

commit;
