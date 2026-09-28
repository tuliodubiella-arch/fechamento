-- Correção auditável do tempo total de uma tarefa por administradores.
-- Aplicar no projeto de fechamento antes da interface 2026.09.28.2.
begin;

alter table public.fc_activity_corrections
  add column if not exists correction_type text not null default 'reset'
    check (correction_type in ('reset', 'time_edit')),
  add column if not exists old_total_seconds integer check (old_total_seconds >= 0),
  add column if not exists new_total_seconds integer check (new_total_seconds >= 0);

create or replace function public.fc_adjust_activity_time(
  p_task_id text, p_competence text, p_new_total_seconds integer, p_reason text
) returns public.fc_activity_states
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state public.fc_activity_states%rowtype;
  v_company text;
  v_now timestamptz := clock_timestamp();
begin
  if not public.fc_is_admin() then
    raise exception 'Somente administradores podem editar o tempo de execução';
  end if;
  if p_task_id is null or p_competence is null
    or p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or p_new_total_seconds is null or p_new_total_seconds < 0
    or p_new_total_seconds > 3599999
    or p_reason is null or length(trim(p_reason)) not between 8 and 500 then
    raise exception 'Informe tarefa, mês, tempo válido e motivo de 8 a 500 caracteres';
  end if;
  select t.company_id into v_company from public.fc_tasks t
    where t.id = p_task_id and t.created_competence <= p_competence
      and (t.active or t.retired_competence is not null)
      and (t.retired_competence is null or t.retired_competence > p_competence);
  if v_company is null then raise exception 'Tarefa não encontrada nesta competência'; end if;

  -- Serializa com PLAY/PAUSE/STOP e outras correções da mesma empresa/mês.
  insert into public.fc_targets(company_id, competence, category, sort_order)
    select id, p_competence, category, 9999 from public.fc_companies where id = v_company
    on conflict (company_id, competence) do nothing;
  perform 1 from public.fc_targets
    where company_id = v_company and competence = p_competence for update;
  select * into v_state from public.fc_activity_states
    where task_id = p_task_id and competence = p_competence for update;
  if not found or v_state.first_started_at is null then
    raise exception 'Esta tarefa ainda não possui tempo para corrigir';
  end if;
  if v_state.status not in ('Pausado', 'Finalizado') then
    raise exception 'Pause ou finalize a tarefa antes de editar seu tempo';
  end if;
  if v_state.total_seconds = p_new_total_seconds then
    raise exception 'O novo tempo é igual ao tempo atual';
  end if;

  insert into public.fc_activity_corrections
    (task_id, competence, corrected_by, corrected_at, reason, events_affected,
     previous_state, correction_type, old_total_seconds, new_total_seconds)
  values
    (p_task_id, p_competence, auth.uid(), v_now, trim(p_reason), 0,
     to_jsonb(v_state), 'time_edit', v_state.total_seconds, p_new_total_seconds);
  update public.fc_activity_states
    set total_seconds = p_new_total_seconds, updated_at = v_now
    where task_id = p_task_id and competence = p_competence
    returning * into v_state;
  return v_state;
end;
$$;
revoke all on function public.fc_adjust_activity_time(text,text,integer,text) from public, anon;
grant execute on function public.fc_adjust_activity_time(text,text,integer,text) to authenticated;

commit;
