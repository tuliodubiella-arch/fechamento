begin;
create table public.fs_companies(
 id uuid primary key default gen_random_uuid(), name text not null, cnpj text not null,
 city text not null, uf text not null, tax_regime text not null, additional_info text not null default '',
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 archived_at timestamptz
);
create unique index fs_companies_active_cnpj on public.fs_companies(cnpj) where archived_at is null;
create table public.fs_suggestions(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.fs_members(id),
 data jsonb not null, version integer not null default 1, archived_at timestamptz
);
create index fs_suggestions_owner on public.fs_suggestions(owner_id);
alter table public.fs_companies enable row level security;
alter table public.fs_suggestions enable row level security;
revoke all on public.fs_companies,public.fs_suggestions from public,anon,authenticated;
grant select on public.fs_companies,public.fs_suggestions to authenticated;
grant all on public.fs_companies,public.fs_suggestions to service_role;
create policy fs_companies_read on public.fs_companies for select to authenticated using((select public.fs_is_member()) and archived_at is null);
create policy fs_suggestions_read on public.fs_suggestions for select to authenticated using((select public.fs_is_member()) and archived_at is null);

-- Pure internal helper. Official DV calculation: ASCII minus 48 and modulo 11.
create function public.fs_valid_cnpj(p_cnpj text) returns boolean language plpgsql immutable set search_path='' as $$
declare c text:=upper(regexp_replace(coalesce(p_cnpj,''),'[./\s-]','','g')); n integer; part integer; weight integer; total integer; digit integer;
begin
 if c !~ '^[A-Z0-9]{12}[0-9]{2}$' or c ~ '^([0-9])\1{13}$' then return false;end if;
 for part in 12..13 loop
  weight:=2;total:=0;
  for n in reverse part..1 loop
   total:=total+(ascii(substr(c,n,1))-48)*weight;weight:=case when weight=9 then 2 else weight+1 end;
  end loop;
  digit:=case when total%11<2 then 0 else 11-total%11 end;
  if substr(c,part+1,1)<>digit::text then return false;end if;
 end loop;
 return true;
end;$$;

create function public.fs_get_registries() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 return jsonb_build_object(
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'cnpj',cnpj,'city',city,'uf',uf,'taxRegime',tax_regime,'additionalInfo',additional_info,'version',version,'createdAt',created_at,'updatedAt',updated_at) order by name) from public.fs_companies where archived_at is null),'[]'::jsonb),
 'suggestions',coalesce((select jsonb_agg(data||jsonb_build_object('id',id,'owner',owner_id,'version',version) order by data->>'createdAt' desc) from public.fs_suggestions where archived_at is null),'[]'::jsonb));
end;$$;

create function public.fs_save_company(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb:=p_payload; r public.fs_companies; ident uuid:=coalesce(p_id,gen_random_uuid());
 company_name text:=trim(b->>'name'); company_cnpj text:=upper(regexp_replace(coalesce(b->>'cnpj',''),'[./\s-]','','g')); actor text;
begin
 if auth.uid() is null or not public.fs_is_admin() then raise exception 'Somente o administrador pode alterar empresas.';end if;
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

create function public.fs_save_suggestion(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb:=p_payload; act text:=coalesce(p_payload->>'action','save'); r public.fs_suggestions; ident uuid:=coalesce(p_id,gen_random_uuid()); d jsonb; actor text; label text;
begin
 if auth.uid() is null or not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 if p_id is not null then
  select * into r from public.fs_suggestions where id=p_id and archived_at is null for update;
  if not found then raise exception 'Sugestão não encontrada.';end if;
  if (b->>'version')::integer is distinct from r.version then raise exception 'Sugestão atualizada em outra janela. Reabra antes de salvar.';end if;
  d:=r.data;
 end if;
 select name into actor from public.fs_members where id=auth.uid();
 if act='archive' and p_id is not null then
  if not public.fs_is_admin() then raise exception 'Somente o administrador pode arquivar sugestões.';end if;
  update public.fs_suggestions set archived_at=now(),version=version+1 where id=p_id;
  insert into public.fs_events("user",action,item) values(actor,'Arquivou sugestão',d->>'title');return jsonb_build_object('id',p_id);
 elsif act='status' and p_id is not null then
  if not public.fs_is_admin() then raise exception 'Somente o administrador pode atualizar o status.';end if;
  if coalesce(b->>'status','') not in ('Nova','Em análise','Aprovada','Em implementação','Concluída','Não priorizada') then raise exception 'Status inválido.';end if;
  if d->>'status'=b->>'status' then return jsonb_build_object('id',p_id);end if;
  d:=d||jsonb_build_object('status',b->>'status','comments',d->'comments'||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'author',actor,'at',now(),'text','Status alterado de '||(d->>'status')||' para '||(b->>'status'))));label:='Atualizou status da sugestão para '||(b->>'status');
 elsif act='comment' and p_id is not null then
  if coalesce(length(trim(b->>'text')),0) not between 1 and 2000 then raise exception 'Escreva um comentário de até 2000 caracteres.';end if;
  d:=d||jsonb_build_object('comments',d->'comments'||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'author',actor,'at',now(),'text',trim(b->>'text'))));label:='Comentou na sugestão';
 elsif act='save' then
  if p_id is not null and r.owner_id<>auth.uid() and not public.fs_is_admin() then raise exception 'Somente o autor ou administrador pode editar esta sugestão.';end if;
  if coalesce(length(trim(b->>'title')),0) not between 1 and 150 or coalesce(length(trim(b->>'description')),0) not between 1 and 4000
   or length(coalesce(b->>'benefit',''))>2000 or length(coalesce(b->>'area',''))>100 then raise exception 'Revise título, descrição, área e benefício esperado.';end if;
  d:=coalesce(d,jsonb_build_object('status','Nova','comments','[]'::jsonb,'createdAt',now()))||jsonb_build_object('title',trim(b->>'title'),'description',trim(b->>'description'),'benefit',trim(coalesce(b->>'benefit','')),'area',trim(coalesce(b->>'area','')));
  label:=case when p_id is null then 'Enviou sugestão de melhoria' else 'Editou sugestão de melhoria' end;
 else raise exception 'Operação inválida.';end if;
 d:=d||jsonb_build_object('updatedAt',now());
 if p_id is null then insert into public.fs_suggestions(id,owner_id,data) values(ident,auth.uid(),d);
 else update public.fs_suggestions set data=d,version=version+1 where id=p_id;end if;
 insert into public.fs_events("user",action,item) values(actor,label,d->>'title');return jsonb_build_object('id',ident);
end;$$;
revoke all on function public.fs_valid_cnpj(text) from public,anon,authenticated;
revoke all on function public.fs_get_registries(),public.fs_save_company(uuid,jsonb),public.fs_save_suggestion(uuid,jsonb) from public,anon;
grant execute on function public.fs_get_registries(),public.fs_save_company(uuid,jsonb),public.fs_save_suggestion(uuid,jsonb) to authenticated;
commit;
