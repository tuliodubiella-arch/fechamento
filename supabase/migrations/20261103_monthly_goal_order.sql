-- Ordenação independente e atômica por competência, sem alterar meses anteriores.
create or replace function public.fc_reorder_targets(p_competence text, p_company_ids text[])
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_expected integer;
  v_updated integer;
begin
  if auth.uid() is null or not public.fc_is_member() then
    raise exception 'Acesso não autorizado';
  end if;
  if p_competence is null or p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_competence < '2026-10' then
    raise exception 'A ordem só pode ser alterada a partir de outubro/2026';
  end if;
  perform pg_advisory_xact_lock(hashtext('fc_reorder_targets:' || p_competence));
  select count(*) into v_expected from public.fc_companies where active;
  if p_company_ids is null or cardinality(p_company_ids) <> v_expected
    or (select count(distinct id) from unnest(p_company_ids) as ids(id)) <> v_expected
    or exists (select 1 from unnest(p_company_ids) as ids(id)
      left join public.fc_companies c on c.id = ids.id and c.active where c.id is null) then
    raise exception 'A lista de empresas mudou. Atualize a página e tente novamente';
  end if;

  insert into public.fc_targets (company_id, competence, category, sort_order)
  select c.id, p_competence, c.category, 9999 from public.fc_companies c where c.active
  on conflict (company_id, competence) do nothing;

  update public.fc_targets t
  set sort_order = ids.position::integer, updated_at = now()
  from unnest(p_company_ids) with ordinality as ids(id, position)
  where t.company_id = ids.id and t.competence = p_competence;
  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception 'Não foi possível gravar toda a ordem mensal';
  end if;
  return v_updated;
end;
$$;

revoke all on function public.fc_reorder_targets(text, text[]) from public, anon;
grant execute on function public.fc_reorder_targets(text, text[]) to authenticated;
