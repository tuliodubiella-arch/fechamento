begin;
lock table public.fs_members,public.fs_items,public.fs_groups,public.fs_events,public.fs_attachments,public.fs_meetings,public.fs_companies,public.fs_suggestions,public.fs_personal_items in share row exclusive mode;
create temporary table fs_department_preservation(table_name text primary key,total bigint,checksum text) on commit drop;
do $$ declare target text;begin
 foreach target in array array['fs_members','fs_items','fs_groups','fs_events','fs_attachments','fs_meetings','fs_companies','fs_suggestions','fs_personal_items'] loop
  execute format('insert into fs_department_preservation select %L,count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'''' order by id),'''')) from public.%I t',target,target);
 end loop;
end;$$;
-- O Fiscal existente torna-se o primeiro departamento. Identidades são localizadas,
-- não recriadas; as tabelas do fechamento e do organograma não são alteradas.
create table public.fs_departments(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 2 and 80),
 administrator_id uuid not null references auth.users(id),active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index fs_departments_name on public.fs_departments(lower(trim(name)));
create table public.fs_platform_admins(user_id uuid primary key references auth.users(id),created_at timestamptz not null default now());
create table public.fs_department_invites(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 name text not null,email text not null,created_by uuid not null references auth.users(id),
 status text not null default 'pending' check(status in ('pending','accepted')),
 email_status text not null default 'pending' check(email_status in ('pending','sent','failed')),
 created_at timestamptz not null default now(),sent_at timestamptz,
 accepted_department_id uuid references public.fs_departments(id),accepted_at timestamptz
);
create unique index fs_department_invites_pending on public.fs_department_invites(user_id) where status='pending';
create table public.fs_team_invite_queue(
 id uuid primary key default gen_random_uuid(),department_id uuid not null references public.fs_departments(id),
 name text not null,email text not null,status text not null default 'pending' check(status in ('pending','sent','failed')),
 created_at timestamptz not null default now(),sent_at timestamptz,
 unique(department_id,email)
);
do $$ declare actor uuid; dep uuid; target text;
begin
 select id into strict actor from public.fs_members where lower(email)='tulio.dubiella@gmail.com' and active;
 insert into public.fs_platform_admins(user_id) values(actor);
 insert into public.fs_departments(name,administrator_id) values('Fiscal',actor) returning id into dep;
 foreach target in array array['fs_members','fs_items','fs_groups','fs_events','fs_attachments','fs_meetings','fs_companies','fs_suggestions','fs_personal_items'] loop
  execute format('alter table public.%I add column department_id uuid references public.fs_departments(id)',target);
  execute format('update public.%I set department_id=$1',target) using dep;
  execute format('alter table public.%I alter column department_id set not null',target);
  execute format('create index %I on public.%I(department_id)',target||'_department_idx',target);
 end loop;
end;$$;

create function public.fs_current_department() returns uuid language sql stable security definer set search_path='' as $$
 select m.department_id from public.fs_members m join public.fs_departments d on d.id=m.department_id where m.id=auth.uid() and m.active and d.active;
$$;
create or replace function public.fs_is_member() returns boolean language sql stable security definer set search_path='' as $$ select public.fs_current_department() is not null; $$;
create or replace function public.fs_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.fs_members where id=auth.uid() and active and role='admin' and department_id=public.fs_current_department());
$$;
create function public.fs_is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.fs_platform_admins where user_id=auth.uid()); $$;
revoke all on function public.fs_current_department(),public.fs_is_platform_admin() from public,anon;
grant execute on function public.fs_current_department(),public.fs_is_platform_admin() to authenticated,service_role;

