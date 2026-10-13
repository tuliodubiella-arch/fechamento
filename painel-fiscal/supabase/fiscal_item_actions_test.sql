begin;
do $$
declare administrator uuid; member_id uuid; kind text; ident uuid; snapshot jsonb; record public.fs_items; failed boolean;
begin
 select id into administrator from public.fs_members where role='admin' and active limit 1;
 select id into member_id from public.fs_members where role='member' and active limit 1;
 if member_id is null then select id into member_id from auth.users where id not in(select id from public.fs_members) limit 1;insert into public.fs_members(id,name,email) select id,'Teste transacional',email from auth.users where id=member_id;end if;
 if administrator is null or member_id is null then raise exception 'Contas de teste não encontradas.';end if;
 foreach kind in array array['routine','project'] loop
 perform set_config('request.jwt.claim.sub',administrator::text,true);
 ident:=(public.fs_create_item(jsonb_build_object('type',kind,'title','Exclusão de teste '||kind,'owner',administrator,'start','2026-10-13','end','2026-10-20'))->>'id')::uuid;
 perform public.fs_apply_item(ident,'{"version":1,"action":"comment","text":"Preservar comentário"}');
 select data into snapshot from public.fs_items where id=ident;
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 failed:=false;begin perform public.fs_delete_item(ident,2);exception when others then failed:=true;end;if not failed then raise exception 'Membro conseguiu excluir.';end if;
 perform set_config('request.jwt.claim.sub',administrator::text,true);
 failed:=false;begin perform public.fs_delete_item(ident,1);exception when others then failed:=true;end;if not failed then raise exception 'Conflito ignorado.';end if;
 perform public.fs_delete_item(ident,2);select * into record from public.fs_items where id=ident;
 if record.deleted_at is null or record.deleted_by<>administrator or record.data<>snapshot or record.version<>3 then raise exception 'Exclusão não preservou a entrega.';end if;
 if exists(select 1 from jsonb_array_elements(public.fs_get_state()->'items') i where i->>'id'=ident::text) then raise exception 'Entrega excluída continua nos quadros.';end if;
 if not exists(select 1 from public.fs_events e where e.item='Exclusão de teste '||kind and e.action=case when kind='project' then 'Excluiu o projeto' else 'Excluiu a rotina' end) then raise exception 'Auditoria ausente.';end if;
 failed:=false;begin perform public.fs_apply_item(ident,'{"version":3,"action":"activity","title":"Edição tardia"}');exception when others then failed:=true;end;if not failed then raise exception 'Entrega excluída foi editada.';end if;
 failed:=false;begin perform public.fs_prepare_attachment(ident,'print.png','image/png',100);exception when others then failed:=true;end;if not failed then raise exception 'Anexo tardio aceito.';end if;
 failed:=false;begin perform public.fs_delete_item(ident,3);exception when others then failed:=true;end;if not failed then raise exception 'Exclusão repetida aceita.';end if;
 end loop;
end; $$;
rollback;
