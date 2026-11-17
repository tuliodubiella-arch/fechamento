begin;
create temporary table report_test_ids(kind text primary key,id uuid) on commit drop;
do $$ declare actor uuid; dep uuid; g uuid; item uuid; hidden_group uuid; b uuid:=gen_random_uuid(); bdep uuid; payload jsonb; stage_id text; result jsonb; ver integer;
begin
 select m.id,m.department_id into actor,dep from public.fs_members m join public.fs_departments d on d.id=m.department_id where d.name='Fiscal' and m.role='admin' and m.active limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 payload:=jsonb_build_object('title','Grupo relatório teste','owner',actor,'printEnabled',true,'stages',jsonb_build_array(jsonb_build_object('name','Preparação','status','Planejada'),jsonb_build_object('name','Finalizado','status','Concluída')));
 g:=(public.fs_create_group(payload)->>'id')::uuid;
 hidden_group:=(public.fs_create_group(payload||jsonb_build_object('title','Grupo sem relatório','printEnabled',false))->>'id')::uuid;
 if not (select (data->>'printEnabled')::boolean from public.fs_groups where id=g) then raise exception 'Preferência do grupo não foi salva.';end if;
 payload:=jsonb_build_object('type','routine','title','Rotina com histórico completo','owner',actor,'groupId',g,'start','2026-11-16','end','2026-11-20','frequency','Única','priority','Alta');
 item:=(public.fs_create_group_record(payload)->>'id')::uuid;
 perform public.fs_apply_item(item,jsonb_build_object('action','activity','title','Etapa de atividade original','version',2));
 perform public.fs_apply_item(item,jsonb_build_object('action','toggle','id',(select data->'activities'->0->>'id' from public.fs_items where id=item),'version',3));
 perform public.fs_apply_item(item,jsonb_build_object('action','comment','text','Comentário integral com acentuação','version',4));
 perform public.fs_apply_item(item,jsonb_build_object('action','execution','text','Execução integral preservada','version',5));
 perform public.fs_edit_group_item(item,payload||jsonb_build_object('action','record-edit','title','Rotina renomeada sem perder histórico','version',6));
 select data->'stages'->1->>'id' into stage_id from public.fs_groups where id=g;
 perform public.fs_update_record(item,jsonb_build_object('action','record-stage','stageId',stage_id,'version',7));
 select jsonb_set(data->'stages','{1,name}','"Concluído e revisado"'),version into payload,ver from public.fs_groups where id=g;
 perform public.fs_edit_group_stages(g,jsonb_build_object('stages',payload,'version',ver));
 if not exists(select 1 from public.fs_record_history where item_id=item and kind='group_configuration') then raise exception 'Alteração do nome da etapa não foi registrada.';end if;
 if not exists(select 1 from public.fs_record_history where item_id=item and changes::text like '%Etapa de atividade original%' and changes::text like '%false%' and changes::text like '%true%') then raise exception 'Antes e depois da atividade não foram preservados.';end if;
 if not exists(select 1 from public.fs_record_history where item_id=item and snapshot->'data'->>'title'='Rotina com histórico completo') then raise exception 'Título anterior foi perdido.';end if;
 insert into report_test_ids values('actor',actor),('item',item),('group',g),('hidden_group',hidden_group);
 insert into auth.users(id,email,aud,role) values(b,b||'@report-test.invalid','authenticated','authenticated');
 insert into public.fs_departments(name,administrator_id) values('Departamento isolado relatório teste',b) returning id into bdep;
 insert into public.fs_members(id,name,email,role,department_id) values(b,'Outro administrador',b||'@report-test.invalid','admin',bdep);
 insert into report_test_ids values('outsider',b);
 if has_table_privilege('authenticated','public.fs_record_history','UPDATE') or has_table_privilege('authenticated','public.fs_record_history','DELETE') then raise exception 'Histórico permite alteração pelo navegador.';end if;
end;$$;
grant select on report_test_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from report_test_ids where kind='actor'),true);
do $$ declare r jsonb;begin
 r:=public.fs_get_record_report((select id from report_test_ids where kind='item'));
 if jsonb_array_length(r->'history')<8 or r->'item'->>'title'<>'Rotina renomeada sem perder histórico' or r->>'stage'<>'Concluído e revisado' then raise exception 'Relatório não reuniu o histórico correto.';end if;
 if (r->'history')::text like '%"kind": "baseline"%' then raise exception 'Nova rotina recebeu histórico retroativo fictício.';end if;
end;$$;
select set_config('request.jwt.claim.sub',(select id::text from report_test_ids where kind='outsider'),true);
do $$ begin
 if exists(select 1 from public.fs_record_history where item_id=(select id from report_test_ids where kind='item')) then raise exception 'Histórico vazou para outro departamento.';end if;
 begin perform public.fs_get_record_report((select id from report_test_ids where kind='item'));raise exception 'FALHA: relatório cruzado autorizado.';exception when others then if sqlerrm like 'FALHA:%' then raise;end if;end;
end;$$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from report_test_ids where kind='actor'),true);
do $$ declare g public.fs_groups; i uuid; payload jsonb;begin
 select * into g from public.fs_groups where id=(select id from report_test_ids where kind='group');
 perform public.fs_update_group(g.id,g.data||jsonb_build_object('action','update-group','version',g.version,'printEnabled',false));
end;$$;
set local role authenticated;
do $$ begin
 begin perform public.fs_get_record_report((select id from report_test_ids where kind='item'));raise exception 'FALHA: grupo desabilitado exportou relatório.';exception when others then if sqlerrm like 'FALHA:%' then raise;end if;end;
end;$$;
reset role;
select 'ok: preferência, histórico append-only, etapas, renomeação, conteúdo e isolamento departamental' result;
rollback;
