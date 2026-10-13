begin;
do $$
declare administrator uuid; member_id uuid; created jsonb; ident uuid; item public.fs_items; first_id uuid; last_id uuid; failed boolean;
begin
 select id into administrator from public.fs_members where role='admin' and active limit 1;
 select id into member_id from public.fs_members where role='member' and active limit 1;
 if member_id is null then
 select id into member_id from auth.users where id not in(select id from public.fs_members) limit 1;
 insert into public.fs_members(id,name,email) select id,'Teste transacional',email from auth.users where id=member_id;
 end if;
 if administrator is null or member_id is null then raise exception 'Contas necessárias para teste não encontradas.';end if;
 perform set_config('request.jwt.claim.sub',administrator::text,true);
 created:=public.fs_create_item(jsonb_build_object('title','Teste de exclusão administrativa','type','routine','owner',administrator,'start','2026-10-13','end','2026-10-20'));ident:=(created->>'id')::uuid;
 perform public.fs_apply_item(ident,'{"version":1,"action":"activity","title":"Primeira atividade"}');
 perform public.fs_apply_item(ident,'{"version":2,"action":"activity","title":"Última atividade"}');
 select * into item from public.fs_items where id=ident;first_id:=(item.data->'activities'->0->>'id')::uuid;last_id:=(item.data->'activities'->1->>'id')::uuid;
 perform public.fs_apply_item(ident,jsonb_build_object('version',3,'action','toggle','id',first_id));
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 failed:=false;begin perform public.fs_delete_activity(ident,first_id,4);exception when others then failed:=true;end;if not failed then raise exception 'Membro conseguiu excluir.';end if;
 perform set_config('request.jwt.claim.sub',administrator::text,true);
 failed:=false;begin perform public.fs_delete_activity(ident,first_id,3);exception when others then failed:=true;end;if not failed then raise exception 'Conflito não detectado.';end if;
 failed:=false;begin perform public.fs_delete_activity(ident,gen_random_uuid(),4);exception when others then failed:=true;end;if not failed then raise exception 'ID inválido aceito.';end if;
 perform public.fs_delete_activity(ident,first_id,4);
 select * into item from public.fs_items where id=ident;
 if jsonb_array_length(item.data->'activities')<>1 or item.data->'activities'->0->>'id'<>last_id::text or item.version<>5 then raise exception 'Exclusão incorreta.';end if;
 if not exists(select 1 from public.fs_events e where e.action='Excluiu a atividade “Primeira atividade” (concluída)' and e.item='Teste de exclusão administrativa') then raise exception 'Auditoria ausente.';end if;
 perform public.fs_delete_activity(ident,last_id,5);
 select * into item from public.fs_items where id=ident;if item.data->'activities'<>'[]'::jsonb then raise exception 'Última atividade não excluída.';end if;
end; $$;
rollback;