-- As operações antigas continuam com as mesmas validações, mas passam a executar
-- com um papel interno sem BYPASSRLS e que não é dono de nenhuma tabela.
create role fs_department_executor nologin inherit nobypassrls;
-- Herda apenas o acesso de leitura ao esquema de identidade já concedido pelo
-- Supabase a authenticated; o sentido inverso NÃO é concedido.
grant authenticated to fs_department_executor;
grant fs_department_executor to postgres;
grant usage,create on schema public to fs_department_executor;
grant execute on function auth.uid() to fs_department_executor;
do $$ declare target text; p record; predicate text;
begin
 foreach target in array array['fs_members','fs_items','fs_groups','fs_events','fs_attachments','fs_meetings','fs_companies','fs_suggestions','fs_personal_items'] loop
  execute format('alter table public.%I alter column department_id set default public.fs_current_department()',target);
  for p in select policyname from pg_policies where schemaname='public' and tablename=target loop
   execute format('drop policy %I on public.%I',p.policyname,target);
  end loop;
  predicate:='department_id=(select public.fs_current_department())';
  if target='fs_personal_items' then predicate:=predicate||' and owner_id=(select auth.uid())';end if;
  execute format('create policy department_read on public.%I for select to authenticated using (%s)',target,predicate||case when target='fs_attachments' then ' and (committed or uploaded_by=(select auth.uid()))' when target='fs_personal_items' then ' and deleted_at is null' when target in ('fs_companies','fs_suggestions') then ' and archived_at is null' else '' end);
  execute format('create policy department_operations on public.%I for all to fs_department_executor using (%s) with check (%s)',target,predicate,predicate);
  execute format('grant select,insert,update,delete on public.%I to fs_department_executor',target);
 end loop;
 for p in select oid,proname,oid::regprocedure signature,prosecdef from pg_proc where pronamespace='public'::regnamespace and proname like 'fs\_%' escape '\' loop
  if p.proname not in ('fs_find_auth_user','fs_track_member_onboarding','fs_track_password_defined','fs_requires_password_setup','fs_current_department','fs_is_member','fs_is_admin','fs_is_platform_admin') then
   if p.prosecdef then execute format('alter function %s owner to fs_department_executor',p.signature);end if;
   execute format('grant execute on function %s to fs_department_executor',p.signature);
  end if;
 end loop;
end;$$;
grant execute on function public.fs_current_department(),public.fs_is_member(),public.fs_is_admin() to fs_department_executor;
revoke create on schema public from fs_department_executor;
revoke insert,update,delete on public.fs_members from fs_department_executor;
drop index public.fs_companies_active_cnpj;
create unique index fs_companies_active_cnpj on public.fs_companies(department_id,cnpj) where archived_at is null;

-- Políticas permissivas de outros aplicativos não podem liberar o bucket fiscal.
-- As restrições abaixo afetam exclusivamente este bucket e se somam às existentes.
create policy fs_department_storage_read on storage.objects as restrictive for select to authenticated
using(bucket_id<>'fiscal-prints' or exists(select 1 from public.fs_attachments a where a.path=objects.name and a.department_id=(select public.fs_current_department()) and (a.committed or a.uploaded_by=(select auth.uid()))));
create policy fs_department_storage_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'fiscal-prints' or exists(select 1 from public.fs_attachments a where a.path=objects.name and a.department_id=(select public.fs_current_department()) and a.uploaded_by=(select auth.uid()) and not a.committed));
create policy fs_department_storage_delete on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'fiscal-prints' or exists(select 1 from public.fs_attachments a where a.path=objects.name and a.department_id=(select public.fs_current_department()) and a.uploaded_by=(select auth.uid()) and not a.committed));
create policy fs_department_storage_update on storage.objects as restrictive for update to authenticated
using(bucket_id<>'fiscal-prints') with check(bucket_id<>'fiscal-prints');

