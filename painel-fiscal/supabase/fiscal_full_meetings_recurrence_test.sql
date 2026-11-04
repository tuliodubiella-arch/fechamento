begin;
do $test$
declare member_id uuid; ident uuid; next_id uuid; third_id uuid; group_id uuid; stage_open text; stage_done text;
 d jsonb; payload jsonb; meeting_id uuid; long_text text; rejected boolean;
begin
 select id into member_id from public.fs_members where active order by (role='member') desc limit 1;
 if member_id is null then raise exception 'Teste requer um membro ativo.';end if;
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 if has_function_privilege('anon','public.fs_generate_recurrence()','EXECUTE')
 or has_function_privilege('authenticated','public.fs_next_recurrence_date(date,text,integer)','EXECUTE') then raise exception 'Permissões indevidas.';end if;
 payload:=jsonb_build_object('type','routine','title','Teste transacional de recorrência','owner',member_id,'start','2026-01-31','end','2026-01-31','frequency','Mensal','priority','Alta');
 ident:=(public.fs_create_item(payload)->>'id')::uuid;
 perform public.fs_apply_item(ident,jsonb_build_object('action','activity','title','Conferir','version',1));
 perform public.fs_apply_item(ident,jsonb_build_object('action','comment','text','Preservar histórico','version',2));
 perform public.fs_apply_item(ident,jsonb_build_object('action','status','status','Concluída','version',3));
 select data into d from public.fs_items where id=ident;next_id:=(d->>'recurrenceNextId')::uuid;
 if next_id is null or jsonb_array_length(d->'comments')<>1 then raise exception 'Histórico ou próxima ocorrência ausente.';end if;
 select data into d from public.fs_items where id=next_id;
 if d->>'start'<>'2026-02-28' or d->>'end'<>'2026-02-28' or d->>'status'<>'Planejada'
 or jsonb_array_length(d->'comments')<>0 or d->'activities'->0->>'done'<>'false' then raise exception 'Nova ocorrência incorreta.';end if;
 rejected:=false;begin perform public.fs_apply_item(ident,jsonb_build_object('action','status','status','Concluída','version',3));exception when others then rejected:=true;end;
 if not rejected then raise exception 'Concorrência ignorada.';end if;
 perform public.fs_apply_item(ident,jsonb_build_object('action','status','status','Planejada','version',4));
 perform public.fs_apply_item(ident,jsonb_build_object('action','status','status','Concluída','version',5));
 if (select count(*) from public.fs_items where data->>'recurrencePreviousId'=ident::text)<>1 then raise exception 'Reabrir duplicou ocorrência.';end if;
 perform public.fs_apply_item(next_id,jsonb_build_object('action','status','status','Concluída','version',1));
 select (data->>'recurrenceNextId')::uuid into third_id from public.fs_items where id=next_id;
 if (select data->>'start' from public.fs_items where id=third_id)<>'2026-03-31' then raise exception 'Âncora de fim de mês perdida.';end if;
 if public.fs_next_recurrence_date('2028-01-31','Mensal',31)<>'2028-02-29' or public.fs_next_recurrence_date('2026-12-31','Diária',31)<>'2027-01-01' or public.fs_next_recurrence_date('2026-12-28','Semanal',28)<>'2027-01-04' then raise exception 'Calendário incorreto.';end if;
 -- Uma rotina única e um projeto não geram ocorrências.
 ident:=(public.fs_create_item(payload||jsonb_build_object('frequency','Única'))->>'id')::uuid;
 perform public.fs_apply_item(ident,jsonb_build_object('action','status','status','Concluída','version',1));
 if (select data ? 'recurrenceNextId' from public.fs_items where id=ident) then raise exception 'Rotina única repetida.';end if;
 ident:=(public.fs_create_item(payload||jsonb_build_object('type','project'))->>'id')::uuid;
 perform public.fs_apply_item(ident,jsonb_build_object('action','status','status','Concluída','version',1));
 if (select data ? 'recurrenceNextId' from public.fs_items where id=ident) then raise exception 'Projeto repetido.';end if;
 -- Conclusão pela etapa do grupo usa o mesmo mecanismo.
 group_id:=(public.fs_create_group(jsonb_build_object('title','Grupo transacional','owner',member_id,'stages',jsonb_build_array(jsonb_build_object('name','Preparar','status','Planejada'),jsonb_build_object('name','Finalizado','status','Concluída'))))->>'id')::uuid;
 select data->'stages'->0->>'id',data->'stages'->1->>'id' into stage_open,stage_done from public.fs_groups where id=group_id;
 ident:=(public.fs_create_group_record(payload||jsonb_build_object('groupId',group_id,'start','2026-10-01','end','2026-10-13'))->>'id')::uuid;
 perform public.fs_update_record(ident,jsonb_build_object('action','record-stage','stageId',stage_done,'version',2));
 select data into d from public.fs_items where id=(select (data->>'recurrenceNextId')::uuid from public.fs_items where id=ident);
 if d->>'stageId'<>stage_open or d->>'start'<>'2026-11-01' or d->>'end'<>'2026-11-13' then raise exception 'Grupo ou datas não preservados.';end if;
 -- Ata integral maior que um milhão de caracteres e mais de 100 ações.
 long_text:='Início da ata.'||repeat(' Conteúdo completo da reunião.',40000)||' Fim da ata.';
 payload:=jsonb_build_object('action','save','title','Ata extensa transacional','date','2026-11-04','minutes',long_text,'topics','','summary','','decisions','','attendees',jsonb_build_array(member_id),'actions',(select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'title','Ação '||n,'owner',member_id,'start','2026-11-04','end','2026-11-05')) from generate_series(1,101)n));
 meeting_id:=(public.fs_save_meeting(null,payload)->>'id')::uuid;
 if (select data->>'minutes' from public.fs_meetings where id=meeting_id)<>long_text then raise exception 'Texto integral perdido.';end if;
 perform public.fs_save_meeting(meeting_id,payload||jsonb_build_object('action','finalize','version',1));
 if (select count(*) from public.fs_items where data->>'meetingId'=meeting_id::text)<>101 then raise exception 'Ações não finalizadas integralmente.';end if;
 perform set_config('request.jwt.claim.sub','',true);rejected:=false;
 begin perform public.fs_create_item(payload);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Acesso sem login permitido.';end if;
end;$test$;
select 'ok: texto integral, 101 ações, recorrência, calendário, etapas, histórico, idempotência e acesso' as result;
rollback;
