begin;
create or replace function public.fs_edit_routine(p_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fs_items; b jsonb:=p_payload; actor text; start_day date; end_day date;
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 select * into r from public.fs_items where id=p_id and deleted_at is null for update;
 if not found or r.data->>'type' is distinct from 'routine' or coalesce(r.data->>'groupId','')<>'' then raise exception 'Rotina não encontrada. Para registros de grupos, use Editar dados.';end if;
 if (b->>'version')::integer is distinct from r.version then raise exception 'Outra pessoa atualizou esta rotina. Reabra antes de salvar.';end if;
 if b->>'action' is distinct from 'routine-edit' then raise exception 'Operação inválida.';end if;
 if coalesce(length(trim(b->>'title')),0) not between 1 and 150 or length(coalesce(b->>'description',''))>2000
 or not exists(select 1 from public.fs_members where id=(b->>'owner')::uuid and active)
 or coalesce(b->>'priority','') not in ('Baixa','Média','Alta') or coalesce(b->>'frequency','') not in ('Diária','Semanal','Mensal','Única')
 or coalesce(b->>'start','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(b->>'end','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Revise nome, responsável e período da rotina.';end if;
 start_day:=(b->>'start')::date;end_day:=(b->>'end')::date;
 if end_day<start_day then raise exception 'A conclusão deve ser igual ou posterior ao início.';end if;
 update public.fs_items set data=data||jsonb_build_object('title',trim(b->>'title'),'description',coalesce(b->>'description',''),'owner',b->>'owner','priority',b->>'priority','frequency',b->>'frequency','start',start_day,'end',end_day,'updatedAt',now()),version=version+1 where id=p_id;
 select name into actor from public.fs_members where id=auth.uid();
 insert into public.fs_events("user",action,item) values(actor,'Alterou dados da rotina',trim(b->>'title'));
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.fs_edit_routine(uuid,jsonb) from public,anon;
grant execute on function public.fs_edit_routine(uuid,jsonb) to authenticated;
commit;