-- Impede vínculos a responsáveis/grupos de outro departamento, inclusive em JSON.
create function public.fs_guard_department_links() returns trigger language plpgsql set search_path='' as $$
declare person text; entry jsonb;
begin
 if tg_op='UPDATE' and new.department_id is distinct from old.department_id then raise exception 'Não é permitido transferir registros entre departamentos.';end if;
 if tg_table_name='fs_members' then
  if tg_op='INSERT' and new.role<>'admin' and exists(select 1 from public.fs_department_invites where user_id=new.id and status='pending') then raise exception 'Esta pessoa tem um convite para cadastrar seu próprio departamento.';end if;
 end if;
 if tg_table_name in ('fs_items','fs_groups') then
  person:=new.data->>'owner';
  if not exists(select 1 from public.fs_members where id::text=person and department_id=new.department_id and active) then raise exception 'Responsável não pertence ao departamento.';end if;
  if tg_table_name='fs_items' then
   if coalesce(new.data->>'groupId','')<>'' and not exists(select 1 from public.fs_groups where id::text=new.data->>'groupId' and department_id=new.department_id) then raise exception 'Grupo não pertence ao departamento.';end if;
   for entry in select value from jsonb_array_elements(coalesce(new.data->'delegations','[]')) loop
    if not exists(select 1 from public.fs_members where id::text=entry->>'assignee' and department_id=new.department_id) then raise exception 'Participante não pertence ao departamento.';end if;
   end loop;
  end if;
 elsif tg_table_name='fs_attachments' then
  if not exists(select 1 from public.fs_items where id=new.item_id and department_id=new.department_id) then raise exception 'Anexo não pertence ao departamento.';end if;
 end if;
 return new;
end;$$;
revoke all on function public.fs_guard_department_links() from public,anon,authenticated;
do $$ declare target text;begin
 foreach target in array array['fs_members','fs_items','fs_groups','fs_events','fs_attachments','fs_meetings','fs_companies','fs_suggestions','fs_personal_items'] loop
  execute format('create trigger fs_department_links before insert or update on public.%I for each row execute function public.fs_guard_department_links()',target);
 end loop;
end;$$;

alter table public.fs_departments enable row level security;
alter table public.fs_platform_admins enable row level security;
alter table public.fs_department_invites enable row level security;
alter table public.fs_team_invite_queue enable row level security;
revoke all on public.fs_departments,public.fs_platform_admins,public.fs_department_invites,public.fs_team_invite_queue from public,anon,authenticated;
grant all on public.fs_departments,public.fs_platform_admins,public.fs_department_invites,public.fs_team_invite_queue to service_role;
grant select on public.fs_departments to authenticated;
create policy own_department on public.fs_departments for select to authenticated using(id=(select public.fs_current_department()));

create function public.fs_get_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member public.fs_members; invitation public.fs_department_invites; dep public.fs_departments; platform boolean;
begin
 if auth.uid() is null then raise exception 'Entre com sua conta.';end if;
 platform:=public.fs_is_platform_admin();
 select * into member from public.fs_members where id=auth.uid() and active;
 if member.id is not null then select * into dep from public.fs_departments where id=member.department_id and active;end if;
 select * into invitation from public.fs_department_invites where user_id=auth.uid() and status='pending' order by created_at limit 1;
 if dep.id is null and not platform and invitation.id is null then raise exception 'Sua conta não possui um departamento ativo. Solicite um convite.';end if;
 return jsonb_build_object('platformAdmin',platform,'department',case when dep.id is not null then jsonb_build_object('id',dep.id,'name',dep.name) end,'onboarding',case when dep.id is null and invitation.id is not null then jsonb_build_object('invitationId',invitation.id,'name',invitation.name,'email',invitation.email) end,'user',case when member.id is not null then jsonb_build_object('id',member.id,'name',member.name,'email',member.email,'role',member.role) else (select jsonb_build_object('id',id,'name',coalesce(invitation.name,'Administrador geral'),'email',email,'role','platform-admin') from auth.users where id=auth.uid()) end);
end;$$;
create or replace function public.fs_requires_password_setup() returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not (public.fs_is_member() or public.fs_is_platform_admin() or exists(select 1 from public.fs_department_invites where user_id=auth.uid() and status='pending')) then raise exception 'Acesso negado.';end if;
 return coalesce((select required from public.fs_password_onboarding where user_id=auth.uid()),false);
end;$$;

