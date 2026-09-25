-- Atribuições por competência. Execute uma vez no SQL Editor antes de publicar a interface.
alter table public.fc_tasks add column if not exists created_competence text not null default '2026-09'
  check (created_competence ~ '^\d{4}-(0[1-9]|1[0-2])$');

create table if not exists public.fc_month_owners (
  task_id text not null references public.fc_tasks(id),
  competence text not null check (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  responsible_id uuid references public.fc_members(id),
  responsible_legacy_name text,
  primary key (task_id, competence)
);
create index if not exists fc_month_owners_competence_idx on public.fc_month_owners(competence);
alter table public.fc_month_owners enable row level security;
revoke all on public.fc_month_owners from anon, authenticated;
grant select, insert, update on public.fc_month_owners to authenticated;
drop policy if exists fc_month_owners_read on public.fc_month_owners;
create policy fc_month_owners_read on public.fc_month_owners for select to authenticated using ((select public.fc_is_member()));
drop policy if exists fc_month_owners_insert on public.fc_month_owners;
create policy fc_month_owners_insert on public.fc_month_owners for insert to authenticated with check ((select public.fc_is_member()));
drop policy if exists fc_month_owners_update on public.fc_month_owners;
create policy fc_month_owners_update on public.fc_month_owners for update to authenticated
  using ((select public.fc_is_member())) with check ((select public.fc_is_member()));

insert into public.fc_month_owners(task_id, competence, responsible_id, responsible_legacy_name)
select id, '2026-09', responsible_id, responsible_legacy_name from public.fc_tasks
on conflict (task_id, competence) do nothing;

create or replace function public.fc_ensure_month_owners(p_competence text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.fc_is_member() then raise exception 'Acesso não autorizado'; end if;
  if p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_competence < '2026-09' then
    raise exception 'Competência inválida';
  end if;
  insert into public.fc_month_owners(task_id, competence, responsible_id, responsible_legacy_name)
  select t.id, p_competence, source.responsible_id, source.responsible_legacy_name
  from public.fc_tasks t
  join lateral (
    select g.competence from public.fc_targets g
    where g.company_id = t.company_id and g.competence < p_competence and g.delivery_at is not null
    order by g.competence desc limit 1
  ) last_closed on true
  join public.fc_month_owners source on source.task_id = t.id and source.competence = last_closed.competence
  where t.active and t.created_competence <= last_closed.competence
    and t.created_competence <= p_competence
  on conflict (task_id, competence) do nothing;
end;
$$;
revoke all on function public.fc_ensure_month_owners(text) from public, anon;
grant execute on function public.fc_ensure_month_owners(text) to authenticated;

create or replace function public.fc_remove_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.fc_is_admin() then raise exception 'Somente o administrador pode excluir responsáveis'; end if;
  if p_member_id = auth.uid() then raise exception 'Não é possível excluir seu próprio acesso'; end if;
  if not exists(select 1 from public.fc_members where id = p_member_id) then raise exception 'Responsável não encontrado'; end if;
  if exists(select 1 from public.fc_activity_events where actor_id = p_member_id)
    or exists(select 1 from public.fc_activity_states where last_actor_id = p_member_id) then
    raise exception 'Este responsável possui registros de execução e não pode ser excluído';
  end if;
  update public.fc_tasks set responsible_id = null, responsible_legacy_name = null where responsible_id = p_member_id;
  update public.fc_month_owners set responsible_id = null, responsible_legacy_name = null where responsible_id = p_member_id;
  update public.fc_receipts set updated_by = null where updated_by = p_member_id;
  update public.fc_holidays set created_by = null where created_by = p_member_id;
  delete from public.fc_members where id = p_member_id;
end;
$$;
revoke all on function public.fc_remove_member(uuid) from public, anon;
grant execute on function public.fc_remove_member(uuid) to authenticated;

-- O fechamento só considera rotinas já existentes naquela competência.
create or replace function public.fc_apply_activity(
  p_event_id uuid, p_task_id text, p_competence text, p_action text, p_occurred_at timestamptz
) returns public.fc_activity_states
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state public.fc_activity_states%rowtype;
  v_company text;
  v_elapsed integer := 0;
begin
  if not public.fc_is_member() then raise exception 'Acesso não autorizado'; end if;
  if p_event_id is null or p_task_id is null or p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or p_action not in ('play','pause','stop') or p_occurred_at is null
    or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Apontamento inválido';
  end if;
  select company_id into v_company from public.fc_tasks
    where id = p_task_id and active and created_competence <= p_competence;
  if v_company is null then raise exception 'Rotina não encontrada nesta competência'; end if;
  insert into public.fc_targets(company_id, competence, category, sort_order)
    select id, p_competence, category, 9999 from public.fc_companies where id = v_company
    on conflict (company_id, competence) do nothing;
  perform 1 from public.fc_targets where company_id = v_company and competence = p_competence for update;
  insert into public.fc_activity_states(task_id, competence) values(p_task_id, p_competence) on conflict do nothing;
  select * into v_state from public.fc_activity_states where task_id = p_task_id and competence = p_competence for update;
  if exists(select 1 from public.fc_activity_events where id = p_event_id) then return v_state; end if;
  if v_state.updated_at is not null and p_occurred_at < v_state.updated_at then
    raise exception 'Há um apontamento mais recente nesta rotina. Atualize os dados antes de sincronizar.';
  end if;
  if p_action = 'play' and v_state.status = 'Em andamento' then return v_state; end if;
  if p_action = 'pause' and v_state.status <> 'Em andamento' then raise exception 'A rotina não está em andamento'; end if;
  if p_action = 'stop' and v_state.status = 'Finalizado' then return v_state; end if;
  if p_action in ('pause','stop') and v_state.status = 'Em andamento' and v_state.started_at is not null then
    v_elapsed := greatest(0, floor(extract(epoch from p_occurred_at - v_state.started_at))::integer);
  end if;
  insert into public.fc_activity_events(id, task_id, competence, action, actor_id, occurred_at, elapsed_seconds)
    values(p_event_id, p_task_id, p_competence, p_action, auth.uid(), p_occurred_at, v_elapsed);
  update public.fc_activity_states set
    status = case p_action when 'play' then 'Em andamento' when 'pause' then 'Pausado' else 'Finalizado' end,
    total_seconds = total_seconds + v_elapsed,
    started_at = case when p_action = 'play' then p_occurred_at else null end,
    first_started_at = coalesce(first_started_at, case when p_action = 'play' then p_occurred_at else null end),
    finished_at = case when p_action = 'stop' then p_occurred_at else null end,
    updated_at = p_occurred_at,
    last_actor_id = auth.uid()
  where task_id = p_task_id and competence = p_competence returning * into v_state;
  if p_action = 'stop' and not exists(
    select 1 from public.fc_tasks t where t.company_id = v_company and t.active
      and t.created_competence <= p_competence and not exists(
        select 1 from public.fc_activity_states s where s.task_id = t.id and s.competence = p_competence and s.status = 'Finalizado'
      )
  ) then
    update public.fc_targets set delivery_at = (
      select max(s.finished_at) from public.fc_activity_states s
      join public.fc_tasks t on t.id = s.task_id
      where t.company_id = v_company and t.active and t.created_competence <= p_competence and s.competence = p_competence
    ), updated_at = now() where company_id = v_company and competence = p_competence;
    insert into public.fc_month_owners(task_id, competence, responsible_id, responsible_legacy_name)
    select t.id, to_char(to_date(p_competence || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM'),
      source.responsible_id, source.responsible_legacy_name
    from public.fc_tasks t join public.fc_month_owners source on source.task_id = t.id and source.competence = p_competence
    where t.company_id = v_company and t.active and t.created_competence <= p_competence
    on conflict (task_id, competence) do nothing;
  else
    update public.fc_targets set delivery_at = null, updated_at = now()
    where company_id = v_company and competence = p_competence and delivery_at is not null;
  end if;
  return v_state;
end;
$$;
revoke all on function public.fc_apply_activity(uuid,text,text,text,timestamptz) from public, anon;
grant execute on function public.fc_apply_activity(uuid,text,text,text,timestamptz) to authenticated;
