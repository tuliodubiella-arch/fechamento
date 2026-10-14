begin;
create table public.fs_groups(id uuid primary key default gen_random_uuid(),data jsonb not null,version integer not null default 1,deleted_at timestamptz,deleted_by uuid references public.fs_members(id));
alter table public.fs_groups enable row level security;
create policy fs_groups_read on public.fs_groups for select to authenticated using(public.fs_is_member());
revoke all on public.fs_groups from anon,authenticated;
grant select on public.fs_groups to authenticated;
grant all on public.fs_groups to service_role;
create index fs_items_group_idx on public.fs_items ((data->>'groupId')) where deleted_at is null;

create function public.fs_create_group(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ident uuid:=gen_random_uuid(); stages jsonb:='[]'; s jsonb; actor text;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 if coalesce(length(trim(p_payload->>'title')),0)=0 or length(p_payload->>'title')>150 or not exists(select 1 from public.fs_members where id=(p_payload->>'owner')::uuid and active) then raise exception 'Informe nome e responsável do grupo.';end if;
 if jsonb_typeof(p_payload->'stages') is distinct from 'array' or jsonb_array_length(p_payload->'stages') not between 2 and 8 then raise exception 'Configure de 2 a 8 etapas.';end if;
 for s in select value from jsonb_array_elements(p_payload->'stages') loop
 if coalesce(length(trim(s->>'name')),0)=0 or length(s->>'name')>60 or coalesce(s->>'status','') not in ('Planejada','Em andamento','Bloqueada','Concluída') then raise exception 'Revise o nome e status das etapas.';end if;
 stages:=stages||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',trim(s->>'name'),'status',s->>'status'));end loop;
 if (select count(distinct value->>'name') from jsonb_array_elements(stages))<>jsonb_array_length(stages) or not exists(select 1 from jsonb_array_elements(stages) stage_row where stage_row->>'status'='Concluída') then raise exception 'Use nomes diferentes nas etapas e ao menos uma etapa concluída.';end if;
 insert into public.fs_groups(id,data) values(ident,jsonb_build_object('title',trim(p_payload->>'title'),'description',left(coalesce(p_payload->>'description',''),2000),'owner',p_payload->>'owner','stages',stages,'createdAt',now(),'updatedAt',now()));
 select name into actor from public.fs_members where id=auth.uid();insert into public.fs_events("user",action,item) values(actor,'Criou grupo de rotinas',trim(p_payload->>'title'));return jsonb_build_object('id',ident);
end; $$;

create function public.fs_guard_group_record() returns trigger language plpgsql set search_path='' as $$
declare g public.fs_groups; s jsonb;
begin
 -- Uma exclusão administrativa preserva os dados existentes da entrega.
 if new.deleted_at is not null then return new;end if;
 if coalesce(new.data->>'groupId','')='' then return new;end if;
 if new.data->>'type'<>'routine' then raise exception 'Somente rotinas podem ser registros de um grupo.';end if;
 select * into g from public.fs_groups where id=(new.data->>'groupId')::uuid and deleted_at is null for share;
 if not found then raise exception 'Grupo não encontrado ou excluído.';end if;
 select value into s from jsonb_array_elements(g.data->'stages') where value->>'id'=new.data->>'stageId';
 if s is null then raise exception 'Etapa inválida para este grupo.';end if;
 if new.data->>'status' is distinct from s->>'status' then raise exception 'Altere a etapa do registro para atualizar seu status.';end if;
 return new;
end; $$;
create trigger fs_guard_group_record before insert or update on public.fs_items for each row execute function public.fs_guard_group_record();
revoke all on function public.fs_guard_group_record() from public,anon,authenticated;

create function public.fs_update_record(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fs_items; g public.fs_groups; s jsonb; d jsonb; actor text; group_id text; stage_id text; label text;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 select * into r from public.fs_items where id=p_id for update;
 if not found or r.deleted_at is not null or r.data->>'type'<>'routine' then raise exception 'Rotina não encontrada.';end if;
 if (p_payload->>'version')::integer is distinct from r.version then raise exception 'Outra pessoa atualizou este registro. Atualize os dados e tente novamente.';end if;
 d:=r.data;
 if p_payload->>'action'='record-stage' then group_id:=d->>'groupId';stage_id:=p_payload->>'stageId';if coalesce(group_id,'')='' then raise exception 'Vincule o registro a um grupo primeiro.';end if;
 elsif p_payload->>'action'='record-settings' then group_id:=p_payload->>'groupId';stage_id:=p_payload->>'stageId';d:=d||jsonb_build_object('company',left(coalesce(p_payload->>'company',''),150),'registry',left(coalesce(p_payload->>'registry',''),150),'protocol',left(coalesce(p_payload->>'protocol',''),100));
 else raise exception 'Operação inválida.';end if;
 if coalesce(group_id,'')<>'' then
 select * into g from public.fs_groups where id=group_id::uuid and deleted_at is null for share;if not found then raise exception 'Grupo não encontrado ou excluído.';end if;
 if coalesce(stage_id,'')='' then stage_id:=g.data->'stages'->0->>'id';end if;
 select value into s from jsonb_array_elements(g.data->'stages') where value->>'id'=stage_id;if s is null then raise exception 'Etapa inválida para este grupo.';end if;
 d:=d||jsonb_build_object('groupId',group_id,'stageId',stage_id,'status',s->>'status');label:=case when p_payload->>'action'='record-stage' then 'Moveu registro para '||(s->>'name') else 'Organizou registro no grupo '||(g.data->>'title') end;
 else d:=d-'groupId'-'stageId';label:='Atualizou a organização da rotina';end if;
 update public.fs_items set data=d||jsonb_build_object('updatedAt',now()),version=version+1 where id=p_id;
 select name into actor from public.fs_members where id=auth.uid();insert into public.fs_events("user",action,item) values(actor,label,r.data->>'title');return jsonb_build_object('ok',true);
end; $$;

create function public.fs_create_group_record(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare created jsonb;
begin
 if p_payload->>'type' is distinct from 'routine' or coalesce(p_payload->>'groupId','')='' then raise exception 'Informe um grupo para o registro.';end if;
 created:=public.fs_create_item(p_payload);
 perform public.fs_update_record((created->>'id')::uuid,p_payload||jsonb_build_object('action','record-settings','version',1));return created;
end; $$;

create function public.fs_update_group(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.fs_groups; actor text; total integer;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 -- A exclusão trava os registros antes do grupo, na mesma ordem usada nas edições.
 if p_payload->>'action'='delete-group' then
 if not public.fs_is_admin() then raise exception 'Somente o administrador pode excluir grupos.';end if;
 perform id from public.fs_items where data->>'groupId'=p_id::text and deleted_at is null order by id for update;
 end if;
 select * into g from public.fs_groups where id=p_id and deleted_at is null for update;if not found then raise exception 'Grupo não encontrado ou excluído.';end if;
 if (p_payload->>'version')::integer is distinct from g.version then raise exception 'Outra pessoa atualizou o grupo. Atualize e tente novamente.';end if;
 select name into actor from public.fs_members where id=auth.uid();
 if p_payload->>'action'='delete-group' then
 update public.fs_groups set deleted_at=now(),deleted_by=auth.uid(),version=version+1 where id=p_id;
 update public.fs_items set deleted_at=now(),deleted_by=auth.uid(),version=version+1 where data->>'groupId'=p_id::text and deleted_at is null;get diagnostics total=row_count;
 insert into public.fs_events("user",action,item) values(actor,'Excluiu grupo e '||total||' registros',g.data->>'title');
 elsif p_payload->>'action'='update-group' then
 if g.data->>'owner'<>auth.uid()::text and not public.fs_is_admin() then raise exception 'Somente o responsável ou administrador pode editar o grupo.';end if;
 if coalesce(length(trim(p_payload->>'title')),0)=0 or length(p_payload->>'title')>150 or not exists(select 1 from public.fs_members where id=(p_payload->>'owner')::uuid and active) then raise exception 'Revise nome e responsável.';end if;
 update public.fs_groups set data=data||jsonb_build_object('title',trim(p_payload->>'title'),'description',left(coalesce(p_payload->>'description',''),2000),'owner',p_payload->>'owner','updatedAt',now()),version=version+1 where id=p_id;
 insert into public.fs_events("user",action,item) values(actor,'Atualizou grupo',trim(p_payload->>'title'));
 else raise exception 'Operação inválida.';end if;return jsonb_build_object('ok',true);
end; $$;

create or replace function public.fs_get_state() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.fs_is_member() then raise exception 'Sua conta ainda não tem acesso ao fiscal. Solicite ao administrador.';end if;
 return jsonb_build_object('user',(select jsonb_build_object('id',id,'name',name,'email',email,'role',role) from public.fs_members where id=auth.uid()),'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'role',role) order by name) from public.fs_members where active),'[]'::jsonb),'groups',coalesce((select jsonb_agg(data||jsonb_build_object('id',id,'version',version) order by data->>'title') from public.fs_groups where deleted_at is null),'[]'::jsonb),'items',coalesce((select jsonb_agg(data||jsonb_build_object('id',id,'version',version) order by data->>'createdAt') from public.fs_items where deleted_at is null),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e) order by at desc) from (select * from public.fs_events order by at desc limit 1000)e),'[]'::jsonb));
end; $$;
revoke all on function public.fs_create_group(jsonb),public.fs_update_record(uuid,jsonb),public.fs_create_group_record(jsonb),public.fs_update_group(uuid,jsonb) from public,anon;
grant execute on function public.fs_create_group(jsonb),public.fs_update_record(uuid,jsonb),public.fs_create_group_record(jsonb),public.fs_update_group(uuid,jsonb) to authenticated;
commit;
