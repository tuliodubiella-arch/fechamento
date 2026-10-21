-- Libera setembro/2026 como origem da cópia, mantendo todas as proteções
-- existentes para outubro: não substituir responsáveis nem apontamentos.
begin;
create or replace function public.fc_copy_month_tasks(p_source_competence text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target text;
  v_added integer := 0;
  v_source_total integer := 0;
begin
  if not public.fc_is_admin() then
    raise exception 'Somente administradores podem copiar a lista de rotinas';
  end if;
  if p_source_competence is null
    or p_source_competence !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or p_source_competence < '2026-09' then
    raise exception 'Selecione setembro/2026 ou um mês posterior';
  end if;
  v_target := to_char((p_source_competence || '-01')::date + interval '1 month', 'YYYY-MM');

  insert into public.fc_targets(company_id, competence, category, sort_order)
  select c.id, v_target, c.category, 9999
  from public.fc_companies c
  where exists (select 1 from public.fc_tasks t
    where t.company_id = c.id
      and fc_internal.task_in_month(t.id, p_source_competence)
      and (t.retired_competence is null or t.retired_competence > v_target))
  on conflict (company_id, competence) do nothing;
  perform 1 from public.fc_targets g
  where g.competence = v_target
    and exists (select 1 from public.fc_tasks t
      where t.company_id = g.company_id
        and fc_internal.task_in_month(t.id, p_source_competence)
        and (t.retired_competence is null or t.retired_competence > v_target))
  order by g.company_id for update;

  select count(*) into v_source_total from public.fc_tasks t
  where fc_internal.task_in_month(t.id, p_source_competence)
    and (t.retired_competence is null or t.retired_competence > v_target);
  insert into public.fc_month_owners(task_id, competence, responsible_id, responsible_legacy_name)
  select t.id, v_target,
    case when source.task_id is not null then source.responsible_id else t.responsible_id end,
    case when source.task_id is not null then source.responsible_legacy_name else t.responsible_legacy_name end
  from public.fc_tasks t
  left join public.fc_month_owners source
    on source.task_id = t.id and source.competence = p_source_competence
  where fc_internal.task_in_month(t.id, p_source_competence)
    and (t.retired_competence is null or t.retired_competence > v_target)
    and not exists (select 1 from public.fc_targets g
      where g.company_id = t.company_id and g.competence = v_target
        and g.delivery_at is not null)
    and not exists (select 1 from public.fc_activity_events e
      where e.task_id = t.id and e.competence = v_target)
    and not exists (select 1 from public.fc_activity_states s
      where s.task_id = t.id and s.competence = v_target
        and (s.status <> 'Não iniciado' or s.total_seconds > 0
          or s.first_started_at is not null or s.finished_at is not null))
  on conflict (task_id, competence) do nothing;
  get diagnostics v_added = row_count;
  return jsonb_build_object('source', p_source_competence, 'target', v_target,
    'source_total', v_source_total, 'added', v_added);
end;
$$;
revoke all on function public.fc_copy_month_tasks(text) from public, anon, authenticated;
grant execute on function public.fc_copy_month_tasks(text) to authenticated;

insert into public.fc_release_notes(version, title, details)
values ('2026.10.20.3', 'Cópia de setembro para outubro',
  'O administrador também pode copiar a lista de Execução de setembro/2026 para outubro/2026. A cópia acrescenta apenas rotinas ausentes e mantém os responsáveis já definidos, os apontamentos e o histórico de ambos os meses.')
on conflict (version, title) do nothing;
commit;
