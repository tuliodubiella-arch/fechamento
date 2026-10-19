-- Rotinas avulsas: não participam do fechamento, metas ou balancete mensal.
begin;

create table public.fc_general_routines (
  id uuid primary key,
  title text not null check (length(trim(title)) between 3 and 200),
  description text check (description is null or length(description) <= 4000),
  responsible_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  status text not null default 'Não iniciada'
    check (status in ('Não iniciada', 'Em andamento', 'Pausada', 'Finalizada')),
  total_seconds bigint not null default 0 check (total_seconds >= 0),
  started_at timestamptz,
  first_started_at timestamptz,
  finished_at timestamptz,
  last_actor_id uuid,
  updated_at timestamptz not null default now(),
  constraint fc_general_routines_time_check check (
    (status = 'Não iniciada' and started_at is null and first_started_at is null and finished_at is null and total_seconds = 0)
    or (status = 'Em andamento' and started_at is not null and first_started_at is not null and finished_at is null)
    or (status = 'Pausada' and started_at is null and first_started_at is not null and finished_at is null)
    or (status = 'Finalizada' and started_at is null and first_started_at is not null and finished_at is not null)
  )
);
create index fc_general_routines_responsible_status_idx
  on public.fc_general_routines(responsible_id, status, created_at desc);
alter table public.fc_general_routines enable row level security;
revoke all on public.fc_general_routines from public, anon, authenticated;
grant select on public.fc_general_routines to authenticated;
grant insert (id, title, description, responsible_id, created_by) on public.fc_general_routines to authenticated;
create policy fc_general_routines_read on public.fc_general_routines
  for select to authenticated using ((select public.fc_is_member()));
create policy fc_general_routines_insert on public.fc_general_routines
  for insert to authenticated with check (
    (select public.fc_is_member()) and created_by = (select auth.uid())
    and exists (select 1 from public.fc_members m where m.id = responsible_id and m.active)
    and status = 'Não iniciada' and total_seconds = 0 and started_at is null
    and first_started_at is null and finished_at is null
  );

create table public.fc_general_routine_events (
  id uuid primary key,
  routine_id uuid not null references public.fc_general_routines(id) on delete restrict,
  action text not null check (action in ('play', 'pause', 'finish')),
  actor_id uuid not null,
  occurred_at timestamptz not null,
  elapsed_seconds bigint not null default 0 check (elapsed_seconds >= 0)
);
create index fc_general_routine_events_routine_time_idx
  on public.fc_general_routine_events(routine_id, occurred_at, id);
alter table public.fc_general_routine_events enable row level security;
revoke all on public.fc_general_routine_events from public, anon, authenticated;
grant select on public.fc_general_routine_events to authenticated;
create policy fc_general_routine_events_read on public.fc_general_routine_events
  for select to authenticated using ((select public.fc_is_member()));

create table public.fc_general_routine_notes (
  id uuid primary key,
  routine_id uuid not null references public.fc_general_routines(id) on delete restrict,
  author_id uuid not null,
  body text not null check (length(trim(body)) between 1 and 4000),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index fc_general_routine_notes_routine_time_idx
  on public.fc_general_routine_notes(routine_id, occurred_at, id);
alter table public.fc_general_routine_notes enable row level security;
revoke all on public.fc_general_routine_notes from public, anon, authenticated;
grant select on public.fc_general_routine_notes to authenticated;
grant insert (id, routine_id, author_id, body, occurred_at)
  on public.fc_general_routine_notes to authenticated;
create policy fc_general_routine_notes_read on public.fc_general_routine_notes
  for select to authenticated using ((select public.fc_is_member()));
create policy fc_general_routine_notes_insert on public.fc_general_routine_notes
  for insert to authenticated with check (
    (select public.fc_is_member()) and author_id = (select auth.uid())
    and occurred_at <= now() + interval '5 minutes'
    and exists (select 1 from public.fc_general_routines r
      where r.id = routine_id and r.status <> 'Finalizada')
  );

-- A operação única serializa o cronômetro e impede inserir eventos sem alterar o total.
create function public.fc_apply_general_routine(
  p_event_id uuid, p_routine_id uuid, p_action text, p_occurred_at timestamptz
) returns public.fc_general_routines
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_routine public.fc_general_routines%rowtype;
  v_event public.fc_general_routine_events%rowtype;
  v_latest timestamptz;
  v_elapsed bigint := 0;
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
  return v_routine;
end;
$$;
revoke all on function public.fc_apply_general_routine(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.fc_apply_general_routine(uuid,uuid,text,timestamptz)
  to authenticated;

insert into public.fc_release_notes (version, title, details)
values ('2026.10.19.1', 'Rotinas avulsas com cronômetro e anotações',
  'Nova tela independente do fechamento mensal para cadastrar rotinas, atribuir responsáveis, acompanhar PLAY/PAUSE/FINISH, tempo acumulado e anotações em ordem cronológica. Os registros podem ser feitos offline e sincronizados no mesmo aparelho.')
on conflict (version, title) do nothing;

commit;