create function public.fs_platform_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.fs_is_platform_admin() then raise exception 'Somente a administração geral pode consultar a utilização.';end if;
 return jsonb_build_object('departments',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'active',d.active,'createdAt',d.created_at,'administrator',m.name,'users',(select count(*) from public.fs_members where department_id=d.id and active),'routines',(select count(*) from public.fs_items where department_id=d.id and deleted_at is null and data->>'type'='routine'),'lastActivity',(select max(at) from public.fs_events where department_id=d.id)) order by d.name) from public.fs_departments d left join public.fs_members m on m.id=d.administrator_id),'[]'::jsonb),'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'status',status,'emailStatus',email_status,'sentAt',sent_at,'createdAt',created_at) order by created_at desc) from public.fs_department_invites where status='pending'),'[]'::jsonb));
end;$$;

create function public.fs_complete_department(p_invitation uuid,p_name text,p_admin_name text,p_users jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.fs_department_invites; dep uuid; person jsonb; email_value text;
begin
 if auth.uid() is null then raise exception 'Entre com sua conta.';end if;
 select * into invitation from public.fs_department_invites where id=p_invitation and user_id=auth.uid() for update;
 if not found then raise exception 'Convite não encontrado para esta conta.';end if;
 if invitation.status='accepted' then return jsonb_build_object('departmentId',invitation.accepted_department_id);end if;
 if exists(select 1 from public.fs_members where id=auth.uid()) then raise exception 'Esta conta já pertence a um departamento.';end if;
 if coalesce(length(trim(p_name)),0) not between 2 and 80 or coalesce(length(trim(p_admin_name)),0) not between 2 and 80 or jsonb_typeof(p_users) is distinct from 'array' or jsonb_array_length(p_users)>50 then raise exception 'Revise os dados do departamento e da equipe (até 50 pessoas).';end if;
 if (select count(*) from jsonb_array_elements(p_users))<>(select count(distinct lower(trim(value->>'email'))) from jsonb_array_elements(p_users)) then raise exception 'Há e-mails repetidos na equipe.';end if;
 for person in select value from jsonb_array_elements(p_users) loop
  email_value:=lower(trim(person->>'email'));
  if coalesce(length(trim(person->>'name')),0) not between 2 and 80 or length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or email_value is null or email_value=lower(invitation.email) then raise exception 'Informe nome e e-mail válidos para cada integrante, sem repetir o administrador.';end if;
  if exists(select 1 from public.fs_members where lower(email)=email_value) then raise exception 'Um dos e-mails já pertence a um departamento. Revise a equipe.';end if;
 end loop;
 insert into public.fs_departments(name,administrator_id) values(trim(p_name),auth.uid()) returning id into dep;
 insert into public.fs_members(id,name,email,role,active,department_id) values(auth.uid(),trim(p_admin_name),lower(invitation.email),'admin',true,dep);
 for person in select value from jsonb_array_elements(p_users) loop
  insert into public.fs_team_invite_queue(department_id,name,email) values(dep,trim(person->>'name'),lower(trim(person->>'email')));
 end loop;
 update public.fs_department_invites set status='accepted',accepted_at=now(),accepted_department_id=dep where id=invitation.id;
 insert into public.fs_events("user",action,item,department_id) values(trim(p_admin_name),'Criou o departamento',trim(p_name),dep);
 return jsonb_build_object('departmentId',dep);
end;$$;
create function public.fs_team_queue_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.fs_is_admin() then raise exception 'Somente o administrador do departamento pode consultar seus convites.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'status',status) order by created_at) from public.fs_team_invite_queue where department_id=public.fs_current_department()),'[]');
end;$$;
revoke all on function public.fs_get_context(),public.fs_platform_summary(),public.fs_complete_department(uuid,text,text,jsonb),public.fs_team_queue_status() from public,anon;
grant execute on function public.fs_get_context(),public.fs_platform_summary(),public.fs_complete_department(uuid,text,text,jsonb),public.fs_team_queue_status() to authenticated;
do $$ declare original record; total bigint; checksum text;begin
 for original in select * from fs_department_preservation loop
  execute format('select count(*),md5(coalesce(string_agg((to_jsonb(t)-''department_id'')::text,'''' order by id),'''')) from public.%I t',original.table_name) into total,checksum;
  if total<>original.total or checksum<>original.checksum then raise exception 'A transição alterou conteúdo existente em %. Nada será aplicado.',original.table_name;end if;
 end loop;
end;$$;
commit;
