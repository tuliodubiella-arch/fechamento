begin;
-- All active fiscal members may edit shared group metadata. Deletion remains admin only.
create or replace function public.fs_update_group(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.fs_groups; actor text; total integer; ids jsonb;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 if p_payload->>'action'='delete-group' then
 if not public.fs_is_admin() then raise exception 'Somente o administrador pode excluir grupos.';end if;
 perform id from public.fs_items where data->>'groupId'=p_id::text and deleted_at is null order by id for update;
 end if;
 select * into g from public.fs_groups where id=p_id and deleted_at is null for update;
 if not found then raise exception 'Grupo não encontrado ou excluído.';end if;
 if (p_payload->>'version')::integer is distinct from g.version then raise exception 'Outra pessoa atualizou o grupo. Atualize e tente novamente.';end if;
 select name into actor from public.fs_members where id=auth.uid();
 if p_payload->>'action'='delete-group' then
 update public.fs_groups set deleted_at=now(),deleted_by=auth.uid(),version=version+1 where id=p_id;
 update public.fs_items set deleted_at=now(),deleted_by=auth.uid(),version=version+1 where data->>'groupId'=p_id::text and deleted_at is null;get diagnostics total=row_count;
 insert into public.fs_events("user",action,item) values(actor,'Excluiu grupo e '||total||' registros',g.data->>'title');
 elsif p_payload->>'action'='update-group' then
 if coalesce(length(trim(p_payload->>'title')),0)=0 or length(p_payload->>'title')>150 or not exists(select 1 from public.fs_members where id=(p_payload->>'owner')::uuid and active) then raise exception 'Revise nome e responsável.';end if;
 update public.fs_groups set data=data||jsonb_build_object('title',trim(p_payload->>'title'),'description',left(coalesce(p_payload->>'description',''),2000),'owner',p_payload->>'owner','updatedAt',now()),version=version+1 where id=p_id;
 insert into public.fs_events("user",action,item) values(actor,'Atualizou grupo',trim(p_payload->>'title'));
 elsif p_payload->>'action'='reorder-records' then
 ids:=p_payload->'ids';
 if jsonb_typeof(ids) is distinct from 'array' then raise exception 'Informe a ordem dos registros.';end if;
 if jsonb_array_length(ids)<>(select count(distinct value) from jsonb_array_elements_text(ids))
 or jsonb_array_length(ids)<>(select count(*) from public.fs_items where deleted_at is null and data->>'groupId'=p_id::text)
 or exists(select 1 from jsonb_array_elements_text(ids) x where not exists(select 1 from public.fs_items i where i.id::text=x.value and i.deleted_at is null and i.data->>'groupId'=p_id::text)) then raise exception 'A lista do grupo mudou. Atualize e tente novamente.';end if;
 update public.fs_groups set data=data||jsonb_build_object('recordOrder',ids,'updatedAt',now()),version=version+1 where id=p_id;
 insert into public.fs_events("user",action,item) values(actor,'Reorganizou registros do grupo',g.data->>'title');
 else raise exception 'Operação inválida.';end if;
 return jsonb_build_object('ok',true);
end; $$;

create or replace function public.fs_edit_group_item(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fs_items; d jsonb; ids jsonb; actor text; label text;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 select * into r from public.fs_items where id=p_id and deleted_at is null for update;
 if not found then raise exception 'Registro não encontrado.';end if;
 if (p_payload->>'version')::integer is distinct from r.version then raise exception 'Outra pessoa atualizou este registro. Reabra o registro e tente novamente.';end if;
 d:=r.data;
 if coalesce(d->>'groupId','')='' then raise exception 'Este registro não pertence a um grupo.';end if;
 perform id from public.fs_groups where id=(d->>'groupId')::uuid and deleted_at is null for share;
 if not found then raise exception 'Grupo não encontrado ou excluído.';end if;
 if p_payload->>'action'='record-edit' then
 if coalesce(d->>'groupId','')='' then raise exception 'Este registro não pertence a um grupo.';end if;
 if coalesce(length(trim(p_payload->>'title')),0)=0 or length(p_payload->>'title')>150 or length(coalesce(p_payload->>'description',''))>2000
 or not exists(select 1 from public.fs_members where id=(p_payload->>'owner')::uuid and active)
 or coalesce(p_payload->>'priority','') not in ('Baixa','Média','Alta') or coalesce(p_payload->>'frequency','') not in ('Diária','Semanal','Mensal','Única')
 or coalesce(p_payload->>'start','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(p_payload->>'end','')!~'^\d{4}-\d{2}-\d{2}$'
 then raise exception 'Revise os campos do registro.';end if;
 if (p_payload->>'end')::date<(p_payload->>'start')::date then raise exception 'A conclusão deve ser igual ou posterior ao início.';end if;
 d:=d||jsonb_build_object('title',trim(p_payload->>'title'),'description',coalesce(p_payload->>'description',''),'owner',p_payload->>'owner','priority',p_payload->>'priority','frequency',p_payload->>'frequency','start',p_payload->>'start','end',p_payload->>'end');label:='Editou dados do registro';
 elsif p_payload->>'action'='edit-activity' then
 if coalesce(length(trim(p_payload->>'title')),0)=0 or length(p_payload->>'title')>200 or not exists(select 1 from jsonb_array_elements(d->'activities') a where a->>'id'=p_payload->>'id') then raise exception 'Revise a atividade e seu título.';end if;
 d:=jsonb_set(d,'{activities}',(select jsonb_agg(case when a->>'id'=p_payload->>'id' then a||jsonb_build_object('title',trim(p_payload->>'title')) else a end order by n) from jsonb_array_elements(d->'activities') with ordinality t(a,n)));label:='Editou atividade';
 elsif p_payload->>'action'='reorder-activities' then
 ids:=p_payload->'ids';
 if jsonb_typeof(ids) is distinct from 'array' then raise exception 'Informe a ordem das atividades.';end if;
 if jsonb_array_length(ids)<>jsonb_array_length(d->'activities') or jsonb_array_length(ids)<>(select count(distinct value) from jsonb_array_elements_text(ids))
 or exists(select 1 from jsonb_array_elements_text(ids) x where not exists(select 1 from jsonb_array_elements(d->'activities') a where a->>'id'=x.value)) then raise exception 'A lista de atividades mudou. Reabra o registro e tente novamente.';end if;
 d:=jsonb_set(d,'{activities}',coalesce((select jsonb_agg(a order by x.n) from jsonb_array_elements_text(ids) with ordinality x(id,n) join jsonb_array_elements(d->'activities') a on a->>'id'=x.id),'[]'::jsonb));label:='Reorganizou atividades';
 else raise exception 'Operação inválida.';end if;
 update public.fs_items set data=d||jsonb_build_object('updatedAt',now()),version=version+1 where id=p_id;
 select name into actor from public.fs_members where id=auth.uid();insert into public.fs_events("user",action,item) values(actor,label,d->>'title');
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.fs_update_group(uuid,jsonb),public.fs_edit_group_item(uuid,jsonb) from public,anon;
grant execute on function public.fs_update_group(uuid,jsonb),public.fs_edit_group_item(uuid,jsonb) to authenticated;
commit;
