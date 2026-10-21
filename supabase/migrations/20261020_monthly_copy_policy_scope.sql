-- Qualifique as colunas externas; nomes sem qualificação dentro de EXISTS
-- podem ser resolvidos na tabela interna e aceitar outro mês por engano.
begin;
drop policy if exists fc_month_owners_insert on public.fc_month_owners;
create policy fc_month_owners_insert on public.fc_month_owners
  for insert to authenticated with check (
    (select public.fc_is_member())
    and (fc_month_owners.competence < '2026-11' or (select public.fc_is_admin())
      or exists (select 1 from public.fc_tasks t
        where t.id = fc_month_owners.task_id
          and t.created_competence = fc_month_owners.competence)
      or exists (select 1 from public.fc_activity_states s
        where s.task_id = fc_month_owners.task_id
          and s.competence = fc_month_owners.competence
          and (s.status <> 'Não iniciado' or s.total_seconds > 0
            or s.first_started_at is not null or s.finished_at is not null))
      or exists (select 1 from public.fc_activity_events e
        where e.task_id = fc_month_owners.task_id
          and e.competence = fc_month_owners.competence))
  );
commit;
