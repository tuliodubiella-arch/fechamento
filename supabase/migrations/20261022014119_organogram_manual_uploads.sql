begin;

create table if not exists public.org_manuals (
  id uuid primary key default gen_random_uuid(),
  routine_id text not null check (length(trim(routine_id)) between 1 and 160),
  area text not null check (area in ('contabil', 'fiscal')),
  role text not null default 'principal' check (role in ('principal', 'adicional')),
  item text check (item is null or length(trim(item)) between 1 and 160),
  title text not null check (length(trim(title)) between 1 and 200),
  file_name text not null check (
    (area = 'contabil' and file_name ~* '^POPCON - .+\.docx$')
    or
    (area = 'fiscal' and file_name ~* '^POPFIS - .+\.docx$')
  ),
  storage_path text not null unique,
  file_size integer not null check (file_size between 1 and 20971520),
  uploaded_by uuid not null references public.fc_members(id),
  created_at timestamptz not null default clock_timestamp(),
  check ((role = 'principal') or (item is not null))
);

alter table public.org_manuals enable row level security;

revoke all on table public.org_manuals from public, anon;
grant select, insert, delete on table public.org_manuals to authenticated;

drop policy if exists org_manuals_read on public.org_manuals;
create policy org_manuals_read on public.org_manuals
  for select to authenticated
  using ((select public.fc_is_member()));

drop policy if exists org_manuals_insert on public.org_manuals;
create policy org_manuals_insert on public.org_manuals
  for insert to authenticated
  with check ((select public.fc_is_admin()) and uploaded_by = (select auth.uid()));

drop policy if exists org_manuals_delete on public.org_manuals;
create policy org_manuals_delete on public.org_manuals
  for delete to authenticated
  using ((select public.fc_is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-manuals',
  'org-manuals',
  false,
  20971520,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists org_manuals_storage_read on storage.objects;
create policy org_manuals_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'org-manuals' and (select public.fc_is_member()));

drop policy if exists org_manuals_storage_insert on storage.objects;
create policy org_manuals_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'org-manuals' and (select public.fc_is_admin()));

drop policy if exists org_manuals_storage_delete on storage.objects;
create policy org_manuals_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'org-manuals' and (select public.fc_is_admin()));

-- Existing cross-bucket guard policies are permissive (combined with OR by Postgres).
-- Exclude the manuals bucket so its admin-only policies remain effective.
drop policy if exists fc_receipt_evidence_insert_guard on storage.objects;
create policy fc_receipt_evidence_insert_guard on storage.objects
  for insert to authenticated
  with check (
    bucket_id not in ('fc-receipt-evidence', 'org-manuals')
    or (
      bucket_id = 'fc-receipt-evidence'
      and (select public.fc_is_member())
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

drop policy if exists fc_receipt_evidence_read_guard on storage.objects;
create policy fc_receipt_evidence_read_guard on storage.objects
  for select to authenticated
  using (
    bucket_id not in ('fc-receipt-evidence', 'org-manuals')
    or (bucket_id = 'fc-receipt-evidence' and (select public.fc_is_member()))
  );

drop policy if exists fs_storage_insert_guard on storage.objects;
create policy fs_storage_insert_guard on storage.objects
  for insert to authenticated
  with check (
    bucket_id not in ('fiscal-prints', 'org-manuals')
    or (
      bucket_id = 'fiscal-prints'
      and public.fs_is_member()
      and exists (
        select 1 from public.fs_attachments a
        where a.path = storage.objects.name
          and a.uploaded_by = (select auth.uid())
          and not a.committed
      )
    )
  );

drop policy if exists fs_storage_read_guard on storage.objects;
create policy fs_storage_read_guard on storage.objects
  for select to authenticated
  using (
    bucket_id not in ('fiscal-prints', 'org-manuals')
    or (
      bucket_id = 'fiscal-prints'
      and public.fs_is_member()
      and exists (
        select 1 from public.fs_attachments a
        where a.path = storage.objects.name
          and (a.committed or a.uploaded_by = (select auth.uid()))
      )
    )
  );

drop policy if exists fs_storage_delete_guard on storage.objects;
create policy fs_storage_delete_guard on storage.objects
  for delete to authenticated
  using (
    bucket_id not in ('fiscal-prints', 'org-manuals')
    or (
      bucket_id = 'fiscal-prints'
      and public.fs_is_member()
      and exists (
        select 1 from public.fs_attachments a
        where a.path = storage.objects.name
          and a.uploaded_by = (select auth.uid())
          and not a.committed
      )
    )
  );

commit;
