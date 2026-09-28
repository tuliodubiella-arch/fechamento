-- Retirada de rotinas a partir de uma competência e promoção administrativa.
-- Aplicar no projeto de fechamento antes de publicar a interface 2026.09.28.1.
begin;

alter table public.fc_tasks
  add column if not exists retired_competence text
    check (retired_competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by uuid references public.fc_members(id) on delete set null,
  add column if not exists retired_reason text;

alter table public.fc_members
  add column if not exists admin_granted_at timestamptz,
  add column if not exists admin_granted_by uuid references public.fc_members(id) on delete set null;

-- O navegador não pode alterar permissões nem retirar tarefas por UPDATE direto.
revoke update on public.fc_members from authenticated;
grant update (name) on public.fc_members to authenticated;
revoke update on public.fc_tasks from authenticated;
grant update (account, group_name, responsible_id, responsible_legacy_name)
  on public.fc_tasks to authenticated;

create or replace function public.fc_promote_member(p_member_id uuid)
returns public.fc_members
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_member public.fc_members%rowtype;
begin
  if not public.fc_is_admin() then
    raise exception 'Somente administradores podem conceder acesso administrativo';
  end if;
  if p_member_id is null then raise exception 'Responsável inválido'; end if;
  select * into v_member from public.fc_members
    where id = p_member_id and active for update;
  if not found then raise exception 'Responsável ativo não encontrado'; end if;
  if v_member.is_admin then return v_member; end if;
  update public.fc_members set is_admin = true,
    admin_granted_at = clock_timestamp(), admin_granted_by = auth.uid()
    where id = p_member_id returning * into v_member;
  return v_member;
end;
$$;
revoke all on function public.fc_promote_member(uuid) from public, anon;
grant execute on function public.fc_promote_member(uuid) to authenticated;

create or replace function public.fc_retire_task(
  p_task_id text, p_competence text, p_reason text
) returns public.fc_tasks
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_task public.fc_tasks%rowtype;
  v_remaining integer;
  v_unfinished integer;
  v_last_finished timestamptz;
begin
  if not public.fc_is_admin() then
    raise exception 'Somente administradores podem excluir tarefas';
  end if;
  if p_task_id is null or p_competence is null
    or p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or p_reason is null or length(trim(p_reason)) not between 8 and 500 then
    raise exception 'Informe tarefa, competência e motivo de 8 a 500 caracteres';
  end if;
  select * into v_task from public.fc_tasks where id = p_task_id;
  if not found or not v_task.active or v_task.created_competence > p_competence then
    raise exception 'Tarefa não está ativa nesta competência';
  end if;

  -- Mesmo bloqueio usado pelo cronômetro para serializar a empresa/mês.
  insert into public.fc_targets(company_id, competence, category, sort_order)
    select c.id, p_competence, c.category, 9999
    from public.fc_companies c where c.id = v_task.company_id
    on conflict (company_id, competence) do nothing;
  perform 1 from public.fc_targets
    where company_id = v_task.company_id and competence = p_competence for update;
  select * into v_task from public.fc_tasks where id = p_task_id for update;
  if not found or not v_task.active or v_task.created_competence > p_competence then
    raise exception 'Tarefa já foi retirada ou não existe nesta competência';
  end if;
  if exists(select 1 from public.fc_targets
    where company_id = v_task.company_id and competence >= p_competence
      and delivery_at is not null) then
    raise exception 'Há fechamento concluído neste mês ou em mês posterior';
  end if;
  if exists(select 1 from public.fc_activity_events
    where task_id = p_task_id and competence >= p_competence and voided_at is null)
    or exists(select 1 from public.fc_activity_states
      where task_id = p_task_id and competence >= p_competence
        and (status <> 'Não iniciado' or total_seconds > 0
          or started_at is not null or first_started_at is not null or finished_at is not null)) then
    raise exception 'A tarefa possui apontamentos neste mês ou em mês posterior. Corrija os registros antes de excluí-la';
  end if;

  update public.fc_tasks set active = false, retired_competence = p_competence,
    retired_at = clock_timestamp(), retired_by = auth.uid(),
    retired_reason = trim(p_reason)
    where id = p_task_id returning * into v_task;

  -- Se esta era a única pendência, a entrega passa a refletir o último STOP restante.
  select count(*), count(*) filter (where s.status is distinct from 'Finalizado'),
    max(s.finished_at)
    into v_remaining, v_unfinished, v_last_finished
  from public.fc_tasks t
  left join public.fc_activity_states s
    on s.task_id = t.id and s.competence = p_competence
  where t.company_id = v_task.company_id
    and t.created_competence <= p_competence
    and (t.active or t.retired_competence is not null)
    and (t.retired_competence is null or t.retired_competence > p_competence);
  update public.fc_targets set
    delivery_at = case when v_remaining > 0 and v_unfinished = 0
      then v_last_finished else null end,
    updated_at = clock_timestamp()
    where company_id = v_task.company_id and competence = p_competence;
  return v_task;
end;
$$;
revoke all on function public.fc_retire_task(text,text,text) from public, anon;
grant execute on function public.fc_retire_task(text,text,text) to authenticated;

-- Não copiar responsáveis para uma competência da qual a tarefa foi retirada.
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
  join public.fc_month_owners source
    on source.task_id = t.id and source.competence = last_closed.competence
  where (t.active or t.retired_competence is not null)
    and t.created_competence <= last_closed.competence
    and t.created_competence <= p_competence
    and (t.retired_competence is null or t.retired_competence > p_competence)
  on conflict (task_id, competence) do nothing;
end;
$$;
revoke all on function public.fc_ensure_month_owners(text) from public, anon;
grant execute on function public.fc_ensure_month_owners(text) to authenticated;

-- O cronômetro e a conclusão usam a mesma regra de vigência da interface.
create or replace function public.fc_apply_activity(
  p_event_id uuid, p_task_id text, p_competence text, p_action text, p_occurred_at timestamptz
) returns public.fc_activity_states
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state public.fc_activity_states%rowtype;
  v_company text;
  v_elapsed integer := 0;
  v_next_competence text;
begin
  if not public.fc_is_member() then raise exception 'Acesso não autorizado'; end if;
  if p_event_id is null or p_task_id is null or p_competence is null
    or p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or p_action not in ('play','pause','stop') or p_occurred_at is null
    or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Apontamento inválido';
  end if;
  select company_id into v_company from public.fc_tasks where id = p_task_id;
  if v_company is null then raise exception 'Rotina não encontrada'; end if;
  insert into public.fc_targets(company_id, competence, category, sort_order)
    select id, p_competence, category, 9999 from public.fc_companies where id = v_company
    on conflict (company_id, competence) do nothing;
  perform 1 from public.fc_targets
    where company_id = v_company and competence = p_competence for update;
  if not exists(select 1 from public.fc_tasks t where t.id = p_task_id
    and t.created_competence <= p_competence
    and (t.active or t.retired_competence is not null)
    and (t.retired_competence is null or t.retired_competence > p_competence)) then
    raise exception 'Rotina não está ativa nesta competência';
  end if;
  insert into public.fc_activity_states(task_id, competence)
    values(p_task_id, p_competence) on conflict do nothing;
  select * into v_state from public.fc_activity_states
    where task_id = p_task_id and competence = p_competence for update;
  if exists(select 1 from public.fc_activity_events where id = p_event_id) then return v_state; end if;
  if v_state.updated_at is not null and p_occurred_at < v_state.updated_at then
    raise exception 'Há um apontamento mais recente nesta rotina. Atualize os dados antes de sincronizar.';
  end if;
  if p_action = 'play' and v_state.status = 'Em andamento' then return v_state; end if;
  if p_action = 'pause' and v_state.status <> 'Em andamento' then
    raise exception 'A rotina não está em andamento';
  end if;
  if p_action = 'stop' and v_state.status = 'Finalizado' then return v_state; end if;
  if p_action in ('pause','stop') and v_state.status = 'Em andamento'
    and v_state.started_at is not null then
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
  if p_action = 'stop' and exists(
    select 1 from public.fc_tasks t where t.company_id = v_company
      and t.created_competence <= p_competence
      and (t.active or t.retired_competence is not null)
      and (t.retired_competence is null or t.retired_competence > p_competence)
  ) and not exists(
    select 1 from public.fc_tasks t where t.company_id = v_company
      and t.created_competence <= p_competence
      and (t.active or t.retired_competence is not null)
      and (t.retired_competence is null or t.retired_competence > p_competence)
      and not exists(select 1 from public.fc_activity_states s
        where s.task_id = t.id and s.competence = p_competence and s.status = 'Finalizado')
  ) then
    update public.fc_targets set delivery_at = (
      select max(s.finished_at) from public.fc_activity_states s
      join public.fc_tasks t on t.id = s.task_id
      where t.company_id = v_company and t.created_competence <= p_competence
        and (t.active or t.retired_competence is not null)
        and (t.retired_competence is null or t.retired_competence > p_competence)
        and s.competence = p_competence
    ), updated_at = now()
    where company_id = v_company and competence = p_competence;
    v_next_competence := to_char(to_date(p_competence || '-01', 'YYYY-MM-DD')
      + interval '1 month', 'YYYY-MM');
    insert into public.fc_month_owners(task_id, competence, responsible_id, responsible_legacy_name)
    select t.id, v_next_competence, source.responsible_id, source.responsible_legacy_name
    from public.fc_tasks t
    join public.fc_month_owners source
      on source.task_id = t.id and source.competence = p_competence
    where t.company_id = v_company and t.created_competence <= p_competence
      and (t.active or t.retired_competence is not null)
      and (t.retired_competence is null or t.retired_competence > v_next_competence)
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

-- Correções administrativas continuam disponíveis nos meses anteriores à retirada.
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
  if p_task_id is null or p_competence is null
    or p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or p_reason is null or length(trim(p_reason)) not between 8 and 500 then
    raise exception 'Informe a rotina, o mês e um motivo de 8 a 500 caracteres';
  end if;
  select company_id into v_company from public.fc_tasks t where t.id = p_task_id
    and t.created_competence <= p_competence
    and (t.active or t.retired_competence is not null)
    and (t.retired_competence is null or t.retired_competence > p_competence);
  if v_company is null then raise exception 'Rotina não encontrada nesta competência'; end if;
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

commit;
