-- Novas entregas usam a data/hora informada do e-mail, sem exigir imagem.
-- Prints já gravados e operações antigas ainda pendentes no navegador permanecem válidos.
begin;

alter table public.fc_receipt_deliveries
  alter column source set default 'manual';

alter table public.fc_receipt_deliveries
  drop constraint if exists fc_receipt_deliveries_source_check;
alter table public.fc_receipt_deliveries
  drop constraint if exists fc_receipt_deliveries_check;

-- Os nomes acima são os gerados pelo PostgreSQL para as duas restrições originais.
-- Remova por definição para suportar bases onde o nome foi atribuído de outra forma.
do $$
declare v_constraint record;
begin
  for v_constraint in
    select conname from pg_constraint
    where conrelid = 'public.fc_receipt_deliveries'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%source%'
        or pg_get_constraintdef(oid) like '%evidence_path%')
  loop
    execute format('alter table public.fc_receipt_deliveries drop constraint %I', v_constraint.conname);
  end loop;
end $$;

alter table public.fc_receipt_deliveries
  add constraint fc_receipt_deliveries_source_valid
    check (source in ('manual','print','legacy')),
  add constraint fc_receipt_deliveries_evidence_valid
    check ((source = 'legacy' and evidence_path is null)
      or (source = 'manual' and evidence_path is null and recorded_by is not null)
      or (source = 'print' and evidence_path is not null and recorded_by is not null));

drop policy if exists fc_receipt_deliveries_insert on public.fc_receipt_deliveries;
create policy fc_receipt_deliveries_insert on public.fc_receipt_deliveries
  for insert to authenticated with check (
    (select public.fc_is_member()) and recorded_by = (select auth.uid())
    and ((source = 'manual' and evidence_path is null)
      or (source = 'print' and evidence_path like (select auth.uid())::text || '/%'))
  );

insert into public.fc_release_notes (version, title, details)
values ('2026.10.01.6', 'Entregas externas por horário do e-mail',
  'Novo registro sem upload: o usuário informa a data e hora exatas do e-mail em Brasília e classifica a entrega como parcial ou completa. O painel guarda separadamente o momento do lançamento, mantém o histórico de recebimentos e preserva os prints antigos já registrados.')
on conflict (version, title) do nothing;

commit;
