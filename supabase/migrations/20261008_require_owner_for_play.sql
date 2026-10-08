-- Impede novos PLAYs sem responsável mensal definido, inclusive em versões antigas da interface.
-- PAUSE e STOP permanecem possíveis para apontamentos já iniciados.
create or replace function public.fc_require_owner_for_play()
returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.action = 'play' and not exists (
    select 1 from public.fc_month_owners o
    where o.task_id = new.task_id
      and o.competence = new.competence
      and o.responsible_id is not null
  ) then
    raise exception 'Esta tarefa não pode ser iniciada sem um responsável definido';
  end if;
  return new;
end;
$$;

revoke all on function public.fc_require_owner_for_play() from public, anon, authenticated;
drop trigger if exists fc_require_owner_for_play on public.fc_activity_events;
create trigger fc_require_owner_for_play
before insert on public.fc_activity_events
for each row execute function public.fc_require_owner_for_play();
