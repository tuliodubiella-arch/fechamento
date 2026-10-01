-- Registra, sem alterar o tempo no servidor, um PAUSE local repetido que bloqueou a fila.
begin;

alter table public.fc_activity_corrections
  add column if not exists pending_event_id uuid;
create unique index if not exists fc_activity_corrections_pending_event_idx
  on public.fc_activity_corrections(pending_event_id);
alter table public.fc_activity_corrections
  drop constraint if exists fc_activity_corrections_correction_type_check;
alter table public.fc_activity_corrections
  add constraint fc_activity_corrections_correction_type_check
  check (correction_type in ('reset', 'time_edit', 'queue_skip'));

create or replace function public.fc_skip_duplicate_pending_pause(
  p_event_id uuid, p_task_id text, p_competence text, p_occurred_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state public.fc_activity_states%rowtype;
  v_last_action text;
  v_last_actor uuid;
  v_last_occurred_at timestamptz;
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
      and (previous_state->>'pending_occurred_at')::timestamptz = p_occurred_at) then
    return true; -- Resposta perdida: repetir não gera outra correção.
  end if;
  if exists (select 1 from public.fc_activity_events where id = p_event_id) then
    raise exception 'Este apontamento já foi gravado no servidor';
  end if;
  select * into v_state from public.fc_activity_states
    where task_id = p_task_id and competence = p_competence for update;
  if not found or v_state.status <> 'Pausado' or v_state.started_at is not null
    or v_state.last_actor_id is distinct from auth.uid()
    or v_state.updated_at is null or v_state.updated_at >= p_occurred_at then
    raise exception 'A rotina mudou; peça ao administrador para revisar a fila';
  end if;
  select action, actor_id, occurred_at
    into v_last_action, v_last_actor, v_last_occurred_at
    from public.fc_activity_events
    where task_id = p_task_id and competence = p_competence and voided_at is null
    order by occurred_at desc, id desc limit 1;
  if v_last_action is distinct from 'pause' or v_last_actor is distinct from auth.uid()
    or v_last_occurred_at is null or v_last_occurred_at >= p_occurred_at then
    raise exception 'Não foi possível confirmar o PAUSE repetido';
  end if;
  insert into public.fc_activity_corrections
    (task_id, competence, corrected_by, reason, events_affected, previous_state,
     correction_type, pending_event_id)
    values (p_task_id, p_competence, auth.uid(),
      'PAUSE local repetido, não enviado; confirmado pelo responsável. Nenhum tempo gravado foi alterado.',
      0,
      jsonb_build_object('pending_action', 'pause', 'pending_occurred_at', p_occurred_at,
        'last_server_action_at', v_last_occurred_at, 'server_state', to_jsonb(v_state)),
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
