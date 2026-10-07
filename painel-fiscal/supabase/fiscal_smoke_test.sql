-- Teste transacional: todas as alterações abaixo são revertidas.
begin;
do $$
declare admin_id uuid; member_id uuid; outsider_id uuid; ident uuid; state jsonb; created jsonb; row_data public.fs_items; delegation_id text; meta jsonb; failed boolean;
begin
 select id into admin_id from public.fs_members where role='admin' and active limit 1;
 select id into member_id from auth.users where id not in(select id from public.fs_members) limit 1;
 if admin_id is null or member_id is null then raise exception 'É necessário um administrador e uma conta adicional para este teste.';end if;
 insert into public.fs_members(id,name,email) select id,'Teste fiscal transacional',email from auth.users where id=member_id;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 state:=public.fs_get_state();if state->'user'->>'id'<>admin_id::text then raise exception 'Falha na identificação do usuário.';end if;
 for ident in select gen_random_uuid() loop
 created:=public.fs_create_item(jsonb_build_object('title','Teste fiscal transacional','type','project','owner',admin_id,'start','2026-10-07','end','2026-10-20'));ident:=(created->>'id')::uuid;
 perform public.fs_apply_item(ident,jsonb_build_object('version',1,'action','activity','title','Conferir'));
 perform public.fs_apply_item(ident,jsonb_build_object('version',2,'action','toggle','id',(select data->'activities'->0->>'id' from public.fs_items where id=ident)));
 perform public.fs_apply_item(ident,jsonb_build_object('version',3,'action','delegate','title','Validar','assignee',member_id,'due','2026-10-10'));
 select * into row_data from public.fs_items where id=ident;delegation_id:=row_data.data->'delegations'->0->>'id';
 failed:=false;begin perform public.fs_apply_item(ident,jsonb_build_object('version',1,'action','comment','text','Conflito'));exception when others then failed:=true;end;if not failed then raise exception 'Conflito não detectado.';end if;
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 failed:=false;begin perform public.fs_apply_item(ident,jsonb_build_object('version',4,'action','delegate','title','Não permitido','assignee',admin_id,'due','2026-10-10'));exception when others then failed:=true;end;if not failed then raise exception 'Membro conseguiu delegar sem permissão.';end if;
 meta:=public.fs_prepare_attachment(ident,'print.png','image/png',100);
 insert into storage.objects(bucket_id,name,metadata) values('fiscal-prints',meta->>'path','{"size":100,"mimetype":"image/png"}');
 perform public.fs_apply_item(ident,jsonb_build_object('version',4,'action','comment','text','Comentário com print','attachments',jsonb_build_array(meta->>'id')));
 perform public.fs_apply_item(ident,jsonb_build_object('version',5,'action','complete-delegation','id',delegation_id,'result','Validado'));
 select * into row_data from public.fs_items where id=ident;
 if row_data.data->>'owner'<>admin_id::text or not (row_data.data->'delegations'->0->>'done')::boolean or jsonb_array_length(row_data.data->'executions')<>1 then raise exception 'Conclusão ou proprietário incorretos.';end if;
 if not (select committed from public.fs_attachments where id=(meta->>'id')::uuid) then raise exception 'Anexo não vinculado.';end if;
 perform public.fs_apply_item(ident,jsonb_build_object('version',6,'action','reopen-delegation','id',delegation_id));
 select * into row_data from public.fs_items where id=ident;if (row_data.data->'delegations'->0->>'done')::boolean or jsonb_array_length(row_data.data->'executions')<>1 then raise exception 'Reabertura perdeu o histórico.';end if;
 end loop;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 failed:=false;begin perform public.fs_get_state();exception when others then failed:=true;end;if not failed then raise exception 'Conta sem vínculo leu os dados.';end if;
end; $$;
rollback;
