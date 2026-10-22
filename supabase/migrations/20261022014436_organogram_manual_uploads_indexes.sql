create index if not exists org_manuals_uploaded_by_idx
  on public.org_manuals (uploaded_by);

create index if not exists org_manuals_routine_id_idx
  on public.org_manuals (routine_id);
