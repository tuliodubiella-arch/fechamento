begin;
create table public.fs_meetings (
 id uuid primary key default gen_random_uuid(),created_by uuid not null references public.fs_members(id),
 data jsonb not null,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.fs_meetings enable row level security;
create policy fs_meetings_read on public.fs_meetings for select to authenticated using((select public.fs_is_member()));
revoke all on public.fs_meetings from anon,authenticated;
grant select on public.fs_meetings to authenticated;
grant all on public.fs_meetings to service_role;

create function public.fs_get_meetings() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 return coalesce((select jsonb_agg(data||jsonb_build_object('id',id,'version',version,'createdBy',created_by,'createdAt',created_at,'updatedAt',updated_at) order by data->>'date' desc,created_at desc) from public.fs_meetings),'[]'::jsonb);
end;$$;

create function public.fs_save_meeting(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fs_meetings; ident uuid:=coalesce(p_id,gen_random_uuid()); b jsonb:=p_payload; d jsonb; act text:=p_payload->>'action';
 a jsonb; actions jsonb:='[]'; attendees jsonb; item_id uuid; actor text; day date; start_day date; end_day date; aid text; owner_id text;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 if act not in ('save','finalize','comment') or act is null then raise exception 'Operação inválida.';end if;
 select name into actor from public.fs_members where id=auth.uid();
 if p_id is not null then
  select * into r from public.fs_meetings where id=p_id for update;
  if not found then raise exception 'Reunião não encontrada.';end if;
  -- Repetir uma finalização já concluída nunca duplica as rotinas.
  if act='finalize' and r.data->>'status'='Finalizada' then return jsonb_build_object('id',p_id,'created',jsonb_array_length(r.data->'actions'),'alreadyFinalized',true);end if;
  if (b->>'version')::integer is distinct from r.version then raise exception 'Outra pessoa atualizou esta reunião. Reabra antes de salvar.';end if;
 end if;
 if act='comment' then
  if p_id is null or coalesce(length(trim(b->>'text')),0) not between 1 and 2000 then raise exception 'Informe um acompanhamento de até 2.000 caracteres.';end if;
  update public.fs_meetings set data=jsonb_set(data,'{comments}',coalesce(data->'comments','[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'text',trim(b->>'text'),'author',actor,'at',now()))),version=version+1,updated_at=now() where id=p_id;
  insert into public.fs_events("user",action,item) values(actor,'Registrou acompanhamento da reunião',r.data->>'title');
  return jsonb_build_object('id',p_id);
 end if;
 if p_id is not null and r.data->>'status'='Finalizada' then raise exception 'A ata foi finalizada. Registre novos acompanhamentos sem alterar a ata original.';end if;
 if coalesce(length(trim(b->>'title')),0) not between 1 and 150 or coalesce(b->>'date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or length(coalesce(b->>'topics',''))>10000 or length(coalesce(b->>'minutes',''))>50000 or length(coalesce(b->>'decisions',''))>10000 or length(coalesce(b->>'summary',''))>4000 then raise exception 'Revise título, data e os limites dos campos da ata.';end if;
 day:=(b->>'date')::date;
 attendees:=coalesce(b->'attendees','[]'::jsonb);
 if jsonb_typeof(attendees) is distinct from 'array' then raise exception 'Participantes inválidos.';end if;
 if exists(select 1 from jsonb_array_elements_text(attendees) x where not exists(select 1 from public.fs_members m where m.id::text=x.value and m.active)) then raise exception 'Selecione participantes cadastrados e ativos.';end if;
 if jsonb_typeof(b->'actions') is distinct from 'array' or jsonb_array_length(b->'actions')>100 then raise exception 'Informe até 100 ações por reunião.';end if;
 for a in select value from jsonb_array_elements(b->'actions') loop
  aid:=coalesce(nullif(a->>'id',''),gen_random_uuid()::text);perform aid::uuid;
  if exists(select 1 from jsonb_array_elements(actions) x where x->>'id'=aid) then raise exception 'Ações repetidas na ata.';end if;
  if coalesce(length(trim(a->>'title')),0) not between 1 and 150 or length(coalesce(a->>'description',''))>2000 then raise exception 'Preencha o nome de cada ação, com até 150 caracteres.';end if;
  owner_id:=nullif(a->>'owner','');start_day:=null;end_day:=null;
  if owner_id is not null and not exists(select 1 from public.fs_members where id::text=owner_id and active) then raise exception 'Responsável não encontrado ou inativo.';end if;
  if coalesce(a->>'start','')<>'' then start_day:=(a->>'start')::date;end if;
  if coalesce(a->>'end','')<>'' then end_day:=(a->>'end')::date;end if;
  if end_day<start_day then raise exception 'O prazo da ação deve ser igual ou posterior ao início.';end if;
  if act='finalize' and (owner_id is null or start_day is null or end_day is null) then raise exception 'Antes de finalizar, defina responsável, início e prazo de todas as ações.';end if;
  actions:=actions||jsonb_build_array(jsonb_build_object('id',aid,'title',trim(a->>'title'),'description',coalesce(a->>'description',''),'owner',owner_id,'start',start_day,'end',end_day,'priority',case when a->>'priority' in ('Baixa','Média','Alta') then a->>'priority' else 'Média' end));
 end loop;
 if act='finalize' and coalesce(length(trim(b->>'minutes')),0)=0 then raise exception 'Registre a ata antes de finalizar.';end if;
 d:=jsonb_build_object('title',trim(b->>'title'),'date',day,'attendees',attendees,'topics',coalesce(b->>'topics',''),'minutes',coalesce(b->>'minutes',''),'summary',coalesce(b->>'summary',''),'decisions',coalesce(b->>'decisions',''),'actions',actions,'status','Rascunho','comments',coalesce(r.data->'comments','[]'::jsonb));
 if p_id is null then insert into public.fs_meetings(id,created_by,data) values(ident,auth.uid(),d);
 else update public.fs_meetings set data=d,version=version+1,updated_at=now() where id=ident;end if;
 if act='finalize' then
  actions:='[]';
  for a in select value from jsonb_array_elements(d->'actions') loop
   item_id:=(public.fs_create_item(a||jsonb_build_object('type','routine','frequency','Única','description',left(coalesce(a->>'description','')||E'\n\nOrigem: reunião '||(d->>'title')||' de '||to_char(day,'DD/MM/YYYY')||'.',2000)))->>'id')::uuid;
   update public.fs_items set data=data||jsonb_build_object('meetingId',ident,'meetingActionId',a->>'id') where id=item_id;
   actions:=actions||jsonb_build_array(a||jsonb_build_object('routineId',item_id));
  end loop;
  update public.fs_meetings set data=d||jsonb_build_object('status','Finalizada','actions',actions,'finalizedAt',now(),'finalizedBy',auth.uid()),updated_at=now() where id=ident;
 end if;
 insert into public.fs_events("user",action,item) values(actor,case when act='finalize' then 'Finalizou reunião e criou '||jsonb_array_length(actions)||' rotinas' else 'Salvou rascunho da reunião' end,d->>'title');
 return jsonb_build_object('id',ident,'created',case when act='finalize' then jsonb_array_length(actions) else 0 end);
end;$$;
revoke all on function public.fs_get_meetings(),public.fs_save_meeting(uuid,jsonb) from public,anon;
grant execute on function public.fs_get_meetings(),public.fs_save_meeting(uuid,jsonb) to authenticated;
commit;
