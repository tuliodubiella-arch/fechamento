-- Uma ocorrência mensal nasce apenas no FINISH da ocorrência anterior.
begin;

alter table public.fc_general_routines
  add column recurrence_frequency text not null default 'none',
  add column scheduled_date date,
  add column next_scheduled_date date,
  add column recurrence_day smallint,
  add column previous_routine_id uuid references public.fc_general_routines(id),
  add constraint fc_general_routines_recurrence_check check (
    (recurrence_frequency = 'none' and next_scheduled_date is null and recurrence_day is null)
    or (recurrence_frequency = 'monthly' and next_scheduled_date is not null and recurrence_day between 1 and 31)
  ),
  add constraint fc_general_routines_previous_unique unique (previous_routine_id);

grant insert (recurrence_frequency, next_scheduled_date, recurrence_day)
  on public.fc_general_routines to authenticated;
drop policy fc_general_routines_insert on public.fc_general_routines;
create policy fc_general_routines_insert on public.fc_general_routines
  for insert to authenticated with check (
    (select public.fc_is_member()) and created_by = (select auth.uid())
    and exists (select 1 from public.fc_members m where m.id = responsible_id and m.active)
    and status = 'Não iniciada' and total_seconds = 0 and started_at is null
    and first_started_at is null and finished_at is null
    and scheduled_date is null and previous_routine_id is null
    and (recurrence_frequency = 'none'
      or recurrence_day = extract(day from next_scheduled_date)::smallint)
  );

-- Apenas responsável/administrador pode definir a próxima ocorrência.
create function public.fc_set_general_recurrence(
  p_routine_id uuid, p_frequency text, p_next_scheduled_date date
) returns public.fc_general_routines
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_routine public.fc_general_routines%rowtype;
begin
  if not public.fc_is_member() then raise exception 'Acesso não autorizado'; end if;
  if p_routine_id is null or p_frequency is null or p_frequency not in ('none', 'monthly')
    or (p_frequency = 'monthly' and p_next_scheduled_date is null)
    or (p_frequency = 'none' and p_next_scheduled_date is not null) then
    raise exception 'Informe uma recorrência e data válidas';
  end if;
  select * into v_routine from public.fc_general_routines where id = p_routine_id for update;
  if not found then raise exception 'Rotina não encontrada'; end if;
  if v_routine.responsible_id <> auth.uid() and not public.fc_is_admin() then
    raise exception 'Somente o responsável ou um administrador pode alterar a recorrência';
  end if;
  if v_routine.status = 'Finalizada' then raise exception 'A rotina já foi finalizada'; end if;
  update public.fc_general_routines set
    recurrence_frequency = p_frequency,
    next_scheduled_date = case when p_frequency = 'monthly' then p_next_scheduled_date else null end,
    recurrence_day = case when p_frequency = 'monthly' then extract(day from p_next_scheduled_date)::smallint else null end,
    updated_at = now()
    where id = p_routine_id returning * into v_routine;
  return v_routine;
end;
$$;
revoke all on function public.fc_set_general_recurrence(uuid,text,date)
  from public, anon, authenticated;
grant execute on function public.fc_set_general_recurrence(uuid,text,date)
  to authenticated;

create or replace function public.fc_apply_general_routine(
  p_event_id uuid, p_routine_id uuid, p_action text, p_occurred_at timestamptz
) returns public.fc_general_routines
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_routine public.fc_general_routines%rowtype;
  v_event public.fc_general_routine_events%rowtype;
  v_latest timestamptz;
  v_elapsed bigint := 0;
  v_month date;
  v_following date;
