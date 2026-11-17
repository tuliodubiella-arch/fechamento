begin;
set local lock_timeout='10s';
lock table public.fs_items,public.fs_groups,public.fs_events in share row exclusive mode;
create table public.fs_record_history(
 id bigint generated always as identity primary key,
 item_id uuid not null references public.fs_items(id),department_id uuid not null references public.fs_departments(id),
 at timestamptz not null default clock_timestamp(),actor_id uuid references auth.users(id),actor_name text not null,
 kind text not null check(kind in ('baseline','created','changed','group_configuration')),
 snapshot jsonb not null,changes jsonb not null default '[]',legacy_events jsonb not null default '[]'
);
create index fs_record_history_item on public.fs_record_history(department_id,item_id,id);
alter table public.fs_record_history enable row level security;
revoke all on public.fs_record_history from public,anon,authenticated,fs_department_executor;
grant select on public.fs_record_history to authenticated;
create policy fs_history_read on public.fs_record_history for select to authenticated using(
 department_id=(select public.fs_current_department()) and exists(select 1 from public.fs_items i where i.id=item_id and i.deleted_at is null)
);

-- Helper privado: somente gatilhos internos constroem as versões de auditoria.
create function public.fs_record_snapshot(p_id uuid,p_data jsonb,p_version integer,p_department uuid,p_group jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g jsonb:=p_group; stage jsonb; person text; dep text;
begin
 if g is null and coalesce(p_data->>'groupId','')<>'' then select data into g from public.fs_groups where id::text=p_data->>'groupId' and department_id=p_department;end if;
 select value into stage from jsonb_array_elements(coalesce(g->'stages','[]')) where value->>'id'=p_data->>'stageId';
 select name into person from public.fs_members where id::text=p_data->>'owner' and department_id=p_department;
 select name into dep from public.fs_departments where id=p_department;
 return jsonb_build_object('id',p_id,'version',p_version,'department',dep,'group',g->>'title','stage',stage->>'name','ownerName',person,'data',p_data);
end;$$;
revoke all on function public.fs_record_snapshot(uuid,jsonb,integer,uuid,jsonb) from public,anon,authenticated;

-- Estado inicial verdadeiro, sem simular movimentações retroativas.
insert into public.fs_record_history(item_id,department_id,actor_name,kind,snapshot,legacy_events)
select i.id,i.department_id,'Sistema','baseline',public.fs_record_snapshot(i.id,i.data,i.version,i.department_id),
 case when (select count(*) from public.fs_items other where other.department_id=i.department_id and other.data->>'title'=i.data->>'title')=1
 then coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'at',e.at,'author',e."user",'action',e.action) order by e.at,e.id) from public.fs_events e where e.department_id=i.department_id and e.item=i.data->>'title'),'[]'::jsonb) else '[]'::jsonb end
from public.fs_items i where i.data->>'type'='routine';

create function public.fs_capture_record_history() returns trigger language plpgsql security definer set search_path='' as $$
declare before_data jsonb:='{}'; changes jsonb; author text; row record; previous jsonb; current_snapshot jsonb;
begin
 select name into author from public.fs_members where id=auth.uid();
 author:=coalesce(author,'Sistema');
 if tg_table_name='fs_items' then
  if new.data->>'type'<>'routine' then return new;end if;
  if tg_op='UPDATE' then before_data:=old.data;end if;
  select coalesce(jsonb_agg(jsonb_build_object('field',k,'before',before_data->k,'after',new.data->k) order by k),'[]'::jsonb) into changes
  from (select jsonb_object_keys(before_data||new.data) k) fields where k<>'updatedAt' and before_data->k is distinct from new.data->k;
  if tg_op='UPDATE' and changes='[]'::jsonb and new.deleted_at is not distinct from old.deleted_at then return new;end if;
  if tg_op='UPDATE' and new.deleted_at is distinct from old.deleted_at then changes:=changes||jsonb_build_array(jsonb_build_object('field','deletedAt','before',old.deleted_at,'after',new.deleted_at));end if;
  insert into public.fs_record_history(item_id,department_id,actor_id,actor_name,kind,snapshot,changes)
  values(new.id,new.department_id,auth.uid(),author,case when tg_op='INSERT' then 'created' else 'changed' end,public.fs_record_snapshot(new.id,new.data,new.version,new.department_id),changes);
 elsif tg_table_name='fs_groups' then
  if new.data->>'title' is not distinct from old.data->>'title' and new.data->'stages' is not distinct from old.data->'stages' then return new;end if;
  for row in select * from public.fs_items where department_id=new.department_id and data->>'groupId'=new.id::text and deleted_at is null loop
   previous:=public.fs_record_snapshot(row.id,row.data,row.version,row.department_id,old.data);
   current_snapshot:=public.fs_record_snapshot(row.id,row.data,row.version,row.department_id,new.data);
   select coalesce(jsonb_agg(jsonb_build_object('field',k,'before',previous->k,'after',current_snapshot->k) order by k),'[]'::jsonb) into changes from (values('group'),('stage')) fields(k) where previous->k is distinct from current_snapshot->k;
   if changes<>'[]'::jsonb then insert into public.fs_record_history(item_id,department_id,actor_id,actor_name,kind,snapshot,changes) values(row.id,row.department_id,auth.uid(),author,'group_configuration',current_snapshot,changes);end if;
  end loop;
 end if;
 return new;
