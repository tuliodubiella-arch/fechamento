begin;
create table public.fs_members(
 id uuid primary key references auth.users(id),name text not null,email text not null unique,
 role text not null default 'member' check(role in ('admin','member')),active boolean not null default true
);
create table public.fs_items(id uuid primary key default gen_random_uuid(),data jsonb not null,version integer not null default 1);
create table public.fs_events(id uuid primary key default gen_random_uuid(),"user" text not null,action text not null,item text not null,at timestamptz not null default now());
create table public.fs_attachments(id uuid primary key default gen_random_uuid(),item_id uuid not null references public.fs_items(id),uploaded_by uuid not null references public.fs_members(id),name text not null,type text not null check(type in ('image/png','image/jpeg','image/webp')),size integer not null check(size between 1 and 5242880),path text not null unique,committed boolean not null default false,created_at timestamptz not null default now());
alter table public.fs_members enable row level security;
alter table public.fs_items enable row level security;
alter table public.fs_events enable row level security;
alter table public.fs_attachments enable row level security;
create function public.fs_is_member() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.fs_members where id=auth.uid() and active); $$;
create function public.fs_is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.fs_members where id=auth.uid() and active and role='admin'); $$;
create policy fs_read_members on public.fs_members for select to authenticated using(public.fs_is_member());
create policy fs_read_items on public.fs_items for select to authenticated using(public.fs_is_member());
create policy fs_read_events on public.fs_events for select to authenticated using(public.fs_is_member());
create policy fs_read_attachments on public.fs_attachments for select to authenticated using(public.fs_is_member() and (committed or uploaded_by=auth.uid()));
revoke all on public.fs_members,public.fs_items,public.fs_events,public.fs_attachments from anon,authenticated;
grant select on public.fs_members,public.fs_items,public.fs_events,public.fs_attachments to authenticated;
grant all on public.fs_members,public.fs_items,public.fs_events,public.fs_attachments to service_role;
insert into public.fs_members(id,name,email,role) select id,name,email,'admin' from public.fc_members where active and is_admin;

