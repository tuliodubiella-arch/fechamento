begin;
create or replace function public.fs_guard_deleted_item() returns trigger language plpgsql set search_path='' as $$
begin
 if old.deleted_at is not null then
  if current_user='fs_department_executor' and public.fs_is_admin()
   and old.department_id=public.fs_current_department() and new.deleted_at is null and new.deleted_by is null
   and new.id=old.id and new.department_id=old.department_id and new.data=old.data and new.version=old.version+1 then return new;end if;
  raise exception 'Esta rotina ou projeto foi excluído. Utilize Tarefas excluídas para restaurar.';
 end if;
 return new;
end;$$;
-- Operações executadas por papel interno sem BYPASSRLS, como as demais rotinas.
create function public.fs_get_deleted_tasks() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 select coalesce(jsonb_agg(task order by deleted_at desc,id),'[]'::jsonb) into result from (
  select i.id,i.deleted_at,jsonb_build_object('id',i.id,'source','shared','title',i.data->>'title','type',i.data->>'type','version',i.version,'deletedAt',i.deleted_at,'deletedBy',m.name,'ownerName',o.name,'status',i.data->>'status','groupName',g.data->>'title','groupUnavailable',coalesce(i.data->>'groupId','')<>'' and (g.id is null or g.deleted_at is not null),'activities',jsonb_array_length(coalesce(i.data->'activities','[]')),'comments',jsonb_array_length(coalesce(i.data->'comments','[]')),'executions',jsonb_array_length(coalesce(i.data->'executions','[]'))) task
  from public.fs_items i left join public.fs_members m on m.id=i.deleted_by left join public.fs_members o on o.id::text=i.data->>'owner' left join public.fs_groups g on g.id::text=i.data->>'groupId'
  where i.department_id=public.fs_current_department() and i.deleted_at is not null and public.fs_is_admin()
  union all
  select i.id,i.deleted_at,jsonb_build_object('id',i.id,'source','personal','title',i.data->>'title','type','personal','version',i.version,'deletedAt',i.deleted_at,'ownerName','Somente eu','status',i.data->>'status','activities',jsonb_array_length(coalesce(i.data->'activities','[]'))) task
  from public.fs_personal_items i where i.department_id=public.fs_current_department() and i.owner_id=auth.uid() and i.deleted_at is not null
 ) tasks;
 return result;
end;$$;

create function public.fs_restore_task(p_id uuid,p_source text,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fs_items; personal public.fs_personal_items; actor text; dep uuid:=public.fs_current_department();
begin
 if auth.uid() is null or dep is null then raise exception 'Acesso negado.';end if;
 if p_source='shared' then
  if not public.fs_is_admin() then raise exception 'Somente o administrador do departamento pode restaurar tarefas da equipe.';end if;
  select * into r from public.fs_items where id=p_id and department_id=dep for update;
  if not found or r.deleted_at is null then raise exception 'Tarefa não encontrada entre as excluídas deste departamento. Atualize a lista.';end if;
  if p_version is distinct from r.version then raise exception 'Esta tarefa mudou. Atualize a lista antes de restaurar.';end if;
  -- Serializa a restauração com alterações/exclusões do grupo.
  if coalesce(r.data->>'groupId','')<>'' then
   perform 1 from public.fs_groups where id::text=r.data->>'groupId' and department_id=dep and deleted_at is null for share;
   if not found then raise exception 'O grupo desta tarefa foi excluído. Solicite a recuperação do grupo antes de restaurar a tarefa.';end if;
  end if;
  -- Mantém integralmente data, anexos, responsáveis, status e vínculos de recorrência.
  update public.fs_items set deleted_at=null,deleted_by=null,version=version+1 where id=p_id;
  select name into actor from public.fs_members where id=auth.uid();
  insert into public.fs_events("user",action,item,department_id) values(actor,case when r.data->>'type'='project' then 'Restaurou o projeto' else 'Restaurou a rotina' end,r.data->>'title',dep);
 elsif p_source='personal' then
  select * into personal from public.fs_personal_items where id=p_id and department_id=dep and owner_id=auth.uid() for update;
  if not found or personal.deleted_at is null then raise exception 'Atividade pessoal não encontrada entre as suas excluídas. Atualize a lista.';end if;
  if p_version is distinct from personal.version then raise exception 'Esta atividade mudou. Atualize a lista antes de restaurar.';end if;
  update public.fs_personal_items set deleted_at=null,version=version+1 where id=p_id;
  -- Não publica títulos ou anotações pessoais no histórico compartilhado.
 else raise exception 'Origem inválida.';end if;
 return jsonb_build_object('ok',true,'id',p_id);
end;$$;
grant create on schema public to fs_department_executor;
alter function public.fs_get_deleted_tasks() owner to fs_department_executor;
alter function public.fs_restore_task(uuid,text,integer) owner to fs_department_executor;
revoke create on schema public from fs_department_executor;
revoke all on function public.fs_get_deleted_tasks(),public.fs_restore_task(uuid,text,integer) from public,anon;
grant execute on function public.fs_get_deleted_tasks(),public.fs_restore_task(uuid,text,integer) to authenticated;
commit;
