-- Exclusão lógica: preserva registros e anexos, retirando a entrega dos quadros ativos.
alter table public.fs_items add column deleted_at timestamptz,add column deleted_by uuid references public.fs_members(id);

create function public.fs_guard_deleted_item() returns trigger language plpgsql set search_path='' as $$
begin if old.deleted_at is not null then raise exception 'Esta rotina ou projeto já foi excluído.';end if;return new;end; $$;
create trigger fs_guard_deleted_item before update on public.fs_items for each row execute function public.fs_guard_deleted_item();
revoke all on function public.fs_guard_deleted_item() from public,anon,authenticated;

create function public.fs_guard_deleted_attachment() returns trigger language plpgsql set search_path='' as $$
begin perform id from public.fs_items where id=new.item_id and deleted_at is null for share;if not found then raise exception 'Esta rotina ou projeto já foi excluído.';end if;return new;end; $$;
create trigger fs_guard_deleted_attachment before insert on public.fs_attachments for each row execute function public.fs_guard_deleted_attachment();
revoke all on function public.fs_guard_deleted_attachment() from public,anon,authenticated;

create function public.fs_delete_item(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fs_items; actor text;
begin
 if not public.fs_is_admin() then raise exception 'Somente o administrador pode excluir rotinas e projetos.';end if;
 select * into r from public.fs_items where id=p_id for update;
 if not found or r.deleted_at is not null then raise exception 'Rotina ou projeto não encontrado ou já excluído.';end if;
 if p_version is distinct from r.version then raise exception 'Outra pessoa atualizou este registro. Recarregue os dados e confira antes de repetir.';end if;
 update public.fs_items set deleted_at=now(),deleted_by=auth.uid(),version=version+1 where id=p_id;
 select name into actor from public.fs_members where id=auth.uid();
 insert into public.fs_events("user",action,item) values(actor,case when r.data->>'type'='project' then 'Excluiu o projeto' else 'Excluiu a rotina' end,r.data->>'title');
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.fs_delete_item(uuid,integer) from public,anon;
grant execute on function public.fs_delete_item(uuid,integer) to authenticated;

create or replace function public.fs_get_state() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.fs_is_member() then raise exception 'Sua conta ainda não tem acesso ao fiscal. Solicite ao administrador.';end if;
 return jsonb_build_object('user',(select jsonb_build_object('id',id,'name',name,'email',email,'role',role) from public.fs_members where id=auth.uid()),'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'role',role) order by name) from public.fs_members where active),'[]'::jsonb),'items',coalesce((select jsonb_agg(data||jsonb_build_object('id',id,'version',version) order by data->>'createdAt') from public.fs_items where deleted_at is null),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e) order by at desc) from (select * from public.fs_events order by at desc limit 1000)e),'[]'::jsonb));
end; $$;
