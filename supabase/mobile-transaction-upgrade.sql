create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  role text not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('customer', 'vendor'))
);

create index if not exists profiles_role_idx
  on public.profiles (role);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

insert into public.profiles (id, display_name, avatar_url, role)
select
  user_record.id,
  coalesce(
    nullif(trim(user_record.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(split_part(user_record.email, '@', 1)), ''),
    'Pengguna'
  ),
  nullif(trim(user_record.raw_user_meta_data ->> 'avatar_url'), ''),
  case
    when coalesce(user_record.raw_user_meta_data ->> 'role', '') = 'vendor'
      or coalesce(user_record.raw_user_meta_data ->> 'is_vendor', 'false') = 'true'
    then 'vendor'
    else 'customer'
  end
from auth.users as user_record
on conflict (id) do update
set
  display_name = excluded.display_name,
  avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
  role = excluded.role,
  updated_at = now();

alter table public.profiles enable row level security;

drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read"
on public.profiles
for select
to anon, authenticated
using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

do $$
begin
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then
    null;
  end;
end
$$;
