-- Comentários por rotina/competência e sugestões de melhoria do portal.
begin;

create table if not exists public.fc_task_comments (
  id uuid primary key,
  task_id text not null references public.fc_tasks(id),
  competence text not null check (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- Guarda o identificador histórico mesmo se o acesso for excluído depois.
  author_id uuid not null,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists fc_task_comments_month_task_idx
  on public.fc_task_comments(competence, task_id, created_at);
alter table public.fc_task_comments enable row level security;
revoke all on public.fc_task_comments from public, anon, authenticated;
grant select on public.fc_task_comments to authenticated;
grant insert (id, task_id, competence, author_id, body) on public.fc_task_comments to authenticated;
create policy fc_task_comments_read on public.fc_task_comments
  for select to authenticated using ((select public.fc_is_member()));
create policy fc_task_comments_insert on public.fc_task_comments
  for insert to authenticated with check (
    (select public.fc_is_member()) and author_id = (select auth.uid())
  );

create table if not exists public.fc_improvement_suggestions (
  id uuid primary key,
  author_id uuid not null,
  body text not null check (length(trim(body)) between 10 and 4000),
  status text not null default 'Pendente'
    check (status in ('Pendente', 'Aceita', 'Rejeitada')),
  decision_reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fc_improvement_suggestions_decision_check check (
    (status = 'Pendente' and decision_reason is null and decided_by is null and decided_at is null)
    or (status in ('Aceita', 'Rejeitada') and length(trim(decision_reason)) between 8 and 1000
      and decided_by is not null and decided_at is not null)
  )
);
create index if not exists fc_improvement_suggestions_date_idx
  on public.fc_improvement_suggestions(created_at desc);
alter table public.fc_improvement_suggestions enable row level security;
revoke all on public.fc_improvement_suggestions from public, anon, authenticated;
grant select on public.fc_improvement_suggestions to authenticated;
grant insert (id, author_id, body) on public.fc_improvement_suggestions to authenticated;
grant update (status, decision_reason, decided_by, decided_at)
  on public.fc_improvement_suggestions to authenticated;
create policy fc_improvement_suggestions_read on public.fc_improvement_suggestions
  for select to authenticated using ((select public.fc_is_member()));
create policy fc_improvement_suggestions_insert on public.fc_improvement_suggestions
  for insert to authenticated with check (
    (select public.fc_is_member()) and author_id = (select auth.uid()) and status = 'Pendente'
  );
create policy fc_improvement_suggestions_decide on public.fc_improvement_suggestions
  for update to authenticated
  using ((select public.fc_is_admin()) and status = 'Pendente')
  with check ((select public.fc_is_admin()) and status in ('Aceita', 'Rejeitada')
    and decided_by = (select auth.uid()));

insert into public.fc_release_notes (version, title, details)
values ('2026.10.13.1', 'Comentários e sugestões de melhoria',
  'Cada atividade passa a ter comentários e apontamentos por competência, identificados por responsável e horário de Brasília. A nova tela Sugestões de melhoria recebe ideias de todos os usuários; administradores podem aceitar ou rejeitar cada sugestão com motivo registrado. Comentários e sugestões escritos offline aguardam sincronização no mesmo aparelho.')
on conflict (version, title) do nothing;

commit;
