begin;
alter table public.fs_attachments drop constraint fs_attachments_type_check;
alter table public.fs_attachments add constraint fs_attachments_type_check check(type in ('image/png','image/jpeg','image/webp','application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
update storage.buckets set allowed_mime_types=array['image/png','image/jpeg','image/webp','application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'] where id='fiscal-prints';
create or replace function public.fs_prepare_attachment(p_item uuid,p_name text,p_type text,p_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare ident uuid:=gen_random_uuid(); object_path text; m public.fs_attachments; ext text; expected text;
begin
 if not public.fs_is_member() or not exists(select 1 from public.fs_items where id=p_item and deleted_at is null) then raise exception 'Acesso negado.';end if;
 ext:=substring(lower(trim(p_name)) from '\.([a-z0-9]+)$');
 expected:=case ext when 'png' then 'image/png' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg' when 'webp' then 'image/webp' when 'pdf' then 'application/pdf' when 'xls' then 'application/vnd.ms-excel' when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' when 'doc' then 'application/msword' when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end;
 if expected is null or p_type is distinct from expected or p_size is null or p_size not between 1 and 5242880 then raise exception 'Use imagens, Excel (XLS/XLSX), Word (DOC/DOCX) ou PDF de até 5 MB.';end if;
 object_path:=auth.uid()::text||'/'||ident::text||'.'||ext;
 insert into public.fs_attachments(id,item_id,uploaded_by,name,type,size,path) values(ident,p_item,auth.uid(),left(trim(p_name),150),p_type,p_size,object_path) returning * into m;
 return jsonb_build_object('id',m.id,'path',m.path,'name',m.name,'type',m.type,'size',m.size);
end;$$;
revoke all on function public.fs_prepare_attachment(uuid,text,text,integer) from public,anon;
grant execute on function public.fs_prepare_attachment(uuid,text,text,integer) to authenticated;
commit;
