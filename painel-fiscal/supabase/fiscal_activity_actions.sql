-- Exclusão administrativa de uma atividade, preservando a entrega e a trilha de auditoria.
create function public.fs_delete_activity(p_id uuid,p_activity_id uuid,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fs_items; activity jsonb; remaining jsonb; actor text;
begin
 if not public.fs_is_admin() then raise exception 'Somente o administrador pode excluir atividades.';end if;
 select * into r from public.fs_items where id=p_id for update;
 if not found then raise exception 'Entrega não encontrada.';end if;
 if p_version is distinct from r.version then raise exception 'Outra pessoa atualizou este registro. Recarregue os dados e confira antes de repetir.';end if;
 select value into activity from jsonb_array_elements(r.data->'activities') where value->>'id'=p_activity_id::text;
 if activity is null then raise exception 'Atividade não encontrada.';end if;
 select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into remaining from jsonb_array_elements(r.data->'activities') with ordinality where value->>'id'<>p_activity_id::text;
 update public.fs_items set data=jsonb_set(r.data,'{activities}',remaining)||jsonb_build_object('updatedAt',now()),version=version+1 where id=p_id;
 select name into actor from public.fs_members where id=auth.uid();
 insert into public.fs_events("user",action,item) values(actor,'Excluiu a atividade “'||(activity->>'title')||'”'||case when (activity->>'done')::boolean then ' (concluída)' else '' end,r.data->>'title');
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.fs_delete_activity(uuid,uuid,integer) from public,anon;
grant execute on function public.fs_delete_activity(uuid,uuid,integer) to authenticated;
