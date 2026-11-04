begin;
do $$
declare member_id uuid; gid uuid; ident uuid; g jsonb; stages jsonb; first_id text; rejected boolean; record_data jsonb;
begin
 select id into member_id from public.fs_members where active order by (role='member') desc limit 1;
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 if has_function_privilege('anon','public.fs_edit_group_stages(uuid,jsonb)','EXECUTE') then raise exception 'Acesso anônimo indevido.';end if;
 gid:=(public.fs_create_group(jsonb_build_object('title','Grupo transacional de etapas','owner',member_id,'stages',jsonb_build_array(jsonb_build_object('name','Preparar','status','Planejada'),jsonb_build_object('name','Concluído','status','Concluída'))))->>'id')::uuid;
 select data into g from public.fs_groups where id=gid;first_id:=g->'stages'->0->>'id';
 ident:=(public.fs_create_group_record(jsonb_build_object('type','routine','title','Registro transacional','owner',member_id,'groupId',gid,'start','2026-11-04','end','2026-11-10','frequency','Única'))->>'id')::uuid;
 stages:=jsonb_build_array((g->'stages'->0)||jsonb_build_object('name','Em preparação'),jsonb_build_object('name','REGISTRADO','status','Em andamento'),g->'stages'->1);
 perform public.fs_edit_group_stages(gid,jsonb_build_object('version',1,'stages',stages));
 select data into g from public.fs_groups where id=gid;select data into record_data from public.fs_items where id=ident;
 if jsonb_array_length(g->'stages')<>3 or record_data->>'stageId'<>first_id then raise exception 'Etapas ou vínculo perdidos.';end if;
 rejected:=false;begin perform public.fs_edit_group_stages(gid,jsonb_build_object('version',1,'stages',g->'stages'));exception when others then rejected:=true;end;if not rejected then raise exception 'Conflito ignorado.';end if;
 rejected:=false;begin perform public.fs_edit_group_stages(gid,jsonb_build_object('version',2,'stages',(g->'stages')-0));exception when others then rejected:=true;end;if not rejected then raise exception 'Etapa ocupada removida.';end if;
 stages:=jsonb_set(g->'stages','{0,status}','"Concluída"');rejected:=false;begin perform public.fs_edit_group_stages(gid,jsonb_build_object('version',2,'stages',stages));exception when others then rejected:=true;end;if not rejected then raise exception 'Registros concluídos em lote.';end if;
 stages:=jsonb_set(g->'stages','{0,status}','"Em andamento"');perform public.fs_edit_group_stages(gid,jsonb_build_object('version',2,'stages',stages));
 select data into record_data from public.fs_items where id=ident;if record_data->>'status'<>'Em andamento' or record_data->>'stageId'<>first_id then raise exception 'Status não sincronizado.';end if;
 stages:=jsonb_build_array(stages->1,stages->0,stages->2);perform public.fs_edit_group_stages(gid,jsonb_build_object('version',3,'stages',stages));
 if (select data->'stages'->0->>'name' from public.fs_groups where id=gid)<>'REGISTRADO' then raise exception 'Ordem perdida.';end if;
 perform set_config('request.jwt.claim.sub','',true);rejected:=false;begin perform public.fs_edit_group_stages(gid,jsonb_build_object('version',4,'stages',stages));exception when others then rejected:=true;end;if not rejected then raise exception 'Sem login editou etapas.';end if;
end;$$;
select 'ok: etapas, nomes, ordem, registros, status, concorrência e acesso' as result;
rollback;