begin
  if not public.fc_is_member() then raise exception 'Acesso não autorizado'; end if;
  if p_event_id is null or p_routine_id is null or p_action not in ('play','pause','finish')
    or p_occurred_at is null or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Apontamento inválido';
  end if;
  select * into v_routine from public.fc_general_routines where id = p_routine_id for update;
  if not found then raise exception 'Rotina não encontrada'; end if;
  if v_routine.responsible_id <> auth.uid() and not public.fc_is_admin() then
    raise exception 'Somente o responsável ou um administrador pode controlar esta rotina';
  end if;
  select * into v_event from public.fc_general_routine_events where id = p_event_id;
  if found then
    if v_event.routine_id = p_routine_id and v_event.action = p_action
      and v_event.actor_id = auth.uid() and v_event.occurred_at = p_occurred_at then
      return v_routine;
    end if;
    raise exception 'Identificador de apontamento já utilizado';
  end if;
  select max(occurred_at) into v_latest from public.fc_general_routine_events
    where routine_id = p_routine_id;
  if v_latest is not null and p_occurred_at < v_latest then
    raise exception 'Há um apontamento mais recente nesta rotina. Atualize os dados antes de sincronizar.';
  end if;
  if p_action = 'play' and v_routine.status not in ('Não iniciada','Pausada') then
    raise exception 'A rotina não pode ser iniciada neste status';
  end if;
  if p_action = 'pause' and v_routine.status <> 'Em andamento' then
    raise exception 'A rotina não está em andamento';
  end if;
  if p_action = 'finish' and v_routine.status not in ('Em andamento','Pausada') then
    raise exception 'Inicie a rotina antes de finalizá-la';
  end if;
  if p_action in ('pause','finish') and v_routine.status = 'Em andamento' then
    if p_occurred_at < v_routine.started_at then raise exception 'Horário anterior ao início'; end if;
    v_elapsed := floor(extract(epoch from p_occurred_at - v_routine.started_at))::bigint;
  end if;
  insert into public.fc_general_routine_events
    (id, routine_id, action, actor_id, occurred_at, elapsed_seconds)
    values (p_event_id, p_routine_id, p_action, auth.uid(), p_occurred_at, v_elapsed);
  update public.fc_general_routines set
    status = case p_action when 'play' then 'Em andamento' when 'pause' then 'Pausada' else 'Finalizada' end,
    total_seconds = total_seconds + v_elapsed,
    started_at = case when p_action = 'play' then p_occurred_at else null end,
    first_started_at = coalesce(first_started_at, case when p_action = 'play' then p_occurred_at else null end),
    finished_at = case when p_action = 'finish' then p_occurred_at else null end,
    last_actor_id = auth.uid(), updated_at = now()
    where id = p_routine_id returning * into v_routine;
  if p_action = 'finish' and v_routine.recurrence_frequency = 'monthly' then
    v_month := (date_trunc('month', v_routine.next_scheduled_date) + interval '1 month')::date;
    v_following := make_date(
      extract(year from v_month)::int,
      extract(month from v_month)::int,
      least(v_routine.recurrence_day::int,
        extract(day from (v_month + interval '1 month' - interval '1 day'))::int)
    );
    insert into public.fc_general_routines
      (id, title, description, responsible_id, created_by, scheduled_date,
       recurrence_frequency, next_scheduled_date, recurrence_day, previous_routine_id)
    values
      (p_event_id, v_routine.title, v_routine.description, v_routine.responsible_id,
       auth.uid(), v_routine.next_scheduled_date, 'monthly', v_following,
       v_routine.recurrence_day, v_routine.id);
  end if;
  return v_routine;
end;
$$;
revoke all on function public.fc_apply_general_routine(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.fc_apply_general_routine(uuid,uuid,text,timestamptz)
  to authenticated;

insert into public.fc_release_notes (version, title, details)
values ('2026.10.20.1', 'Recorrência mensal das rotinas avulsas',
  'Cadastro e edição da recorrência mensal com data da próxima execução. Ao finalizar, uma nova ocorrência é criada com responsável e descrição preservados, cronômetro zerado e próxima data mensal calculada; repetição de sincronização não duplica a rotina.')
on conflict (version, title) do nothing;

commit;
