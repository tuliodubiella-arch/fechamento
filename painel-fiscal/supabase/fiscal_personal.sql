-- Meu Painel: conteúdo privado separado dos itens e do histórico da equipe.
begin;
create table public.fs_personal_items (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.fs_members(id),
 data jsonb not null,
 version integer not null default 1,
 deleted_at timestamptz
);
create index fs_personal_owner_active on public.fs_personal_items(owner_id) where deleted_at is null;
alter table public.fs_personal_items enable row level security;
revoke all on public.fs_personal_items from public,anon,authenticated;
grant select on public.fs_personal_items to authenticated;
grant all on public.fs_personal_items to service_role;
create policy fs_personal_read on public.fs_personal_items for select to authenticated
 using(owner_id=(select auth.uid()) and (select public.fs_is_member()) and deleted_at is null);

create function public.fs_get_personal() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(data||jsonb_build_object('id',id,'owner',owner_id,'version',version) order by data->>'createdAt' desc),'[]'::jsonb) from public.fs_personal_items where owner_id=auth.uid() and deleted_at is null;
$$;

-- Definer is needed only for atomic publication through the existing team write boundary.
-- Ownership comes from auth.uid(), never from the payload or an administrator override.
create function public.fs_save_personal(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fs_personal_items; b jsonb:=p_payload; ident uuid:=coalesce(p_id,gen_random_uuid());
 d jsonb; entry jsonb; checks jsonb:='[]'; start_day date; end_day date; shared uuid; actor text;
begin
 if auth.uid() is null or not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 if p_id is not null then
  select * into r from public.fs_personal_items where id=p_id and owner_id=auth.uid() and deleted_at is null for update;
  if not found then raise exception 'Atividade pessoal não encontrada.';end if;
  if (b->>'version')::integer is distinct from r.version then raise exception 'Esta atividade mudou em outra janela. Reabra antes de salvar.';end if;
 end if;
 if b->>'action'='delete' and p_id is not null then
  update public.fs_personal_items set deleted_at=now(),version=version+1 where id=p_id;return jsonb_build_object('ok',true);
 elsif b->>'action'='share' and p_id is not null then
  if r.data->>'sharedItemId' is not null then return jsonb_build_object('id',r.data->>'sharedItemId');end if;
  shared:=gen_random_uuid();
  select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'title',v->>'title','done',v->'done')),'[]'::jsonb) into checks from jsonb_array_elements(r.data->'activities') v;
  -- Explicit allowlist: private notes and identifiers never enter shared data/events.
  d:=jsonb_build_object('type','routine','title',r.data->>'title','description',r.data->>'description','owner',auth.uid(),'start',r.data->>'start','end',r.data->>'end','status',r.data->>'status','priority',r.data->>'priority','frequency','Única','activities',checks,'comments','[]'::jsonb,'executions','[]'::jsonb,'delegations','[]'::jsonb,'createdAt',now(),'updatedAt',now());
  insert into public.fs_items(id,data) values(shared,d);
  update public.fs_personal_items set data=data||jsonb_build_object('sharedItemId',shared,'sharedAt',now(),'updatedAt',now()),version=version+1 where id=p_id;
  select name into actor from public.fs_members where id=auth.uid();
  insert into public.fs_events("user",action,item) values(actor,'Compartilhou uma atividade pessoal',d->>'title');
  return jsonb_build_object('id',shared);
 end if;
 if coalesce(b->>'action','save')<>'save' then raise exception 'Operação inválida.';end if;
 start_day:=(b->>'start')::date;end_day:=(b->>'end')::date;
 if coalesce(length(trim(b->>'title')),0)=0 or length(b->>'title')>150 or start_day is null or end_day is null or end_day<start_day
  or coalesce(b->>'status','') not in ('Planejada','Em andamento','Concluída','Bloqueada') or coalesce(b->>'priority','') not in ('Baixa','Média','Alta')
  or jsonb_typeof(b->'activities') is distinct from 'array' then raise exception 'Revise nome, período, status e checklist.';end if;
 if jsonb_array_length(b->'activities')>50 then raise exception 'Limite de 50 itens no checklist.';end if;
 for entry in select value from jsonb_array_elements(b->'activities') loop
  if coalesce(length(trim(entry->>'title')),0)=0 then raise exception 'Preencha os itens do checklist.';end if;
  checks:=checks||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title',left(trim(entry->>'title'),200),'done',entry->'done'='true'::jsonb));
 end loop;
 d:=jsonb_build_object('title',trim(b->>'title'),'description',left(trim(coalesce(b->>'description','')),2000),'notes',left(trim(coalesce(b->>'notes','')),10000),'start',start_day,'end',end_day,'status',b->>'status','priority',b->>'priority','activities',checks,'updatedAt',now());
 if p_id is null then
  insert into public.fs_personal_items(id,owner_id,data) values(ident,auth.uid(),d||jsonb_build_object('createdAt',now()));
 else
  update public.fs_personal_items set data=r.data||d,version=version+1 where id=p_id;
 end if;
 return jsonb_build_object('id',ident);
end;$$;
revoke all on function public.fs_get_personal(),public.fs_save_personal(uuid,jsonb) from public,anon;
grant execute on function public.fs_get_personal(),public.fs_save_personal(uuid,jsonb) to authenticated;
commit;
