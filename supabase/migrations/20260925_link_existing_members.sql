-- Vincula responsáveis convidados antes da implantação de atribuições mensais.
update public.fc_tasks t set responsible_id = m.id, responsible_legacy_name = null
from public.fc_members m
where m.active and t.responsible_id is null and t.responsible_legacy_name is not null
  and (lower(btrim(t.responsible_legacy_name)) = lower(btrim(m.name))
    or lower(btrim(t.responsible_legacy_name)) = lower(btrim(coalesce(m.legacy_name, m.name))));

update public.fc_month_owners o set responsible_id = m.id, responsible_legacy_name = null
from public.fc_members m
where m.active and o.responsible_id is null and o.responsible_legacy_name is not null
  and (lower(btrim(o.responsible_legacy_name)) = lower(btrim(m.name))
    or lower(btrim(o.responsible_legacy_name)) = lower(btrim(coalesce(m.legacy_name, m.name))));
