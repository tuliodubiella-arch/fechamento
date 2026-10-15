begin;
-- Disposable identities and rows are rolled back, without touching production accounts.
insert into auth.users(id,email) values('d67e92fb-cf8b-421b-9290-b7f427b1be01','personal-owner@example.test'),('d67e92fb-cf8b-421b-9290-b7f427b1be02','personal-admin@example.test');
insert into public.fs_members(id,name,email,role) values('d67e92fb-cf8b-421b-9290-b7f427b1be01','Teste pessoal','personal-owner@example.test','member'),('d67e92fb-cf8b-421b-9290-b7f427b1be02','Admin teste pessoal','personal-admin@example.test','admin');
set local role authenticated;
select set_config('request.jwt.claim.sub','d67e92fb-cf8b-421b-9290-b7f427b1be01',true);
do $$
declare ident uuid; shared uuid; b jsonb; failed boolean;
begin
 b:='{"title":"Teste privado transacional","description":"Descrição pública escolhida","notes":"SEGREDO PESSOAL","start":"2026-10-15","end":"2026-10-16","status":"Planejada","priority":"Alta","activities":[{"title":"Revisar","done":true}],"owner":"d67e92fb-cf8b-421b-9290-b7f427b1be02"}';
 ident:=(public.fs_save_personal(null,b)->>'id')::uuid;
 perform set_config('test.personal_id',ident::text,true);
 if (public.fs_get_personal()->0->>'owner')<>'d67e92fb-cf8b-421b-9290-b7f427b1be01' then raise exception 'Dono incorreto.';end if;
 if exists(select 1 from jsonb_array_elements(public.fs_get_state()->'items') x where x->>'title'=b->>'title') then raise exception 'Atividade vazou para equipe.';end if;
 if exists(select 1 from public.fs_events where item=b->>'title') then raise exception 'Histórico privado vazou.';end if;
 perform set_config('request.jwt.claim.sub','d67e92fb-cf8b-421b-9290-b7f427b1be02',true);
 if public.fs_get_personal()<>'[]'::jsonb or exists(select 1 from public.fs_personal_items where id=ident) then raise exception 'Administrador leu atividade privada.';end if;
 foreach b in array array['{"action":"save","version":1}'::jsonb,'{"action":"share","version":1}'::jsonb,'{"action":"delete","version":1}'::jsonb] loop
  failed:=false;begin perform public.fs_save_personal(ident,b);exception when others then failed:=true;end;if not failed then raise exception 'Administrador alterou atividade alheia.';end if;
 end loop;
 failed:=false;begin update public.fs_personal_items set owner_id=auth.uid() where id=ident;exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'DML direto permitido.';end if;
 perform set_config('request.jwt.claim.sub','d67e92fb-cf8b-421b-9290-b7f427b1be01',true);
 failed:=false;begin perform public.fs_save_personal(ident,'{"action":"share","version":0}');exception when others then failed:=true;end;if not failed then raise exception 'Conflito ignorado.';end if;
 shared:=(public.fs_save_personal(ident,'{"action":"share","version":1}')->>'id')::uuid;
 if (select data->>'notes' from public.fs_items where id=shared) is not null or (select data::text from public.fs_items where id=shared) like '%SEGREDO%' then raise exception 'Notas privadas copiadas.';end if;
 if (public.fs_save_personal(ident,'{"action":"share","version":2}')->>'id')::uuid<>shared then raise exception 'Cópia duplicada.';end if;
 perform public.fs_save_personal(ident,'{"action":"delete","version":2}');
 if public.fs_get_personal()<>'[]'::jsonb then raise exception 'Exclusão falhou.';end if;
 if not exists(select 1 from public.fs_items where id=shared and deleted_at is null) then raise exception 'Exclusão privada afetou equipe.';end if;
end;$$;
reset role;
do $$ begin
 if has_table_privilege('anon','public.fs_personal_items','SELECT') or has_function_privilege('anon','public.fs_save_personal(uuid,jsonb)','EXECUTE') then raise exception 'Acesso anônimo permitido.';end if;
 if not (select relrowsecurity from pg_class where oid='public.fs_personal_items'::regclass) then raise exception 'RLS desabilitado.';end if;
end;$$;
rollback;
