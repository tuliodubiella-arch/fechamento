-- Retira da fila local um PAUSE/STOP da mesma execução que já foi anulada
-- por uma correção administrativa e substituída por uma execução finalizada.
-- Nenhum evento ou tempo de trabalho gravado é alterado por esta função.
begin;

create or replace function public.fc_skip_stale_reset_pair(p_events jsonb)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_first jsonb;
  v_second jsonb;
  v_task_id text;
  v_competence text;
  v_first_id uuid;
  v_second_id uuid;
  v_first_at timestamptz;
  v_second_at timestamptz;
  v_state public.fc_activity_states%rowtype;
  v_reset public.fc_activity_corrections%rowtype;
  v_existing integer;
begin
  if not public.fc_is_member() then raise exception 'Acesso não autorizado'; end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) <> 2 then
    raise exception 'Informe exatamente o PAUSE e o STOP pendentes';
  end if;
  v_first := p_events->0;
  v_second := p_events->1;
  if v_first->>'action' is distinct from 'pause' or v_second->>'action' is distinct from 'stop'
    or v_first->>'task_id' is null or v_first->>'competence' is null
    or v_first->>'task_id' is distinct from v_second->>'task_id'
    or v_first->>'competence' is distinct from v_second->>'competence'
    or v_first->>'competence' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'O par de apontamentos pendentes é inválido';
  end if;
  v_task_id := v_first->>'task_id';
  v_competence := v_first->>'competence';
  v_first_id := (v_first->>'event_id')::uuid;
  v_second_id := (v_second->>'event_id')::uuid;
  v_first_at := (v_first->>'occurred_at')::timestamptz;
  v_second_at := (v_second->>'occurred_at')::timestamptz;
  if v_first_id is null or v_second_id is null or v_first_id = v_second_id
    or v_first_at is null or v_second_at is null
    or v_second_at <= v_first_at or v_second_at > v_first_at + interval '5 minutes'
    or v_second_at > now() + interval '5 minutes' then
    raise exception 'Identificadores ou horários pendentes inválidos';
  end if;

  -- Uma resposta de rede perdida não pode gerar duas retiradas.
  select count(*) into v_existing from public.fc_activity_corrections
    where pending_event_id in (v_first_id, v_second_id)
      and correction_type = 'queue_skip' and corrected_by = auth.uid()
      and task_id = v_task_id and competence = v_competence
      and ((pending_event_id = v_first_id
        and previous_state->>'pending_action' = 'pause'
        and (previous_state->>'pending_occurred_at')::timestamptz = v_first_at)
        or (pending_event_id = v_second_id
        and previous_state->>'pending_action' = 'stop'
        and (previous_state->>'pending_occurred_at')::timestamptz = v_second_at));
  if v_existing = 2 then return true; end if;
  if v_existing <> 0 or exists (
    select 1 from public.fc_activity_corrections
    where pending_event_id in (v_first_id, v_second_id)
  ) then raise exception 'Um dos apontamentos já foi tratado de outra forma'; end if;
  if exists (select 1 from public.fc_activity_events where id in (v_first_id, v_second_id)) then
    raise exception 'Um dos apontamentos já foi gravado no servidor';
  end if;

  select * into v_state from public.fc_activity_states
    where task_id = v_task_id and competence = v_competence for update;
  if not found or v_state.status <> 'Finalizado' or v_state.last_actor_id is distinct from auth.uid()
    or v_state.first_started_at is null or v_state.finished_at is null then
    raise exception 'A rotina não está finalizada pela responsável; peça revisão ao administrador';
  end if;
  select * into v_reset from public.fc_activity_corrections
    where task_id = v_task_id and competence = v_competence
      and correction_type = 'reset' and corrected_at > v_second_at
      and corrected_at < v_state.first_started_at
      and previous_state->>'status' = 'Pausado'
      and previous_state->>'last_actor_id' = auth.uid()::text
      and (previous_state->>'updated_at')::timestamptz < v_first_at
    order by corrected_at desc limit 1;
  if not found or not exists (
    select 1 from public.fc_activity_events e
    where e.task_id = v_task_id and e.competence = v_competence
      and e.action = 'pause' and e.actor_id = auth.uid()
      and e.occurred_at = (v_reset.previous_state->>'updated_at')::timestamptz
      and e.voided_at = v_reset.corrected_at
  ) then raise exception 'Não foi possível vincular a fila à execução anulada'; end if;

  insert into public.fc_activity_corrections
    (task_id, competence, corrected_by, reason, events_affected, previous_state,
     correction_type, pending_event_id)
  values
    (v_task_id, v_competence, auth.uid(),
     'PAUSE local anterior à limpeza administrativa; não enviado. Nenhum tempo gravado foi alterado.',
     0, jsonb_build_object('pending_action','pause','pending_occurred_at',v_first_at,
       'reset_correction_id',v_reset.id,'server_state',to_jsonb(v_state)), 'queue_skip', v_first_id),
    (v_task_id, v_competence, auth.uid(),
     'STOP local anterior à limpeza administrativa; não enviado. Nenhum tempo gravado foi alterado.',
     0, jsonb_build_object('pending_action','stop','pending_occurred_at',v_second_at,
       'reset_correction_id',v_reset.id,'server_state',to_jsonb(v_state)), 'queue_skip', v_second_id);
  return true;
end;
$$;

revoke all on function public.fc_skip_stale_reset_pair(jsonb) from public, anon;
grant execute on function public.fc_skip_stale_reset_pair(jsonb) to authenticated;

commit;
