begin;
do $$
declare ident uuid:=gen_random_uuid(); existing_id uuid:=gen_random_uuid(); rejected boolean;
begin
 insert into auth.users(id,email,aud,role,invited_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values(ident,ident::text||'@example.test','authenticated','authenticated',now(),now(),now(),'{}','{}');
 insert into public.fs_members(id,name,email,role,active) values(ident,'Convite transacional',ident::text||'@example.test','member',true);
 perform set_config('request.jwt.claim.sub',ident::text,true);
 if not public.fs_requires_password_setup() then raise exception 'Convite sem etapa de senha.';end if;
 -- Simula apenas os campos que o Auth altera, sem senhas ou contas reais.
 update auth.users set encrypted_password='temporary-test-only',email_confirmed_at=now(),updated_at=now() where id=ident;
 if not public.fs_requires_password_setup() then raise exception 'Aceitar convite pulou a definição da senha.';end if;
 update auth.users set encrypted_password='chosen-test-only',updated_at=now() where id=ident;
 if public.fs_requires_password_setup() then raise exception 'Alteração de senha não concluiu o cadastro.';end if;
 if not exists(select 1 from public.fs_password_onboarding where user_id=ident and not required and password_set_at is not null) then raise exception 'Conclusão não registrada.';end if;
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values(existing_id,existing_id::text||'@example.test','authenticated','authenticated',now()-interval '1 day',now()-interval '2 days',now(),'{}','{}');
 insert into public.fs_members(id,name,email,role,active) values(existing_id,'Conta existente transacional',existing_id::text||'@example.test','member',true);
 perform set_config('request.jwt.claim.sub',existing_id::text,true);
 if public.fs_requires_password_setup() then raise exception 'Conta existente forçada a criar senha.';end if;
 if has_table_privilege('authenticated','public.fs_password_onboarding','UPDATE') or has_table_privilege('anon','public.fs_password_onboarding','SELECT')
 or has_function_privilege('anon','public.fs_requires_password_setup()','EXECUTE') then raise exception 'Permissões indevidas.';end if;
 perform set_config('request.jwt.claim.sub','',true);rejected:=false;
 begin perform public.fs_requires_password_setup();exception when others then rejected:=true;end;
 if not rejected then raise exception 'Acesso sem login.';end if;
end;$$;
select 'ok: convite, atualização da página, senha técnica, conclusão e isolamento' as result;
rollback;
