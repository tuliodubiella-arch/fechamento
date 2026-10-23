begin;
do $$
declare actor uuid; ident uuid; b jsonb; m jsonb; r public.fs_items; failed boolean;
begin
 select id into actor from public.fs_members where role='member' and active limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 ident:=(public.fs_create_item(jsonb_build_object('title','Anexos transacionais','type','routine','owner',actor,'start','2026-10-23','end','2026-10-23'))->>'id')::uuid;
 for b in select value from jsonb_array_elements('[{"ext":"pdf","type":"application/pdf"},{"ext":"xlsx","type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},{"ext":"docx","type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},{"ext":"xls","type":"application/vnd.ms-excel"},{"ext":"doc","type":"application/msword"}]') loop
 m:=public.fs_prepare_attachment(ident,'Apoio.'||(b->>'ext'),b->>'type',100);
 if right(m->>'path',length(b->>'ext')+1)<>'.'||(b->>'ext') then raise exception 'Extensão incorreta.';end if;
 insert into storage.objects(bucket_id,name,metadata) values('fiscal-prints',m->>'path',jsonb_build_object('size',100,'mimetype',b->>'type'));
 select * into r from public.fs_items where id=ident;
 perform public.fs_apply_item(ident,jsonb_build_object('action','comment','text','Documento de apoio','version',r.version,'attachments',jsonb_build_array(m->>'id')));
 select * into r from public.fs_items where id=ident;
 if r.data->'comments'->-1->'attachments'->0->>'type'<>b->>'type' then raise exception 'Documento não vinculado.';end if;
 end loop;
 failed:=false;begin perform public.fs_prepare_attachment(ident,'x.svg','image/svg+xml',100);exception when others then failed:=true;end;if not failed then raise exception 'Tipo não permitido aceito.';end if;
 failed:=false;begin perform public.fs_prepare_attachment(ident,'x.exe','application/pdf',100);exception when others then failed:=true;end;if not failed then raise exception 'Extensão incompatível aceita.';end if;
 failed:=false;begin perform public.fs_prepare_attachment(ident,'x.pdf','application/pdf',5242881);exception when others then failed:=true;end;if not failed then raise exception 'Arquivo acima do limite aceito.';end if;
 if exists(select 1 from storage.buckets where id='fiscal-prints' and (public or file_size_limit<>5242880)) then raise exception 'Privacidade ou limite do bucket mudou.';end if;
 perform set_config('request.jwt.claim.sub','',true);
 failed:=false;begin perform public.fs_prepare_attachment(ident,'x.pdf','application/pdf',100);exception when others then failed:=true;end;if not failed then raise exception 'Sem login anexou documento.';end if;
end;$$;
rollback;
