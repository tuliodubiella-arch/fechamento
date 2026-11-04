begin;
-- Retira apenas os limites do texto integral e da quantidade de encaminhamentos.
-- Mantém autenticação, concorrência, validação de responsáveis e finalização atômica.
do $upgrade$
declare definition text;
begin
 select pg_get_functiondef('public.fs_save_meeting(uuid,jsonb)'::regprocedure) into definition;
 if position('or length(coalesce(b->>''minutes'',''''))>50000' in definition)=0 then
  raise exception 'Definição de fs_save_meeting diferente da esperada. Revise antes de aplicar.';
 end if;
 definition:=replace(definition,'or length(coalesce(b->>''minutes'',''''))>50000 ','');
 definition:=replace(definition,' or jsonb_array_length(b->''actions'')>100','');
 definition:=replace(definition,'Informe até 100 ações por reunião.','Informe uma lista válida de ações.');
 execute definition;
end;$upgrade$;

-- O índice inclui ocorrências arquivadas: reabrir ou excluir não gera duplicação.
create unique index fs_recurrence_previous_once on public.fs_items ((data->>'recurrencePreviousId'))
 where data->>'recurrencePreviousId' is not null;

create function public.fs_next_recurrence_date(p_day date,p_frequency text,p_anchor integer)
returns date language sql immutable set search_path='' as $$
 select case p_frequency
 when 'Diária' then p_day+1
 when 'Semanal' then p_day+7
 when 'Mensal' then (date_trunc('month',p_day)+interval '1 month')::date
   +least(p_anchor,extract(day from (date_trunc('month',p_day)+interval '2 months - 1 day'))::integer)-1
 end;
$$;
revoke all on function public.fs_next_recurrence_date(date,text,integer) from public,anon,authenticated;

-- Invoker: o gatilho roda no mesmo contexto das funções existentes de atualização.
create function public.fs_generate_recurrence() returns trigger language plpgsql set search_path='' as $$
declare d jsonb; ident uuid; stage jsonb; g public.fs_groups; actor text; start_anchor integer; end_anchor integer;
begin
 if new.data->>'start' is distinct from old.data->>'start' or new.data->>'end' is distinct from old.data->>'end'
 or new.data->>'frequency' is distinct from old.data->>'frequency' then
  new.data:=new.data-'recurrenceStartDay'-'recurrenceEndDay';
 end if;
 if new.deleted_at is not null or new.data->>'type' is distinct from 'routine'
 or new.data->>'status' is distinct from 'Concluída' or old.data->>'status'='Concluída'
 or coalesce(new.data->>'frequency','') not in ('Diária','Semanal','Mensal') then return new;end if;
 if coalesce(new.data->>'recurrenceNextId','')<>'' then return new;end if;
 select id into ident from public.fs_items where data->>'recurrencePreviousId'=new.id::text;
 if found then new.data:=new.data||jsonb_build_object('recurrenceNextId',ident);return new;end if;
 if not exists(select 1 from public.fs_members where id::text=new.data->>'owner' and active) then
  raise exception 'Defina um responsável ativo antes de concluir esta rotina recorrente.';
 end if;
 ident:=gen_random_uuid();
 start_anchor:=coalesce((new.data->>'recurrenceStartDay')::integer,extract(day from (new.data->>'start')::date)::integer);
 end_anchor:=coalesce((new.data->>'recurrenceEndDay')::integer,extract(day from (new.data->>'end')::date)::integer);
 d:=(new.data-'recurrenceNextId'-'deletedAt'-'deletedBy')||jsonb_build_object(
 'start',public.fs_next_recurrence_date((new.data->>'start')::date,new.data->>'frequency',start_anchor),
 'end',public.fs_next_recurrence_date((new.data->>'end')::date,new.data->>'frequency',end_anchor),
 'status','Planejada','recurrencePreviousId',new.id,'recurrenceRootId',coalesce(new.data->>'recurrenceRootId',new.id::text),
 'recurrenceStartDay',start_anchor,'recurrenceEndDay',end_anchor,
 'activities',coalesce((select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'title',a->>'title','done',false) order by ordinal)
  from jsonb_array_elements(coalesce(new.data->'activities','[]')) with ordinality as entries(a,ordinal)),'[]'::jsonb),
 'comments','[]'::jsonb,'executions','[]'::jsonb,'delegations','[]'::jsonb,'protocol','',
 'createdAt',now(),'updatedAt',now());
 if coalesce(d->>'groupId','')<>'' then
  select * into g from public.fs_groups where id=(d->>'groupId')::uuid and deleted_at is null for share;
  if not found then raise exception 'Grupo não encontrado ou excluído.';end if;
  select value into stage from jsonb_array_elements(g.data->'stages') with ordinality as stages(value,ordinal)
   where value->>'status'<>'Concluída' order by ordinal limit 1;
  if stage is null then raise exception 'O grupo precisa de uma etapa aberta para receber a próxima ocorrência.';end if;
  d:=d||jsonb_build_object('stageId',stage->>'id','status',stage->>'status');
 end if;
 insert into public.fs_items(id,data,version) values(ident,d,1);
 new.data:=new.data||jsonb_build_object('recurrenceNextId',ident);
 select name into actor from public.fs_members where id=auth.uid();
 insert into public.fs_events("user",action,item) values(coalesce(actor,'Sistema'),'Criou automaticamente a próxima ocorrência ('||(d->>'start')||' a '||(d->>'end')||')',d->>'title');
 return new;
end;$$;
revoke all on function public.fs_generate_recurrence() from public,anon,authenticated;
create trigger fs_recurrence_on_completion before update on public.fs_items for each row execute function public.fs_generate_recurrence();
commit;
