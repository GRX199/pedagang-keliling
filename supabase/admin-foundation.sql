create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists account_status text not null default 'active';

alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'suspended', 'blocked'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null,
  entity_type text not null default 'vendor',
  entity_id uuid,
  note text,
  created_at timestamptz not null default now()
);

alter table public.admin_actions enable row level security;

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "vendors_admin_update" on public.vendors;
create policy "vendors_admin_update"
on public.vendors
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admin_actions_admin_read" on public.admin_actions;
create policy "admin_actions_admin_read"
on public.admin_actions
for select
to authenticated
using (public.is_admin());

drop policy if exists "admin_actions_admin_insert" on public.admin_actions;
create policy "admin_actions_admin_insert"
on public.admin_actions
for insert
to authenticated
with check (public.is_admin() and auth.uid() = admin_id);

create index if not exists profiles_account_status_idx
  on public.profiles (account_status);

create index if not exists admin_actions_target_created_idx
  on public.admin_actions (target_user_id, created_at desc);

