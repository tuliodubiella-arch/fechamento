begin;

drop policy if exists org_workspace_update on public.org_workspace;
create policy org_workspace_update on public.org_workspace
  for update to authenticated
  using ((select public.fc_is_admin()))
  with check ((select public.fc_is_admin()) and updated_by = (select auth.uid()));

create or replace function public.fc_set_member_role(p_member_id uuid, p_is_admin boolean)
returns public.fc_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.fc_members%rowtype;
begin
  if not public.fc_is_admin() then
    raise exception 'Somente administradores podem alterar perfis de acesso';
  end if;
  if p_member_id = auth.uid() and not p_is_admin then
    raise exception 'O administrador não pode retirar o próprio acesso administrativo';
  end if;
  update public.fc_members
     set is_admin = p_is_admin,
         admin_granted_at = case when p_is_admin then clock_timestamp() else null end,
         admin_granted_by = case when p_is_admin then auth.uid() else null end
   where id = p_member_id and active
   returning * into v_member;
  if v_member.id is null then
    raise exception 'Usuário ativo não encontrado';
  end if;
  return v_member;
end;
$$;

revoke all on function public.fc_set_member_role(uuid, boolean) from public, anon;
grant execute on function public.fc_set_member_role(uuid, boolean) to authenticated;

commit;
