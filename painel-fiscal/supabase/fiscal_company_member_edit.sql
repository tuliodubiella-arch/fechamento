begin;
create or replace function public.fs_save_company(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb:=p_payload; r public.fs_companies; ident uuid:=coalesce(p_id,gen_random_uuid());
 company_name text:=trim(b->>'name'); company_cnpj text:=upper(regexp_replace(coalesce(b->>'cnpj',''),'[./\s-]','','g')); actor text;
begin
 if auth.uid() is null or not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 if b->>'action'='archive' and not public.fs_is_admin() then raise exception 'Somente o administrador pode arquivar empresas.';end if;
 if p_id is not null then
  select * into r from public.fs_companies where id=p_id and archived_at is null for update;
  if not found then raise exception 'Empresa não encontrada.';end if;
  if (b->>'version')::integer is distinct from r.version then raise exception 'Cadastro atualizado em outra janela. Reabra antes de salvar.';end if;
 end if;
 select name into actor from public.fs_members where id=auth.uid();
 if b->>'action'='archive' and p_id is not null then
  update public.fs_companies set archived_at=now(),updated_at=now(),version=version+1 where id=p_id;
  insert into public.fs_events("user",action,item) values(actor,'Arquivou empresa',r.name);return jsonb_build_object('id',p_id);
 end if;
 if coalesce(b->>'action','save')<>'save' then raise exception 'Operação inválida.';end if;
 if coalesce(length(company_name),0) not between 1 and 150 or not public.fs_valid_cnpj(company_cnpj)
  or coalesce(length(trim(b->>'city')),0) not between 1 and 100
  or coalesce(b->>'uf','') not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
  or coalesce(b->>'taxRegime','') not in ('Lucro Real','Lucro Presumido','Simples Nacional','Imune','Isenta','Outro')
  or length(coalesce(b->>'additionalInfo',''))>4000 then raise exception 'Revise nome, CNPJ, cidade, estado e regime tributário.';end if;
 if p_id is null then
  insert into public.fs_companies(id,name,cnpj,city,uf,tax_regime,additional_info) values(ident,company_name,company_cnpj,trim(b->>'city'),b->>'uf',b->>'taxRegime',trim(coalesce(b->>'additionalInfo','')));
 else
  update public.fs_companies set name=company_name,cnpj=company_cnpj,city=trim(b->>'city'),uf=b->>'uf',tax_regime=b->>'taxRegime',additional_info=trim(coalesce(b->>'additionalInfo','')),version=version+1,updated_at=now() where id=p_id;
 end if;
 insert into public.fs_events("user",action,item) values(actor,case when p_id is null then 'Cadastrou empresa' else 'Atualizou empresa' end,company_name);
 return jsonb_build_object('id',ident);
exception when unique_violation then raise exception 'Já existe uma empresa cadastrada com este CNPJ.';
end;$$;

revoke all on function public.fs_save_company(uuid,jsonb) from public,anon;
grant execute on function public.fs_save_company(uuid,jsonb) to authenticated;
commit;
