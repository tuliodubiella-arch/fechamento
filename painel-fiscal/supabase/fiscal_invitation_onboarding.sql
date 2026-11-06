begin;
-- Estado de primeiro acesso independente do fragmento descartável do convite.
create table public.fs_password_onboarding(
 user_id uuid primary key references auth.users(id) on delete cascade,
 required boolean not null default true,
 created_at timestamptz not null default now(),
 password_set_at timestamptz
);
alter table public.fs_password_onboarding enable row level security;
revoke all on public.fs_password_onboarding from public,anon,authenticated;
grant all on public.fs_password_onboarding to service_role;

create function public.fs_track_member_onboarding() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.fs_password_onboarding(user_id)
 select id from auth.users where id=new.id and invited_at is not null
 and (email_confirmed_at is null or (invited_at>now()-interval '5 minutes'
 and updated_at<=email_confirmed_at+interval '5 seconds'))
 on conflict(user_id) do nothing;
 return new;
end;$$;
revoke all on function public.fs_track_member_onboarding() from public,anon,authenticated;
create trigger fs_member_password_onboarding after insert on public.fs_members
 for each row execute function public.fs_track_member_onboarding();

-- O aceite do convite gera uma senha técnica temporária ANTES de confirmar o e-mail.
-- Somente uma alteração de senha após a confirmação conclui esta etapa.
create function public.fs_track_password_defined() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.email_confirmed_at is not null and new.encrypted_password is distinct from old.encrypted_password
 and coalesce(new.encrypted_password,'')<>'' then
  update public.fs_password_onboarding set required=false,password_set_at=now()
   where user_id=new.id and required;
 end if;
 return new;
end;$$;
revoke all on function public.fs_track_password_defined() from public,anon,authenticated;
create trigger fs_password_defined after update of encrypted_password on auth.users
 for each row execute function public.fs_track_password_defined();

create function public.fs_requires_password_setup() returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not public.fs_is_member() then raise exception 'Acesso negado.';end if;
 return coalesce((select required from public.fs_password_onboarding where user_id=auth.uid()),false);
end;$$;
revoke all on function public.fs_requires_password_setup() from public,anon;
grant execute on function public.fs_requires_password_setup() to authenticated;

commit;