end;$$;
revoke all on function public.fs_capture_record_history() from public,anon,authenticated;
create trigger fs_record_history_capture after insert or update on public.fs_items for each row execute function public.fs_capture_record_history();
create trigger fs_group_history_capture after update on public.fs_groups for each row execute function public.fs_capture_record_history();

-- Preserva as funções atuais e seu proprietário que obedece ao RLS departamental.
do $$ declare target record; definition text; needle text; replacement text;
begin
 for target in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('fs_create_group','fs_update_group') loop
  definition:=pg_get_functiondef(target.oid);
  if target.proname='fs_create_group' then
   needle:='''stages'',stages,''createdAt'',now()';
   replacement:='''stages'',stages,''printEnabled'',coalesce((p_payload->>''printEnabled'')::boolean,false),''createdAt'',now()';
  else
   needle:='''owner'',p_payload->>''owner'',''updatedAt'',now()';
   replacement:='''owner'',p_payload->>''owner'',''printEnabled'',case when p_payload ? ''printEnabled'' then (p_payload->>''printEnabled'')::boolean else coalesce((g.data->>''printEnabled'')::boolean,false) end,''updatedAt'',now()';
  end if;
  if position(needle in definition)=0 then raise exception 'Revise a função % antes de aplicar a impressão.',target.proname;end if;
  execute replace(definition,needle,replacement);
 end loop;
end;$$;

create function public.fs_get_record_report(p_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare item public.fs_items; g public.fs_groups; person text; dep text; stage text; histories jsonb;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 select * into item from public.fs_items where id=p_id and deleted_at is null and data->>'type'='routine';
 if not found then raise exception 'Rotina não encontrada neste departamento.';end if;
 select * into g from public.fs_groups where id::text=item.data->>'groupId' and deleted_at is null;
 if not found or coalesce((g.data->>'printEnabled')::boolean,false) is not true then raise exception 'A impressão não está habilitada para este grupo.';end if;
 select name into person from public.fs_members where id::text=item.data->>'owner';
 select name into dep from public.fs_departments where id=item.department_id;
 select value->>'name' into stage from jsonb_array_elements(g.data->'stages') where value->>'id'=item.data->>'stageId';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'at',at,'actor',actor_name,'kind',kind,'snapshot',snapshot,'changes',changes,'legacyEvents',legacy_events) order by id),'[]'::jsonb) into histories from public.fs_record_history where item_id=p_id;
 return jsonb_build_object('issuedAt',now(),'department',dep,'group',g.data->>'title','stage',stage,'ownerName',person,'item',item.data||jsonb_build_object('id',item.id,'version',item.version),'history',histories,'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.fs_members),'[]'::jsonb));
end;$$;
revoke all on function public.fs_get_record_report(uuid) from public,anon;
grant execute on function public.fs_get_record_report(uuid) to authenticated;

-- Primeiro grupo habilitado: somente o departamento Fiscal solicitado.
do $$ declare target uuid; dep uuid;
begin
 select g.id,g.department_id into strict target,dep from public.fs_groups g join public.fs_departments d on d.id=g.department_id where g.deleted_at is null and d.name='Fiscal' and g.data->>'title'='Alterações Contratuais [REGISTROS]';
 update public.fs_groups set data=data||jsonb_build_object('printEnabled',true,'updatedAt',now()),version=version+1 where id=target;
 insert into public.fs_events("user",action,item,department_id) values('Sistema','Habilitou relatórios PDF e Excel por rotina','Alterações Contratuais [REGISTROS]',dep);
end;$$;
commit;
