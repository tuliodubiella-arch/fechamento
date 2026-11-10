begin;
-- Preserva as validações e permissões existentes, ampliando somente a frequência.
do $$
declare target record; definition text;
begin
 for target in select oid,proname from pg_proc where pronamespace='public'::regnamespace
 and proname in ('fs_create_item','fs_edit_routine','fs_edit_group_item','fs_generate_recurrence') loop
  definition:=pg_get_functiondef(target.oid);
  if target.proname='fs_generate_recurrence' then
   if position('''Diária'',''Semanal'',''Mensal''' in definition)=0 then raise exception 'Revise a função de recorrência antes de atualizar.';end if;
   definition:=replace(definition,'''Diária'',''Semanal'',''Mensal''','''Diária'',''Semanal'',''Mensal'',''Anual''');
  else
   if position('''Diária'',''Semanal'',''Mensal'',''Única''' in definition)=0 then raise exception 'Revise a função % antes de atualizar.',target.proname;end if;
   definition:=replace(definition,'''Diária'',''Semanal'',''Mensal'',''Única''','''Diária'',''Semanal'',''Mensal'',''Anual'',''Única''');
  end if;
  execute definition;
 end loop;
end;$$;
create or replace function public.fs_next_recurrence_date(p_day date,p_frequency text,p_anchor integer)
returns date language sql immutable set search_path='' as $$
 select case p_frequency
 when 'Diária' then p_day+1
 when 'Semanal' then p_day+7
 when 'Mensal' then (date_trunc('month',p_day)+interval '1 month')::date
  +least(p_anchor,extract(day from (date_trunc('month',p_day)+interval '2 months - 1 day'))::integer)-1
 when 'Anual' then (date_trunc('month',p_day)+interval '1 year')::date
  +least(p_anchor,extract(day from (date_trunc('month',p_day)+interval '1 year 1 month - 1 day'))::integer)-1
 end;
$$;
revoke all on function public.fs_next_recurrence_date(date,text,integer) from public,anon,authenticated;
commit;
