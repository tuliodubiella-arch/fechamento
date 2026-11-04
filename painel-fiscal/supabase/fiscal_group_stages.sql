begin;
create function public.fs_edit_group_stages(p_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.fs_groups; stages jsonb:='[]'; s jsonb; old_stage jsonb; ident text; actor text; affected integer;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 perform id from public.fs_items where data->>'groupId'=p_id::text and deleted_at is null order by id for update;
 select * into g from public.fs_groups where id=p_id and deleted_at is null for update;
 if not found then raise exception 'Grupo não encontrado ou excluído.';end if;
 if (p_payload->>'version')::integer is distinct from g.version then raise exception 'Outra pessoa atualizou o grupo. Reabra a edição antes de salvar.';end if;
 if jsonb_typeof(p_payload->'stages') is distinct from 'array' then raise exception 'Informe as etapas.';end if;
 if jsonb_array_length(p_payload->'stages') not between 2 and 20 then raise exception 'Use de 2 a 20 etapas.';end if;
 for s in select value from jsonb_array_elements(p_payload->'stages') loop
  if coalesce(length(trim(s->>'name')),0) not between 1 and 60 or coalesce(s->>'status','') not in ('Planejada','Em andamento','Bloqueada','Concluída') then raise exception 'Revise o nome e o status de cada etapa.';end if;
  ident:=nullif(s->>'id','');old_stage:=null;
  if ident is not null then
   select value into old_stage from jsonb_array_elements(g.data->'stages') where value->>'id'=ident;
   if old_stage is null then raise exception 'Etapa não pertence ao grupo.';end if;
  else ident:=gen_random_uuid()::text;end if;
  if exists(select 1 from jsonb_array_elements(stages) e where e->>'id'=ident or lower(trim(e->>'name'))=lower(trim(s->>'name'))) then raise exception 'Use etapas e nomes diferentes.';end if;
  if s->>'status'='Concluída' and old_stage->>'status' is distinct from 'Concluída'
   and exists(select 1 from public.fs_items where deleted_at is null and data->>'groupId'=p_id::text and data->>'stageId'=ident) then
   raise exception 'Conclua os registros individualmente antes de transformar esta etapa em concluída.';
  end if;
  stages:=stages||jsonb_build_array(jsonb_build_object('id',ident,'name',trim(s->>'name'),'status',s->>'status'));
 end loop;
 if not exists(select 1 from jsonb_array_elements(stages) e where e->>'status'='Concluída')
 or not exists(select 1 from jsonb_array_elements(stages) e where e->>'status'<>'Concluída') then raise exception 'Mantenha uma etapa aberta e uma etapa concluída.';end if;
 if exists(select 1 from public.fs_items i where i.deleted_at is null and i.data->>'groupId'=p_id::text
  and not exists(select 1 from jsonb_array_elements(stages) e where e->>'id'=i.data->>'stageId')) then raise exception 'Mova os registros antes de remover uma etapa ocupada.';end if;
 update public.fs_groups set data=data||jsonb_build_object('stages',stages,'updatedAt',now()),version=version+1 where id=p_id;
 -- Ajustar uma etapa pendente não conclui registros em lote nem dispara recorrências.
 update public.fs_items i set data=i.data||jsonb_build_object('status',s.value->>'status','updatedAt',now()),version=i.version+1
 from jsonb_array_elements(stages) s(value)
 where i.deleted_at is null and i.data->>'groupId'=p_id::text and i.data->>'stageId'=s.value->>'id' and i.data->>'status' is distinct from s.value->>'status';
 get diagnostics affected=row_count;
 select name into actor from public.fs_members where id=auth.uid();
 insert into public.fs_events("user",action,item) values(actor,'Editou as etapas do grupo; atualizou o status de '||affected||' registros',g.data->>'title');
 return jsonb_build_object('ok',true,'updatedRecords',affected);
end;$$;
revoke all on function public.fs_edit_group_stages(uuid,jsonb) from public,anon;
grant execute on function public.fs_edit_group_stages(uuid,jsonb) to authenticated;
commit;
