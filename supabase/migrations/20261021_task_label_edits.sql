-- A descrição da rotina pode mudar a partir de uma competência sem reescrever
-- o nome visto nos meses anteriores ou perder eventos vinculados ao task_id.
begin;

create table public.fc_task_label_edits (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.fc_tasks(id),
  effective_competence text not null
    check (effective_competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  old_account text not null,
  old_group_name text not null,
  new_account text not null check (length(trim(new_account)) between 1 and 250),
  new_group_name text not null check (length(trim(new_group_name)) between 1 and 120),
  changed_by uuid not null references public.fc_members(id),
  changed_at timestamptz not null default clock_timestamp()
);
create index fc_task_label_edits_lookup_idx
  on public.fc_task_label_edits(task_id, effective_competence desc, changed_at desc, id desc);
alter table public.fc_task_label_edits enable row level security;
revoke all on public.fc_task_label_edits from public, anon, authenticated;
grant select on public.fc_task_label_edits to authenticated;
create policy fc_task_label_edits_member_read on public.fc_task_label_edits
  for select to authenticated using ((select public.fc_is_member()));

-- Impede que um UPDATE direto mude o título global e altere meses encerrados.
revoke update (account, group_name) on public.fc_tasks from authenticated;

create function public.fc_edit_task_label(
  p_task_id text, p_competence text, p_account text, p_group_name text
) returns public.fc_task_label_edits
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_task public.fc_tasks%rowtype;
  v_old_account text;
  v_old_group_name text;
  v_edit public.fc_task_label_edits%rowtype;
begin
  if not public.fc_is_admin() then
    raise exception 'Somente administradores podem editar rotinas';
  end if;
  if p_task_id is null or p_competence is null
    or p_competence !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or length(trim(coalesce(p_account, ''))) not between 1 and 250
    or length(trim(coalesce(p_group_name, ''))) not between 1 and 120 then
    raise exception 'Informe rotina, competência, nome e grupo válidos';
  end if;

  select * into v_task from public.fc_tasks where id = p_task_id;
  if not found or not fc_internal.task_in_month(p_task_id, p_competence) then
    raise exception 'Rotina não encontrada nesta competência';
  end if;
  insert into public.fc_targets(company_id, competence, category, sort_order)
    select c.id, p_competence, c.category, 9999
    from public.fc_companies c where c.id = v_task.company_id
    on conflict (company_id, competence) do nothing;
  perform 1 from public.fc_targets
    where company_id = v_task.company_id and competence = p_competence for update;
  select * into v_task from public.fc_tasks where id = p_task_id for update;
  if not fc_internal.task_in_month(p_task_id, p_competence) then
    raise exception 'Rotina não está mais na lista desta competência';
  end if;
  if exists (select 1 from public.fc_targets g
    where g.company_id = v_task.company_id and g.competence >= p_competence
      and g.delivery_at is not null) then
    raise exception 'Há fechamento encerrado neste mês ou em mês posterior';
  end if;

  select coalesce(e.new_account, v_task.account),
    coalesce(e.new_group_name, coalesce(v_task.group_name, ''))
    into v_old_account, v_old_group_name
  from (select 1) anchor
  left join lateral (
    select new_account, new_group_name from public.fc_task_label_edits
    where task_id = p_task_id and effective_competence <= p_competence
    order by effective_competence desc, changed_at desc, id desc limit 1
  ) e on true;
  if v_old_account = trim(p_account) and v_old_group_name = trim(p_group_name) then
    raise exception 'O nome e o grupo já estão iguais aos informados';
  end if;

  insert into public.fc_task_label_edits
    (task_id, effective_competence, old_account, old_group_name,
      new_account, new_group_name, changed_by)
  values (p_task_id, p_competence, v_old_account, v_old_group_name,
    trim(p_account), trim(p_group_name), auth.uid())
  returning * into v_edit;
  return v_edit;
end;
$$;
revoke all on function public.fc_edit_task_label(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.fc_edit_task_label(text,text,text,text)
  to authenticated;

insert into public.fc_release_notes(version, title, details)
values ('2026.10.21.1', 'Edição de rotinas por competência',
  'Administradores podem corrigir o nome e o grupo de uma rotina na tela Execução sem excluir a tarefa. A alteração vale a partir do mês selecionado, preserva meses anteriores, responsáveis, status, tempos e eventos, e fica registrada com usuário e horário de Brasília.')
on conflict (version, title) do nothing;
commit;
