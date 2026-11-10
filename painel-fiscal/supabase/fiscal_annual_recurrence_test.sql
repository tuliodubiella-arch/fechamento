begin;
do $$
declare actor uuid; ident uuid; next_id uuid; group_id uuid; done_stage text; d jsonb; payload jsonb;
begin
 select id into actor from public.fs_members where active and role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 payload:=jsonb_build_object('type','routine','title','Teste anual transacional','owner',actor,'priority','Alta','frequency','Anual','start','2026-09-01','end','2026-12-31');
 ident:=(public.fs_create_item(payload)->>'id')::uuid;
 select data into d from public.fs_items where id=ident;
 if d->>'frequency'<>'Anual' then raise exception 'Frequência anual não foi salva.';end if;
 perform public.fs_edit_routine(ident,payload||jsonb_build_object('action','routine-edit','version',1));
 perform public.fs_apply_item(ident,jsonb_build_object('action','status','status','Concluída','version',2));
 select (data->>'recurrenceNextId')::uuid into next_id from public.fs_items where id=ident;
 select data into d from public.fs_items where id=next_id;
 if d is null or d->>'start'<>'2027-09-01' or d->>'end'<>'2027-12-31' or d->>'frequency'<>'Anual' then raise exception 'Próximo ano incorreto.';end if;
 if public.fs_next_recurrence_date('2024-02-29','Anual',29)<>'2025-02-28' or public.fs_next_recurrence_date('2027-02-28','Anual',29)<>'2028-02-29' then raise exception 'Ano bissexto incorreto.';end if;
 group_id:=(public.fs_create_group(jsonb_build_object('title','Teste anual de grupo','owner',actor,'stages',jsonb_build_array(jsonb_build_object('name','Validar','status','Planejada'),jsonb_build_object('name','Finalizado','status','Concluída'))))->>'id')::uuid;
 ident:=(public.fs_create_group_record(payload||jsonb_build_object('groupId',group_id))->>'id')::uuid;
 perform public.fs_edit_group_item(ident,payload||jsonb_build_object('action','record-edit','version',2));
 select data->'stages'->1->>'id' into done_stage from public.fs_groups where id=group_id;
 perform public.fs_update_record(ident,jsonb_build_object('action','record-stage','stageId',done_stage,'version',3));
 select data into d from public.fs_items where id=(select (data->>'recurrenceNextId')::uuid from public.fs_items where id=ident);
 if d is null or d->>'groupId'<>group_id::text or d->>'start'<>'2027-09-01' or d->>'status'<>'Planejada' then raise exception 'Próxima ocorrência do grupo incorreta.';end if;
end;$$;
select 'ok: anual, criação, edição, grupos, próxima ocorrência e ano bissexto' as result;
rollback;
