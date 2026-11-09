-- Permite auditar um PAUSE local repetido mesmo após um administrador
-- finalizar a rotina, desde que não exista outro apontamento no intervalo.
begin;

create or replace function public.fc_skip_duplicate_pending_pause(
  p_event_id uuid, p_task_id text, p_competence text, p_occurred_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state public.fc_activity_states%rowtype;
  v_previous_action text;
  v_previous_actor uuid;
  v_previous_at timestamptz;
  v_next_action text;
  v_next_actor uuid;
  v_next_at timestamptz;
  v_reason text;
  v_inserted integer;
begin
  if not public.fc_is_member() then raise exception 'Acesso não autorizado'; end if;
  if p_event_id is null or p_task_id is null or p_competence is null
    or p_competence !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or p_occurred_at is null
    or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Apontamento pendente inválido';
  end if;
  if exists (select 1 from public.fc_activity_corrections
    where pending_event_id = p_event_id and corrected_by = auth.uid()
      and task_id = p_task_id and competence = p_competence
      and previous_state->>'pending_action' = 'pause'
      and (previous_state->>'pending_occurred_at')::timestamptz = p_occurred_at) then
    return true;
  end if;
  if exists (select 1 from public.fc_activity_events where id = p_event_id) then
    raise exception 'Este apontamento já foi gravado no servidor';
  end if;
  select * into v_state from public.fc_activity_states
    where task_id = p_task_id and competence = p_competence for update;
  if not found or v_state.started_at is not null then
    raise exception 'A rotina mudou; peça ao administrador para revisar a fila';
  end if;
  select action, actor_id, occurred_at
    into v_previous_action, v_previous_actor, v_previous_at
    from public.fc_activity_events
    where task_id = p_task_id and competence = p_competence
      and voided_at is null and occurred_at < p_occurred_at
    order by occurred_at desc, id desc limit 1;
  if v_previous_action is distinct from 'pause'
    or v_previous_actor is distinct from auth.uid() or v_previous_at is null then
    raise exception 'Não foi possível confirmar o PAUSE repetido';
  end if;

  if v_state.status = 'Pausado' then
    if v_state.last_actor_id is distinct from auth.uid()
      or v_state.updated_at is distinct from v_previous_at then
      raise exception 'A rotina mudou; peça ao administrador para revisar a fila';
    end if;
    v_reason := 'PAUSE local repetido, não enviado; confirmado pelo responsável. Nenhum tempo gravado foi alterado.';
  elsif v_state.status = 'Finalizado' then
    select action, actor_id, occurred_at
      into v_next_action, v_next_actor, v_next_at
      from public.fc_activity_events
      where task_id = p_task_id and competence = p_competence
        and voided_at is null and occurred_at > p_occurred_at
      order by occurred_at, id limit 1;
    if v_next_action is distinct from 'stop' or v_next_at is null
      or v_next_at is distinct from v_state.finished_at
      or v_state.updated_at is distinct from v_next_at
      or v_state.last_actor_id is distinct from v_next_actor
      or not exists (select 1 from public.fc_members
        where id = v_next_actor and active and is_admin) then
      raise exception 'Não foi possível vincular o PAUSE à finalização administrativa';
    end if;
    v_reason := 'PAUSE local repetido antes da finalização administrativa; não enviado. Nenhum tempo gravado foi alterado.';
  else
    raise exception 'A rotina mudou; peça ao administrador para revisar a fila';
  end if;

  insert into public.fc_activity_corrections
    (task_id, competence, corrected_by, reason, events_affected, previous_state,
     correction_type, pending_event_id)
    values (p_task_id, p_competence, auth.uid(), v_reason, 0,
      jsonb_build_object('pending_action', 'pause', 'pending_occurred_at', p_occurred_at,
        'last_server_action_at', v_previous_at, 'next_server_action_at', v_next_at,
        'server_state', to_jsonb(v_state)),
      'queue_skip', p_event_id)
    on conflict (pending_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then raise exception 'Este apontamento já foi tratado de outra forma'; end if;
  return true;
end;
$$;

revoke all on function public.fc_skip_duplicate_pending_pause(uuid,text,text,timestamptz) from public, anon;
grant execute on function public.fc_skip_duplicate_pending_pause(uuid,text,text,timestamptz) to authenticated;

commit;
