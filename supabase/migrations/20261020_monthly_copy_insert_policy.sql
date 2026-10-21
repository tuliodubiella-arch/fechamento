-- Um navegador antigo não pode recriar a lista virtual de competências futuras
-- através de INSERT direto em fc_month_owners. O RPC administrativo é o caminho
-- de cópia; tarefas nascidas no próprio mês e já iniciadas seguem atribuíveis.
begin;
drop policy if exists fc_month_owners_insert on public.fc_month_owners;
create policy fc_month_owners_insert on public.fc_month_owners
  for insert to authenticated with check (
    (select public.fc_is_member())
    and (competence < '2026-11' or (select public.fc_is_admin())
      or exists (select 1 from public.fc_tasks t
        where t.id = task_id and t.created_competence = competence)
      or exists (select 1 from public.fc_activity_states s
        where s.task_id = task_id and s.competence = competence
          and (s.status <> 'Não iniciado' or s.total_seconds > 0
            or s.first_started_at is not null or s.finished_at is not null))
      or exists (select 1 from public.fc_activity_events e
        where e.task_id = task_id and e.competence = competence))
  );
commit;