create function public.fs_get_state() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.fs_is_member() then raise exception 'Sua conta ainda não tem acesso ao fiscal. Solicite ao administrador.'; end if;
 return jsonb_build_object('user',(select jsonb_build_object('id',id,'name',name,'email',email,'role',role) from public.fs_members where id=auth.uid()),'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'role',role) order by name) from public.fs_members where active),'[]'::jsonb),'items',coalesce((select jsonb_agg(data||jsonb_build_object('id',id,'version',version) order by data->>'createdAt') from public.fs_items),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e) order by at desc) from (select * from public.fs_events order by at desc limit 1000)e),'[]'::jsonb));
end; $$;
create function public.fs_create_item(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb:=p_payload; ident uuid:=gen_random_uuid(); start_day date; end_day date; actor text; d jsonb;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 start_day:=(b->>'start')::date;end_day:=(b->>'end')::date;
 if coalesce(length(trim(b->>'title')),0)=0 or length(b->>'title')>150 or coalesce(b->>'type','') not in ('routine','project') or start_day is null or end_day is null or end_day<start_day or not exists(select 1 from public.fs_members where id=(b->>'owner')::uuid and active) then raise exception 'Revise título, responsável e período.'; end if;
 d:=jsonb_build_object('type',b->>'type','title',trim(b->>'title'),'description',left(coalesce(b->>'description',''),2000),'owner',b->>'owner','start',start_day,'end',end_day,'frequency',case when b->>'frequency' in ('Diária','Semanal','Mensal','Única') then b->>'frequency' else 'Única' end,'priority',case when b->>'priority' in ('Baixa','Média','Alta') then b->>'priority' else 'Média' end,'status','Planejada','activities','[]'::jsonb,'delegations','[]'::jsonb,'comments','[]'::jsonb,'executions','[]'::jsonb,'createdAt',now(),'updatedAt',now());
 insert into public.fs_items(id,data) values(ident,d);select name into actor from public.fs_members where id=auth.uid();insert into public.fs_events("user",action,item) values(actor,'Criou',d->>'title');return jsonb_build_object('id',ident);
end; $$;

create function public.fs_prepare_attachment(p_item uuid,p_name text,p_type text,p_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare ident uuid:=gen_random_uuid(); object_path text; m public.fs_attachments;
begin
 if not public.fs_is_member() or not exists(select 1 from public.fs_items where id=p_item) then raise exception 'Acesso negado.';end if;
 if p_type not in ('image/png','image/jpeg','image/webp') or p_size not between 1 and 5242880 then raise exception 'Use PNG, JPG ou WebP de até 5 MB.';end if;
 object_path:=auth.uid()::text||'/'||ident::text||case p_type when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.webp' end;
 insert into public.fs_attachments(id,item_id,uploaded_by,name,type,size,path) values(ident,p_item,auth.uid(),left(coalesce(nullif(trim(p_name),''),'Print'),150),p_type,p_size,object_path) returning * into m;
 return jsonb_build_object('id',m.id,'path',m.path,'name',m.name,'type',m.type,'size',m.size);
end; $$;
create function public.fs_discard_attachment(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin delete from public.fs_attachments where id=p_id and uploaded_by=auth.uid() and not committed;end; $$;
create function public.fs_collect_attachments(p_item uuid,p_ids jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare results jsonb:='[]'; val jsonb; m public.fs_attachments;
begin
 if jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids)>3 then raise exception 'Anexe até 3 prints.';end if;
 for val in select value from jsonb_array_elements(p_ids) loop
 select * into m from public.fs_attachments where id=(val#>>'{}')::uuid and item_id=p_item and uploaded_by=auth.uid() and not committed for update;
 if not found or not exists(select 1 from storage.objects where bucket_id='fiscal-prints' and name=m.path) then raise exception 'Print não disponível. Envie novamente.';end if;
 update public.fs_attachments set committed=true where id=m.id;
 results:=results||jsonb_build_array(jsonb_build_object('id',m.id,'path',m.path,'name',m.name,'type',m.type,'size',m.size));end loop;return results;
end; $$;

create function public.fs_apply_item(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fs_items; d jsonb; b jsonb:=p_payload; act text:=p_payload->>'action'; actor text; label text; pos integer; entry jsonb; list jsonb; note jsonb; attachments jsonb; assignee text; start_day date;end_day date; t timestamptz:=now();
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 select * into r from public.fs_items where id=p_id for update;if not found then raise exception 'Entrega não encontrada.';end if;
 if (b->>'version')::integer is distinct from r.version then raise exception 'Outra pessoa atualizou este registro. Recarregue os dados e confira antes de repetir.';end if;
 d:=r.data;select name into actor from public.fs_members where id=auth.uid();
 if act='status' and b->>'status' in ('Planejada','Em andamento','Concluída','Bloqueada') then d:=jsonb_set(d,'{status}',b->'status');label:='Alterou o status para '||(b->>'status');
 elsif act='activity' and coalesce(length(trim(b->>'title')),0)>0 then d:=jsonb_set(d,'{activities}',d->'activities'||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title',left(trim(b->>'title'),200),'done',false)));label:='Adicionou atividade';
 elsif act='toggle' then
 select (ordinality-1)::int,value into pos,entry from jsonb_array_elements(d->'activities') with ordinality where value->>'id'=b->>'id';if entry is null then raise exception 'Atividade não encontrada.';end if;
 entry:=jsonb_set(entry,'{done}',to_jsonb(not (entry->>'done')::boolean));d:=jsonb_set(d,array['activities',pos::text],entry);label:=case when (entry->>'done')::boolean then 'Concluiu atividade' else 'Reabriu atividade' end;
 elsif act in ('comment','execution') and coalesce(length(trim(b->>'text')),0)>0 then
 attachments:=public.fs_collect_attachments(p_id,coalesce(b->'attachments','[]'));note:=jsonb_build_object('id',gen_random_uuid(),'text',left(trim(b->>'text'),2000),'author',actor,'at',t,'attachments',attachments);
 if act='comment' then d:=jsonb_set(d,'{comments}',d->'comments'||jsonb_build_array(note));label:='Comentou';else d:=jsonb_set(d,'{executions}',d->'executions'||jsonb_build_array(note));label:='Registrou execução';end if;
 elsif act='schedule' then
 start_day:=(b->>'start')::date;end_day:=(b->>'end')::date;if start_day is null or end_day is null or end_day<start_day then raise exception 'Revise o período.';end if;d:=d||jsonb_build_object('start',start_day,'end',end_day);label:='Atualizou o cronograma';
 elsif act='delegate' then
 if d->>'owner'<>auth.uid()::text and not public.fs_is_admin() then raise exception 'Somente o dono ou administrador pode delegar.';end if;
 select name into assignee from public.fs_members where id=(b->>'assignee')::uuid and active;
 if assignee is null or b->>'assignee'=d->>'owner' or coalesce(length(trim(b->>'title')),0)=0 or (b->>'due')::date is null then raise exception 'Informe ação, prazo e outra pessoa responsável.';end if;
 entry:=jsonb_build_object('id',gen_random_uuid(),'title',left(trim(b->>'title'),200),'assignee',b->>'assignee','due',(b->>'due')::date,'done',false,'createdBy',auth.uid(),'createdAt',t,'completedAt',null,'completedBy',null,'result','');d:=jsonb_set(d,'{delegations}',coalesce(d->'delegations','[]')||jsonb_build_array(entry));label:='Delegou “'||(entry->>'title')||'” para '||assignee;
 elsif act in ('complete-delegation','reopen-delegation') then
 select (ordinality-1)::int,value into pos,entry from jsonb_array_elements(coalesce(d->'delegations','[]')) with ordinality where value->>'id'=b->>'id';if entry is null then raise exception 'Ação não encontrada.';end if;
 if entry->>'assignee'<>auth.uid()::text and d->>'owner'<>auth.uid()::text and not public.fs_is_admin() then raise exception 'Somente o responsável, dono ou administrador pode atualizar.';end if;
 if act='complete-delegation' then
 if (entry->>'done')::boolean or coalesce(length(trim(b->>'result')),0)=0 then raise exception 'Ação já concluída ou resultado vazio.';end if;
 attachments:=public.fs_collect_attachments(p_id,coalesce(b->'attachments','[]'));entry:=entry||jsonb_build_object('done',true,'completedAt',t,'completedBy',auth.uid(),'result',left(trim(b->>'result'),2000),'attachments',attachments);
 note:=jsonb_build_object('id',gen_random_uuid(),'text','Ação delegada: '||(entry->>'title')||E'\nResultado: '||(entry->>'result'),'author',actor,'at',t,'attachments',attachments);d:=jsonb_set(d,'{executions}',d->'executions'||jsonb_build_array(note));label:='Concluiu a ação delegada “'||(entry->>'title')||'”';
 else if not (entry->>'done')::boolean then raise exception 'Ação já está pendente.';end if;entry:=entry||jsonb_build_object('done',false,'completedAt',null,'completedBy',null,'result','','attachments','[]'::jsonb);label:='Reabriu a ação delegada “'||(entry->>'title')||'”';end if;
 d:=jsonb_set(d,array['delegations',pos::text],entry);
 else raise exception 'Revise os campos preenchidos.';end if;
 d:=d||jsonb_build_object('updatedAt',t);update public.fs_items set data=d,version=version+1 where id=p_id;insert into public.fs_events("user",action,item) values(actor,label,d->>'title');return jsonb_build_object('ok',true);
end; $$;

create function public.fs_find_auth_user(p_email text) returns uuid language sql stable security definer set search_path='' as $$ select id from auth.users where lower(email)=lower(p_email) limit 1; $$;
revoke all on function public.fs_find_auth_user(text),public.fs_collect_attachments(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fs_find_auth_user(text) to service_role;
revoke all on function public.fs_is_member(),public.fs_is_admin(),public.fs_get_state(),public.fs_create_item(jsonb),public.fs_prepare_attachment(uuid,text,text,integer),public.fs_discard_attachment(uuid),public.fs_apply_item(uuid,jsonb) from public,anon;
grant execute on function public.fs_is_member(),public.fs_is_admin(),public.fs_get_state(),public.fs_create_item(jsonb),public.fs_prepare_attachment(uuid,text,text,integer),public.fs_discard_attachment(uuid),public.fs_apply_item(uuid,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fiscal-prints','fiscal-prints',false,5242880,array['image/png','image/jpeg','image/webp']);
create policy fs_storage_insert on storage.objects for insert to authenticated with check(bucket_id='fiscal-prints' and public.fs_is_member() and exists(select 1 from public.fs_attachments a where a.path=storage.objects.name and a.uploaded_by=auth.uid() and not a.committed));
create policy fs_storage_read on storage.objects for select to authenticated using(bucket_id='fiscal-prints' and public.fs_is_member() and exists(select 1 from public.fs_attachments a where a.path=storage.objects.name and (a.committed or a.uploaded_by=auth.uid())));
create policy fs_storage_delete on storage.objects for delete to authenticated using(bucket_id='fiscal-prints' and public.fs_is_member() and exists(select 1 from public.fs_attachments a where a.path=storage.objects.name and a.uploaded_by=auth.uid() and not a.committed));
commit;
