-- Kelilingku Phase 1 Foundation
-- Migration ini menjembatani schema saat ini ke blueprint map-first commerce.

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

drop policy if exists "orders_vendor_update" on public.orders;
create policy "orders_vendor_update"
on public.orders
for update
to authenticated
using (auth.uid() = vendor_id)
with check (
  auth.uid() = vendor_id
  and status in (
    'pending',
    'accepted',
    'preparing',
    'on_the_way',
    'arrived',
    'completed',
    'cancelled',
    'rejected'
  )
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
    'order_cancelled',
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

create or replace function public.resolve_actor_name(actor_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(trim(v.name), ''),
    nullif(trim(p.display_name), ''),
    'Pengguna'
  )
  from (select actor_user_id as id) actor
  left join public.vendors v on v.id = actor.id
  left join public.profiles p on p.id = actor.id;
$$;

create or replace function public.handle_order_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'accepted' and new.accepted_at is null then
      new.accepted_at = now();
    end if;

    if new.status = 'completed' and new.completed_at is null then
      new.completed_at = now();
    end if;

    if new.status = 'cancelled' and new.cancelled_at is null then
      new.cancelled_at = now();
    end if;

    if new.status = 'rejected' and new.rejected_at is null then
      new.rejected_at = now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_status_timestamps on public.orders;
create trigger orders_status_timestamps
before update on public.orders
for each row execute function public.handle_order_status_timestamps();

create or replace function public.handle_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  participant_id uuid;
  actor_name text;
begin
  actor_name := public.resolve_actor_name(new.from_user);

  for participant_id in
    select unnest(chats.participants)
    from public.chats
    where chats.id = new.chat_id
  loop
    if participant_id <> new.from_user then
      insert into public.notifications (
        user_id,
        type,
        title,
        body,
        entity_type,
        entity_id
      )
      values (
        participant_id,
        'message_received',
        'Pesan baru',
        concat(actor_name, ': ', left(coalesce(new.text, ''), 120)),
        'chat',
        new.chat_id
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists messages_notify_users on public.messages;
create trigger messages_notify_users
after insert on public.messages
for each row execute function public.handle_message_notifications();

create or replace function public.handle_order_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notif_type text;
  notif_title text;
  notif_body text;
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      entity_type,
      entity_id
    )
    values (
      new.vendor_id,
      'order_created',
      'Pesanan baru',
      concat('Pesanan baru dari ', coalesce(new.buyer_name, 'pelanggan')),
      'order',
      new.id
    );

    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  case new.status
    when 'accepted' then
      notif_type := 'order_accepted';
      notif_title := 'Pesanan diterima';
      notif_body := concat('Pesanan Anda diterima oleh ', coalesce(new.vendor_name, 'pedagang'));
    when 'rejected' then
      notif_type := 'order_rejected';
      notif_title := 'Pesanan ditolak';
      notif_body := concat('Pesanan Anda ditolak oleh ', coalesce(new.vendor_name, 'pedagang'));
    when 'cancelled' then
      notif_type := 'order_cancelled';
      notif_title := 'Pesanan dibatalkan';
      notif_body := 'Pesanan dibatalkan.';
    when 'preparing' then
      notif_type := 'order_preparing';
      notif_title := 'Pesanan sedang disiapkan';
      notif_body := concat(coalesce(new.vendor_name, 'Pedagang'), ' sedang menyiapkan pesanan Anda.');
    when 'on_the_way' then
      notif_type := 'order_on_the_way';
      notif_title := 'Pedagang sedang menuju Anda';
      notif_body := concat(coalesce(new.vendor_name, 'Pedagang'), ' sedang menuju titik temu.');
    when 'arrived' then
      notif_type := 'order_arrived';
      notif_title := 'Pedagang sudah tiba';
      notif_body := concat(coalesce(new.vendor_name, 'Pedagang'), ' sudah tiba di sekitar titik temu.');
    when 'completed' then
      notif_type := 'order_completed';
      notif_title := 'Pesanan selesai';
      notif_body := 'Pesanan Anda telah selesai.';
    else
      notif_type := null;
  end case;

  if notif_type is not null then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      entity_type,
      entity_id
    )
    values (
      new.buyer_id,
      notif_type,
      notif_title,
      notif_body,
      'order',
      new.id
    );
  end if;

  if new.status = 'cancelled' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      entity_type,
      entity_id
    )
    values (
      new.vendor_id,
      'order_cancelled',
      'Pesanan dibatalkan',
      concat('Pesanan dari ', coalesce(new.buyer_name, 'pelanggan'), ' dibatalkan.'),
      'order',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_notify_users on public.orders;
create trigger orders_notify_users
after insert or update on public.orders
for each row execute function public.handle_order_notifications();

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
