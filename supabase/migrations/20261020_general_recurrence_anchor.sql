-- Salvar a mesma data não troca o dia-base mensal após um mês curto.
begin;
create or replace function public.fc_set_general_recurrence(
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
    recurrence_day = case
      when p_frequency = 'none' then null
      when v_routine.recurrence_frequency = 'monthly'
        and v_routine.next_scheduled_date = p_next_scheduled_date then v_routine.recurrence_day
      else extract(day from p_next_scheduled_date)::smallint end,
    updated_at = now()
    where id = p_routine_id returning * into v_routine;
  return v_routine;
end;
$$;
revoke all on function public.fc_set_general_recurrence(uuid,text,date)
  from public, anon, authenticated;
grant execute on function public.fc_set_general_recurrence(uuid,text,date)
  to authenticated;
commit;
