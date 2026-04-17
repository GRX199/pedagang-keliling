-- Deprecated draft.
-- Gunakan file: supabase/phase1-foundation.sql
-- File ini dipertahankan sementara agar riwayat kerja sebelumnya tetap terlacak.

create extension if not exists pgcrypto;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('customer', 'vendor', 'admin'));

alter table public.vendors
  add column if not exists category_primary text,
  add column if not exists service_radius_km numeric(6,2),
  add column if not exists operating_hours jsonb,
  add column if not exists service_mode text not null default 'meetup',
  add column if not exists is_verified boolean not null default false,
  add column if not exists last_seen_at timestamptz;

alter table public.vendors
  drop constraint if exists vendors_service_radius_non_negative;

alter table public.vendors
  add constraint vendors_service_radius_non_negative
  check (service_radius_km is null or service_radius_km >= 0);

alter table public.vendors
  drop constraint if exists vendors_service_mode_check;

alter table public.vendors
  add constraint vendors_service_mode_check
  check (service_mode in ('delivery', 'meetup', 'both'));

alter table public.products
  add column if not exists stock integer,
  add column if not exists is_available boolean not null default true,
  add column if not exists category_name text;

alter table public.products
  drop constraint if exists products_stock_non_negative;

alter table public.products
  add constraint products_stock_non_negative
  check (stock is null or stock >= 0);

alter table public.orders
  add column if not exists payment_method text not null default 'cod',
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists fulfillment_type text not null default 'meetup',
  add column if not exists meeting_point_label text,
  add column if not exists meeting_point_location jsonb,
  add column if not exists customer_note text,
  add column if not exists subtotal_amount numeric(12,2) not null default 0,
  add column if not exists delivery_fee numeric(12,2) not null default 0,
  add column if not exists total_amount numeric(12,2) not null default 0,
  add column if not exists accepted_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists rejected_at timestamptz;

alter table public.orders
  drop constraint if exists orders_valid_status;

alter table public.orders
  add constraint orders_valid_status
  check (status in (
    'pending',
    'accepted',
    'preparing',
    'on_the_way',
    'arrived',
    'completed',
    'cancelled',
    'rejected'
  ));

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('cod', 'qris', 'bank_transfer'));

alter table public.orders
  drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('unpaid', 'pending_confirmation', 'paid', 'failed', 'refunded'));

alter table public.orders
  drop constraint if exists orders_fulfillment_type_check;

alter table public.orders
  add constraint orders_fulfillment_type_check
  check (fulfillment_type in ('meetup', 'delivery'));

alter table public.orders
  drop constraint if exists orders_amounts_non_negative;

alter table public.orders
  add constraint orders_amounts_non_negative
  check (
    subtotal_amount >= 0
    and delivery_fee >= 0
    and total_amount >= 0
  );

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.vendor_categories (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint vendor_categories_unique unique (vendor_id, category_id)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  product_name_snapshot text not null,
  price_snapshot numeric(12,2) not null default 0,
  quantity integer not null default 1,
  line_total numeric(12,2) not null default 0,
  item_note text,
  created_at timestamptz not null default now(),
  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_amounts_non_negative check (price_snapshot >= 0 and line_total >= 0)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'message_received',
    'order_created',
    'order_accepted',
    'order_rejected',
    'order_preparing',
    'order_on_the_way',
    'order_arrived',
    'order_completed',
    'vendor_nearby',
    'payment_confirmed'
  ));

create index if not exists vendors_online_updated_at_idx
  on public.vendors (online, updated_at desc);

create index if not exists vendors_category_primary_idx
  on public.vendors (category_primary);

create index if not exists products_vendor_available_idx
  on public.products (vendor_id, is_available, created_at desc);

create index if not exists orders_status_updated_at_idx
  on public.orders (status, updated_at desc);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create index if not exists notifications_user_read_created_idx
  on public.notifications (user_id, is_read, created_at desc);

drop trigger if exists notifications_set_updated_at on public.notifications;
create trigger notifications_set_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

alter table public.categories enable row level security;
alter table public.vendor_categories enable row level security;
alter table public.order_items enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "categories_public_read" on public.categories;
create policy "categories_public_read"
on public.categories
for select
to anon, authenticated
using (true);

drop policy if exists "vendor_categories_public_read" on public.vendor_categories;
create policy "vendor_categories_public_read"
on public.vendor_categories
for select
to anon, authenticated
using (true);

drop policy if exists "vendor_categories_owner_insert" on public.vendor_categories;
create policy "vendor_categories_owner_insert"
on public.vendor_categories
for insert
to authenticated
with check (auth.uid() = vendor_id);

drop policy if exists "vendor_categories_owner_delete" on public.vendor_categories;
create policy "vendor_categories_owner_delete"
on public.vendor_categories
for delete
to authenticated
using (auth.uid() = vendor_id);

drop policy if exists "order_items_related_read" on public.order_items;
create policy "order_items_related_read"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and (orders.buyer_id = auth.uid() or orders.vendor_id = auth.uid())
  )
);

drop policy if exists "order_items_buyer_insert" on public.order_items;
create policy "order_items_buyer_insert"
on public.order_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.buyer_id = auth.uid()
  )
);

drop policy if exists "notifications_own_read" on public.notifications;
create policy "notifications_own_read"
on public.notifications
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "notifications_own_insert" on public.notifications;
create policy "notifications_own_insert"
on public.notifications
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "notifications_own_update" on public.notifications;
create policy "notifications_own_update"
on public.notifications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then
    null;
  end;
end
$$;

comment on table public.order_items is 'Structured order items for map-first commerce transactions.';
comment on table public.notifications is 'User-facing notification inbox and badge source.';
