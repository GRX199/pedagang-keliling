create extension if not exists pgcrypto;

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_unique unique (buyer_id, vendor_id)
);

create index if not exists favorites_buyer_created_idx
  on public.favorites (buyer_id, created_at desc);

create index if not exists favorites_vendor_idx
  on public.favorites (vendor_id);

alter table public.favorites enable row level security;

drop policy if exists "favorites_own_read" on public.favorites;
create policy "favorites_own_read"
on public.favorites
for select
to authenticated
using (auth.uid() = buyer_id);

drop policy if exists "favorites_own_insert" on public.favorites;
create policy "favorites_own_insert"
on public.favorites
for insert
to authenticated
with check (auth.uid() = buyer_id);

drop policy if exists "favorites_own_delete" on public.favorites;
create policy "favorites_own_delete"
on public.favorites
for delete
to authenticated
using (auth.uid() = buyer_id);
