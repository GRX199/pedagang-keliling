create extension if not exists pgcrypto;

create or replace function public.sort_uuid_array(input uuid[])
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(value order by value), '{}'::uuid[])
  from unnest(input) as value;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.vendors (
  id uuid primary key references auth.users(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  description text,
  photo_url text,
  location jsonb,
  online boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendors_same_user check (id = user_id)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  role text not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('customer', 'vendor'))
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2),
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_price_non_negative check (price is null or price >= 0)
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  participants uuid[] not null,
  participants_normalized uuid[] generated always as (public.sort_uuid_array(participants)) stored,
  last_updated timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chats_two_participants check (array_length(participants_normalized, 1) = 2),
  constraint chats_distinct_participants check (participants_normalized[1] <> participants_normalized[2])
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  constraint messages_not_empty check (length(trim(text)) > 0)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  vendor_name text,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  buyer_name text,
  items text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_items_not_empty check (length(trim(items)) > 0),
  constraint orders_valid_status check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  constraint orders_buyer_not_vendor check (buyer_id <> vendor_id)
);

create unique index if not exists chats_unique_participants_idx
  on public.chats (participants_normalized);

create index if not exists profiles_role_idx
  on public.profiles (role);

create index if not exists chats_participants_gin_idx
  on public.chats using gin (participants);

create index if not exists products_vendor_created_at_idx
  on public.products (vendor_id, created_at desc);

create index if not exists messages_chat_created_at_idx
  on public.messages (chat_id, created_at asc);

create index if not exists orders_vendor_created_at_idx
  on public.orders (vendor_id, created_at desc);

create index if not exists orders_buyer_created_at_idx
  on public.orders (buyer_id, created_at desc);

drop trigger if exists vendors_set_updated_at on public.vendors;
create trigger vendors_set_updated_at
before update on public.vendors
for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists chats_set_updated_at on public.chats;
create trigger chats_set_updated_at
before update on public.chats
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.handle_vendor_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') = 'vendor'
     or coalesce(new.raw_user_meta_data ->> 'is_vendor', 'false') = 'true' then
    insert into public.vendors (id, user_id, name)
    values (
      new.id,
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Pedagang')
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_vendor on auth.users;
create trigger on_auth_user_created_vendor
after insert on auth.users
for each row execute function public.handle_vendor_signup();

insert into public.vendors (id, user_id, name)
select
  user_record.id,
  user_record.id,
  coalesce(nullif(trim(user_record.raw_user_meta_data ->> 'full_name'), ''), 'Pedagang')
from auth.users as user_record
where coalesce(user_record.raw_user_meta_data ->> 'role', '') = 'vendor'
   or coalesce(user_record.raw_user_meta_data ->> 'is_vendor', 'false') = 'true'
on conflict (id) do nothing;

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

alter table public.vendors enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.orders enable row level security;

drop policy if exists "vendors_public_read" on public.vendors;
create policy "vendors_public_read"
on public.vendors
for select
to anon, authenticated
using (true);

drop policy if exists "vendors_insert_own_row" on public.vendors;
create policy "vendors_insert_own_row"
on public.vendors
for insert
to authenticated
with check (auth.uid() = id and auth.uid() = user_id);

drop policy if exists "vendors_update_own_row" on public.vendors;
create policy "vendors_update_own_row"
on public.vendors
for update
to authenticated
using (auth.uid() = id and auth.uid() = user_id)
with check (auth.uid() = id and auth.uid() = user_id);

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

drop policy if exists "products_public_read" on public.products;
create policy "products_public_read"
on public.products
for select
to anon, authenticated
using (true);

drop policy if exists "products_owner_insert" on public.products;
create policy "products_owner_insert"
on public.products
for insert
to authenticated
with check (auth.uid() = vendor_id);

drop policy if exists "products_owner_update" on public.products;
create policy "products_owner_update"
on public.products
for update
to authenticated
using (auth.uid() = vendor_id)
with check (auth.uid() = vendor_id);

drop policy if exists "products_owner_delete" on public.products;
create policy "products_owner_delete"
on public.products
for delete
to authenticated
using (auth.uid() = vendor_id);

drop policy if exists "chats_participants_read" on public.chats;
create policy "chats_participants_read"
on public.chats
for select
to authenticated
using (auth.uid() = any(participants));

drop policy if exists "chats_participants_insert" on public.chats;
create policy "chats_participants_insert"
on public.chats
for insert
to authenticated
with check (auth.uid() = any(participants));

drop policy if exists "chats_participants_update" on public.chats;
create policy "chats_participants_update"
on public.chats
for update
to authenticated
using (auth.uid() = any(participants))
with check (auth.uid() = any(participants));

drop policy if exists "messages_participants_read" on public.messages;
create policy "messages_participants_read"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.chats
    where chats.id = messages.chat_id
      and auth.uid() = any(chats.participants)
  )
);

drop policy if exists "messages_participants_insert" on public.messages;
create policy "messages_participants_insert"
on public.messages
for insert
to authenticated
with check (
  auth.uid() = from_user
  and exists (
    select 1
    from public.chats
    where chats.id = messages.chat_id
      and auth.uid() = any(chats.participants)
  )
);

drop policy if exists "orders_related_read" on public.orders;
create policy "orders_related_read"
on public.orders
for select
to authenticated
using (auth.uid() = buyer_id or auth.uid() = vendor_id);

drop policy if exists "orders_buyer_insert" on public.orders;
create policy "orders_buyer_insert"
on public.orders
for insert
to authenticated
with check (auth.uid() = buyer_id and buyer_id <> vendor_id);

drop policy if exists "orders_vendor_update" on public.orders;
create policy "orders_vendor_update"
on public.orders
for update
to authenticated
using (auth.uid() = vendor_id)
with check (
  auth.uid() = vendor_id
  and status in ('pending', 'accepted', 'rejected')
);

drop policy if exists "orders_buyer_update" on public.orders;
create policy "orders_buyer_update"
on public.orders
for update
to authenticated
using (auth.uid() = buyer_id)
with check (
  auth.uid() = buyer_id
  and status in ('pending', 'cancelled')
);

drop policy if exists "storage_data_insert_own_folder" on storage.objects;
create policy "storage_data_insert_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'data'
  and name like ('vendors/' || auth.uid()::text || '/%')
);

drop policy if exists "storage_data_update_own_folder" on storage.objects;
create policy "storage_data_update_own_folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'data'
  and name like ('vendors/' || auth.uid()::text || '/%')
)
with check (
  bucket_id = 'data'
  and name like ('vendors/' || auth.uid()::text || '/%')
);

drop policy if exists "storage_data_delete_own_folder" on storage.objects;
create policy "storage_data_delete_own_folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'data'
  and name like ('vendors/' || auth.uid()::text || '/%')
);

do $$
begin
  begin
    alter publication supabase_realtime add table public.vendors;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.chats;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then
    null;
  end;
end
$$;
