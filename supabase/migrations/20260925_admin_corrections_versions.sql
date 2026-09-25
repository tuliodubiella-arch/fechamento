-- Correções administrativas de apontamentos e diário de versões.
-- Aplicar uma vez no SQL Editor do projeto jbnqgchofaprjjwbuzpe.
begin;

alter table public.fc_activity_events
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.fc_members(id),
  add column if not exists void_reason text;

create table if not exists public.fc_activity_corrections (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.fc_tasks(id),
  competence text not null check (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  corrected_by uuid not null references public.fc_members(id),
  corrected_at timestamptz not null default now(),
  reason text not null,
  events_affected integer not null default 0,
  previous_state jsonb not null
);
create index if not exists fc_activity_corrections_date_idx
  on public.fc_activity_corrections(corrected_at desc);
alter table public.fc_activity_corrections enable row level security;
revoke all on public.fc_activity_corrections from anon, authenticated;
grant select on public.fc_activity_corrections to authenticated;
drop policy if exists fc_activity_corrections_admin_read on public.fc_activity_corrections;
create policy fc_activity_corrections_admin_read on public.fc_activity_corrections
  for select to authenticated using ((select public.fc_is_admin()));

create table if not exists public.fc_release_notes (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  title text not null,
  details text not null,
  published_at timestamptz not null default now(),
  created_by uuid references public.fc_members(id),
  unique(version, title)
);
alter table public.fc_release_notes enable row level security;
revoke all on public.fc_release_notes from anon, authenticated;
grant select, insert on public.fc_release_notes to authenticated;
drop policy if exists fc_release_notes_admin_read on public.fc_release_notes;
create policy fc_release_notes_admin_read on public.fc_release_notes
  for select to authenticated using ((select public.fc_is_admin()));
drop policy if exists fc_release_notes_admin_insert on public.fc_release_notes;
create policy fc_release_notes_admin_insert on public.fc_release_notes
  for insert to authenticated with check (
    (select public.fc_is_admin()) and created_by = (select auth.uid())
    and length(trim(version)) between 1 and 40
    and length(trim(title)) between 3 and 160
    and length(trim(details)) between 10 and 4000
  );

create or replace function public.fc_reset_activity(
  p_task_id text, p_competence text, p_reason text
) returns public.fc_activity_states
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state public.fc_activity_states%rowtype;
  v_company text;
  v_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if not public.fc_is_admin() then raise exception 'Somente o administrador pode corrigir apontamentos'; end if;
  if p_task_id is null or p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or p_reason is null or length(trim(p_reason)) not between 8 and 500 then
    raise exception 'Informe a rotina, o mês e um motivo de 8 a 500 caracteres';
  end if;
  select company_id into v_company from public.fc_tasks where id = p_task_id and active;
  if v_company is null then raise exception 'Rotina não encontrada'; end if;

  -- Mesmo bloqueio usado por fc_apply_activity para serializar a empresa/mês.
  insert into public.fc_targets(company_id, competence, category, sort_order)
    select id, p_competence, category, 9999 from public.fc_companies where id = v_company
    on conflict (company_id, competence) do nothing;
  perform 1 from public.fc_targets
    where company_id = v_company and competence = p_competence for update;
  select * into v_state from public.fc_activity_states
    where task_id = p_task_id and competence = p_competence for update;
  if not found or (v_state.status = 'Não iniciado' and v_state.total_seconds = 0
    and v_state.first_started_at is null and v_state.finished_at is null) then
    raise exception 'Esta rotina não possui apontamentos ativos para corrigir';
  end if;

  update public.fc_activity_events
    set voided_at = v_now, voided_by = auth.uid(), void_reason = trim(p_reason)
    where task_id = p_task_id and competence = p_competence and voided_at is null;
  get diagnostics v_count = row_count;
  insert into public.fc_activity_corrections
    (task_id, competence, corrected_by, corrected_at, reason, events_affected, previous_state)
    values (p_task_id, p_competence, auth.uid(), v_now, trim(p_reason), v_count, to_jsonb(v_state));
  update public.fc_activity_states set
    status = 'Não iniciado', total_seconds = 0, started_at = null,
    first_started_at = null, finished_at = null, updated_at = v_now,
    last_actor_id = auth.uid()
    where task_id = p_task_id and competence = p_competence returning * into v_state;
  update public.fc_targets set delivery_at = null, updated_at = v_now
    where company_id = v_company and competence = p_competence and delivery_at is not null;
  return v_state;
end;
$$;
revoke all on function public.fc_reset_activity(text,text,text) from public, anon;
grant execute on function public.fc_reset_activity(text,text,text) to authenticated;

insert into public.fc_release_notes (version, title, details)
values ('2026.09.25', 'Correções administrativas e histórico de versões',
  'O administrador pode retirar apontamentos indevidos de uma rotina em um mês, com motivo e trilha de auditoria. Os tempos e indicadores são recalculados. Nova tela para registrar versões e manutenções do portal.')
on conflict (version, title) do nothing;

commit;
