begin;
create temporary table trash_test_ids(kind text primary key,id uuid,data jsonb) on commit drop;
do $$ declare actor uuid; dep uuid; peer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); otherdep uuid; item uuid:=gen_random_uuid(); private uuid:=gen_random_uuid(); otherprivate uuid:=gen_random_uuid(); grouped uuid:=gen_random_uuid(); g uuid; payload jsonb;
begin
 select m.id,m.department_id into actor,dep from public.fs_members m join public.fs_departments d on d.id=m.department_id where d.name='Fiscal' and m.role='admin' and m.active limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into auth.users(id,email,aud,role) values(peer,peer||'@trash-test.invalid','authenticated','authenticated'),(outsider,outsider||'@trash-test.invalid','authenticated','authenticated');
 insert into public.fs_departments(name,administrator_id) values('Isolamento lixeira teste',outsider) returning id into otherdep;
 insert into public.fs_members(id,name,email,role,department_id) values(peer,'Integrante lixeira teste',peer||'@trash-test.invalid','member',dep),(outsider,'Outro administrador teste',outsider||'@trash-test.invalid','admin',otherdep);
 payload:=jsonb_build_object('title','Teste de recuperação integral','type','routine','owner',actor,'status','Concluída','frequency','Mensal','start','2026-11-01','end','2026-11-20','createdAt',now(),'activities',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','Preservar atividade','done',true)),'comments',jsonb_build_array(jsonb_build_object('text','Texto intacto','attachments',jsonb_build_array(jsonb_build_object('name','Comprovante.pdf','path','teste/arquivo.pdf')))),'executions','[]'::jsonb,'delegations','[]'::jsonb,'recurrenceNextId',gen_random_uuid());
 insert into public.fs_items(id,data,deleted_at,deleted_by,department_id,version) values(item,payload,now(),actor,dep,8);
 insert into public.fs_personal_items(id,owner_id,data,deleted_at,department_id,version) values(private,actor,jsonb_build_object('title','Privada minha','notes','SEGREDO MANTIDO','activities','[]'::jsonb),now(),dep,2),(otherprivate,peer,jsonb_build_object('title','Privada de outro','notes','NÃO PODE VAZAR','activities','[]'::jsonb),now(),dep,2);
 g:=(public.fs_create_group(jsonb_build_object('title','Grupo excluído teste','owner',actor,'stages',jsonb_build_array(jsonb_build_object('name','Aberto','status','Planejada'),jsonb_build_object('name','Fechado','status','Concluída'))))->>'id')::uuid;
 insert into public.fs_items(id,data,deleted_at,deleted_by,department_id) values(grouped,payload||jsonb_build_object('groupId',g,'stageId',(select data->'stages'->0->>'id' from public.fs_groups where id=g),'status','Planejada'),now(),actor,dep);
 update public.fs_groups set deleted_at=now() where id=g;
 insert into trash_test_ids values('actor',actor,null),('peer',peer,null),('outsider',outsider,null),('item',item,payload),('private',private,null),('otherprivate',otherprivate,null),('grouped',grouped,null);
end;$$;
grant select on trash_test_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from trash_test_ids where kind='peer'),true);
do $$ declare rows jsonb;begin
 rows:=public.fs_get_deleted_tasks();
 if exists(select 1 from jsonb_array_elements(rows) v where v->>'source'='shared' or v->>'id'=(select id::text from trash_test_ids where kind='private')) then raise exception 'Lixeira vazou dados para integrante.';end if;
 begin perform public.fs_restore_task((select id from trash_test_ids where kind='item'),'shared',8);raise exception 'FALHA: integrante restaurou tarefa de equipe';exception when others then if sqlerrm like 'FALHA:%' then raise;end if;end;
 begin perform public.fs_restore_task((select id from trash_test_ids where kind='private'),'personal',2);raise exception 'FALHA: integrante restaurou dados de outro';exception when others then if sqlerrm like 'FALHA:%' then raise;end if;end;
end;$$;
select set_config('request.jwt.claim.sub',(select id::text from trash_test_ids where kind='outsider'),true);
do $$ begin
 if jsonb_array_length(public.fs_get_deleted_tasks())<>0 then raise exception 'Lixeira vazou entre departamentos.';end if;
 begin perform public.fs_restore_task((select id from trash_test_ids where kind='item'),'shared',8);raise exception 'FALHA: restauração entre departamentos';exception when others then if sqlerrm like 'FALHA:%' then raise;end if;end;
end;$$;
select set_config('request.jwt.claim.sub',(select id::text from trash_test_ids where kind='actor'),true);
do $$ declare rows jsonb;begin
 rows:=public.fs_get_deleted_tasks();
 if not exists(select 1 from jsonb_array_elements(rows) v where v->>'id'=(select id::text from trash_test_ids where kind='item')) then raise exception 'Administrador não encontrou tarefa.';end if;
 if rows::text like '%NÃO PODE VAZAR%' or rows::text like '%Privada de outro%' then raise exception 'Administrador viu dado privado de colega.';end if;
 begin perform public.fs_restore_task((select id from trash_test_ids where kind='item'),'shared',7);raise exception 'FALHA: versão antiga aceita';exception when others then if sqlerrm like 'FALHA:%' then raise;end if;end;
 begin perform public.fs_restore_task((select id from trash_test_ids where kind='grouped'),'shared',1);raise exception 'FALHA: grupo excluído aceito';exception when others then if sqlerrm like 'FALHA:%' then raise;end if;end;
 perform public.fs_restore_task((select id from trash_test_ids where kind='item'),'shared',8);
 perform public.fs_restore_task((select id from trash_test_ids where kind='private'),'personal',2);
 begin perform public.fs_restore_task((select id from trash_test_ids where kind='item'),'shared',9);raise exception 'FALHA: restauração duplicada';exception when others then if sqlerrm like 'FALHA:%' then raise;end if;end;
end;$$;
reset role;
do $$ begin
 if not exists(select 1 from public.fs_items where id=(select id from trash_test_ids where kind='item') and deleted_at is null and deleted_by is null and version=9 and data=(select data from trash_test_ids where kind='item')) then raise exception 'Conteúdo ou vínculos de recorrência mudaram.';end if;
 if not exists(select 1 from public.fs_personal_items where id=(select id from trash_test_ids where kind='private') and deleted_at is null and version=3 and data->>'notes'='SEGREDO MANTIDO') then raise exception 'Notas privadas não preservadas.';end if;
 if (select count(*) from public.fs_items where data->>'title'='Teste de recuperação integral')<>2 then raise exception 'Restauração criou ocorrência extra.';end if;
 if not exists(select 1 from public.fs_events where item='Teste de recuperação integral' and action='Restaurou a rotina') then raise exception 'Restauração não registrada.';end if;
 if has_function_privilege('anon','public.fs_restore_task(uuid,text,integer)','EXECUTE') or has_function_privilege('anon','public.fs_get_deleted_tasks()','EXECUTE') then raise exception 'Função aberta ao público.';end if;
end;$$;
select 'ok: restauração integral, recorrência preservada, controle de versão, privacidade e isolamento departamental' result;
rollback;
