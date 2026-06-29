-- Kelilingku production hardening
-- Jalankan setelah schema.sql, phase1-foundation.sql, dan admin-foundation.sql.

begin;

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

create or replace function public.request_is_service_role()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

revoke all on function public.request_is_service_role() from public, anon;
grant execute on function public.request_is_service_role() to authenticated, service_role;

create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.request_is_service_role() or public.is_admin() then
    return new;
  end if;

  if new.id <> auth.uid() then
    raise exception 'Profil ini bukan milik Anda.';
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'admin' or new.account_status <> 'active' then
      raise exception 'Role atau status akun tidak boleh ditentukan sendiri.';
    end if;

    if new.role = 'vendor' and not exists (
      select 1 from public.vendors where id = new.id and user_id = auth.uid()
    ) then
      raise exception 'Role pedagang membutuhkan profil toko yang valid.';
    end if;
  else
    if new.role is distinct from old.role
       or new.account_status is distinct from old.account_status then
      raise exception 'Role dan status akun hanya dapat diubah admin.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_fields on public.profiles;
create trigger profiles_guard_privileged_fields
before insert or update on public.profiles
for each row execute function public.guard_profile_privileged_fields();

create or replace function public.guard_active_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.request_is_service_role() or public.is_admin() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = auth.uid() and account_status = 'active'
  ) then
    raise exception 'Akun sedang dibatasi dan tidak dapat melakukan tindakan ini.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_guard_active_account on public.messages;
create trigger messages_guard_active_account
before insert on public.messages
for each row execute function public.guard_active_account();

drop trigger if exists chats_guard_active_account on public.chats;
create trigger chats_guard_active_account
before insert or update on public.chats
for each row execute function public.guard_active_account();

drop trigger if exists products_guard_active_account on public.products;
create trigger products_guard_active_account
before insert or update or delete on public.products
for each row execute function public.guard_active_account();

create or replace function public.guard_vendor_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_status text;
begin
  if new.online = false then
    new.location := null;
    new.last_seen_at := null;
  end if;

  if new.location is distinct from old.location and new.online = true then
    new.last_seen_at := now();
  end if;

  if auth.uid() is null or public.request_is_service_role() or public.is_admin() then
    return new;
  end if;

  if new.is_verified is distinct from old.is_verified then
    raise exception 'Status verifikasi hanya dapat diubah admin.';
  end if;

  if auth.uid() = old.id then
    select account_status into actor_status
    from public.profiles
    where id = auth.uid();

    if coalesce(actor_status, 'active') <> 'active' then
      raise exception 'Akun sedang dibatasi dan tidak dapat mengubah toko.';
    end if;

    if new.location is distinct from old.location and new.online = false then
      raise exception 'Lokasi hanya dapat dibagikan saat toko online.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists vendors_guard_sensitive_fields on public.vendors;
create trigger vendors_guard_sensitive_fields
before update on public.vendors
for each row execute function public.guard_vendor_sensitive_fields();

drop policy if exists "vendors_public_read" on public.vendors;
drop policy if exists "vendors_authenticated_read" on public.vendors;
create policy "vendors_authenticated_read"
on public.vendors
for select
to authenticated
using (
  auth.uid() = id
  or public.is_admin()
  or (
    online = true
    and location is not null
    and last_seen_at >= now() - interval '2 minutes'
    and exists (
      select 1
      from public.profiles
      where profiles.id = vendors.id
        and profiles.account_status = 'active'
    )
  )
);

drop policy if exists "profiles_public_read" on public.profiles;
drop policy if exists "profiles_authenticated_read" on public.profiles;
create policy "profiles_authenticated_read"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "storage_data_insert_own_folder" on storage.objects;
drop policy if exists "storage_data_update_own_folder" on storage.objects;
drop policy if exists "storage_data_delete_own_folder" on storage.objects;
revoke insert, update, delete on storage.objects from authenticated;

create or replace function public.guard_chat_participants()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.participants is distinct from old.participants then
    raise exception 'Peserta percakapan tidak dapat diubah.';
  end if;

  return new;
end;
$$;

drop trigger if exists chats_guard_participants on public.chats;
create trigger chats_guard_participants
before update on public.chats
for each row execute function public.guard_chat_participants();

alter table public.products
  add column if not exists reserved_stock integer not null default 0;

alter table public.products
  drop constraint if exists products_reserved_stock_valid;

alter table public.products
  add constraint products_reserved_stock_valid
  check (
    reserved_stock >= 0
    and (stock is null or reserved_stock <= stock)
  );

alter table public.orders
  add column if not exists inventory_reserved_at timestamptz,
  add column if not exists vendor_payment_details_snapshot jsonb not null default '{}'::jsonb;

create table if not exists public.order_inventory_settlements (
  order_id uuid primary key references public.orders(id) on delete cascade,
  settlement_type text not null check (settlement_type in ('released', 'completed')),
  created_at timestamptz not null default now()
);

alter table public.order_inventory_settlements enable row level security;
revoke all on public.order_inventory_settlements from anon, authenticated;

drop trigger if exists favorites_guard_active_account on public.favorites;
create trigger favorites_guard_active_account
before insert or delete on public.favorites
for each row execute function public.guard_active_account();

drop trigger if exists reviews_guard_active_account on public.reviews;
create trigger reviews_guard_active_account
before insert or update on public.reviews
for each row execute function public.guard_active_account();

create or replace function public.guard_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_status text;
  immutable_old jsonb;
  immutable_new jsonb;
begin
  if actor_id is null or public.request_is_service_role() or public.is_admin() then
    return new;
  end if;

  if actor_id <> old.buyer_id and actor_id <> old.vendor_id then
    raise exception 'Anda tidak berhak mengubah pesanan ini.';
  end if;

  select account_status into actor_status
  from public.profiles
  where id = actor_id;

  if coalesce(actor_status, 'active') <> 'active' then
    raise exception 'Akun sedang dibatasi dan tidak dapat mengubah pesanan.';
  end if;

  immutable_old := to_jsonb(old) - array[
    'status', 'payment_status', 'updated_at', 'accepted_at',
    'completed_at', 'cancelled_at', 'rejected_at'
  ];
  immutable_new := to_jsonb(new) - array[
    'status', 'payment_status', 'updated_at', 'accepted_at',
    'completed_at', 'cancelled_at', 'rejected_at'
  ];

  if immutable_new is distinct from immutable_old then
    raise exception 'Detail komersial pesanan tidak dapat diubah setelah checkout.';
  end if;

  if new.status is distinct from old.status
     and new.payment_status is distinct from old.payment_status then
    raise exception 'Status order dan pembayaran harus diperbarui terpisah.';
  end if;

  if actor_id = old.buyer_id then
    if new.status is distinct from old.status
       and not (old.status = 'pending' and new.status = 'cancelled') then
      raise exception 'Pelanggan hanya dapat membatalkan pesanan yang masih pending.';
    end if;

    if new.payment_status is distinct from old.payment_status
       and not (
         old.payment_method in ('qris', 'bank_transfer', 'ewallet')
         and old.status in ('pending', 'accepted', 'preparing')
         and old.payment_status in ('unpaid', 'failed')
         and new.payment_status = 'pending_confirmation'
       ) then
      raise exception 'Transisi konfirmasi pembayaran pelanggan tidak valid.';
    end if;

    return new;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending' and new.status in ('accepted', 'rejected'))
      or (old.status = 'accepted' and new.status = 'preparing')
      or (old.status = 'preparing' and new.status = 'on_the_way')
      or (old.status = 'on_the_way' and new.status = 'arrived')
      or (old.status = 'arrived' and new.status = 'completed')
    ) then
      raise exception 'Urutan status pesanan tidak valid.';
    end if;

    if new.status in ('on_the_way', 'arrived', 'completed')
       and old.payment_method <> 'cod'
       and old.payment_status <> 'paid' then
      raise exception 'Pembayaran non-tunai harus dikonfirmasi sebelum pengantaran.';
    end if;

    if new.status = 'completed' and old.payment_status <> 'paid' then
      raise exception 'Pembayaran harus lunas sebelum pesanan diselesaikan.';
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status then
    if old.payment_method = 'cod' then
      if not (
        old.status = 'arrived'
        and old.payment_status = 'unpaid'
        and new.payment_status = 'paid'
      ) then
        raise exception 'Pembayaran COD hanya dapat dilunasi setelah pedagang tiba.';
      end if;
    elsif not (
      old.payment_status = 'pending_confirmation'
      and new.payment_status in ('paid', 'failed')
    ) then
      raise exception 'Transisi konfirmasi pembayaran pedagang tidak valid.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_guard_update on public.orders;
create trigger orders_guard_update
before update on public.orders
for each row execute function public.guard_order_update();

create or replace function public.handle_order_inventory_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_order_id uuid;
begin
  if new.status is not distinct from old.status
     or new.status not in ('completed', 'cancelled', 'rejected') then
    return new;
  end if;

  insert into public.order_inventory_settlements (order_id, settlement_type)
  values (
    new.id,
    case when new.status = 'completed' then 'completed' else 'released' end
  )
  on conflict (order_id) do nothing
  returning order_id into inserted_order_id;

  if inserted_order_id is null then
    return new;
  end if;

  if new.status = 'completed' then
    update public.products as products
    set
      stock = greatest(products.stock - item_totals.quantity, 0),
      reserved_stock = greatest(products.reserved_stock - item_totals.quantity, 0),
      is_available = greatest(products.stock - item_totals.quantity, 0) > 0
    from (
      select product_id, vendor_id, sum(quantity)::integer as quantity
      from public.order_items
      where order_id = new.id and product_id is not null
      group by product_id, vendor_id
    ) as item_totals
    where products.id = item_totals.product_id
      and products.vendor_id = new.vendor_id
      and item_totals.vendor_id = new.vendor_id
      and products.stock is not null;
  elsif new.inventory_reserved_at is not null then
    update public.products as products
    set reserved_stock = greatest(products.reserved_stock - item_totals.quantity, 0)
    from (
      select product_id, vendor_id, sum(quantity)::integer as quantity
      from public.order_items
      where order_id = new.id and product_id is not null
      group by product_id, vendor_id
    ) as item_totals
    where products.id = item_totals.product_id
      and products.vendor_id = new.vendor_id
      and item_totals.vendor_id = new.vendor_id
      and products.stock is not null;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_settle_inventory on public.orders;
create trigger orders_settle_inventory
after update on public.orders
for each row execute function public.handle_order_inventory_settlement();

create or replace function public.create_order_with_items(
  target_vendor_id uuid,
  target_payment_method text,
  target_fulfillment_type text,
  target_order_timing text,
  target_requested_fulfillment_at timestamptz,
  target_meeting_point_label text,
  target_meeting_point_location jsonb,
  target_customer_note text,
  target_customer_location jsonb,
  target_items jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  buyer_id uuid := auth.uid();
  buyer_profile public.profiles%rowtype;
  vendor_row public.vendors%rowtype;
  product_row public.products%rowtype;
  created_order public.orders%rowtype;
  item_record record;
  subtotal numeric(12,2) := 0;
  order_summary text := '';
  line_total numeric(12,2);
begin
  if buyer_id is null then
    raise exception 'Login diperlukan untuk membuat pesanan.';
  end if;

  if buyer_id = target_vendor_id then
    raise exception 'Pedagang tidak dapat memesan dari tokonya sendiri.';
  end if;

  select * into buyer_profile
  from public.profiles
  where id = buyer_id;

  if coalesce(buyer_profile.account_status, 'active') <> 'active' then
    raise exception 'Akun sedang dibatasi dan tidak dapat membuat pesanan.';
  end if;

  select * into vendor_row
  from public.vendors
  where id = target_vendor_id
  for update;

  if not found then
    raise exception 'Pedagang tidak ditemukan.';
  end if;

  if not vendor_row.online
     or vendor_row.location is null
     or vendor_row.last_seen_at is null
     or vendor_row.last_seen_at < now() - interval '2 minutes' then
    raise exception 'Pedagang sedang offline atau lokasinya sudah tidak aktif.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = target_vendor_id and account_status = 'active'
  ) then
    raise exception 'Akun pedagang sedang tidak aktif.';
  end if;

  if target_payment_method not in ('cod', 'qris', 'bank_transfer', 'ewallet') then
    raise exception 'Metode pembayaran tidak valid.';
  end if;

  if target_payment_method = 'qris'
     and nullif(trim(vendor_row.payment_details ->> 'qris_image_url'), '') is null then
    raise exception 'Pedagang belum menyiapkan QRIS.';
  elsif target_payment_method = 'bank_transfer'
     and nullif(trim(vendor_row.payment_details ->> 'bank_account_number'), '') is null then
    raise exception 'Pedagang belum menyiapkan rekening transfer.';
  elsif target_payment_method = 'ewallet'
     and nullif(trim(vendor_row.payment_details ->> 'ewallet_number'), '') is null then
    raise exception 'Pedagang belum menyiapkan nomor e-wallet.';
  end if;

  if target_fulfillment_type not in ('meetup', 'delivery') then
    raise exception 'Metode serah terima tidak valid.';
  end if;

  if vendor_row.service_mode <> 'both'
     and vendor_row.service_mode <> target_fulfillment_type then
    raise exception 'Metode serah terima tidak didukung pedagang.';
  end if;

  if target_order_timing not in ('asap', 'preorder') then
    raise exception 'Waktu pesanan tidak valid.';
  end if;

  if target_order_timing = 'preorder' and target_requested_fulfillment_at is null then
    raise exception 'Waktu target wajib diisi untuk pre-order.';
  end if;

  if jsonb_typeof(target_items) <> 'array'
     or jsonb_array_length(target_items) < 1
     or jsonb_array_length(target_items) > 50 then
    raise exception 'Item pesanan harus berisi 1 sampai 50 produk.';
  end if;

  for item_record in
    select
      (item ->> 'product_id')::uuid as product_id,
      sum((item ->> 'quantity')::integer)::integer as quantity,
      nullif(string_agg(nullif(trim(item ->> 'note'), ''), '; '), '') as item_note
    from jsonb_array_elements(target_items) as item
    group by (item ->> 'product_id')::uuid
  loop
    if item_record.quantity <= 0 or item_record.quantity > 100 then
      raise exception 'Jumlah produk tidak valid.';
    end if;

    select * into product_row
    from public.products
    where id = item_record.product_id
      and vendor_id = target_vendor_id
    for update;

    if not found or not product_row.is_available then
      raise exception 'Salah satu produk sudah tidak tersedia.';
    end if;

    if product_row.stock is not null
       and product_row.stock - product_row.reserved_stock < item_record.quantity then
      raise exception 'Stok % tidak mencukupi.', product_row.name;
    end if;

    line_total := coalesce(product_row.price, 0) * item_record.quantity;
    subtotal := subtotal + line_total;
    order_summary := concat_ws(
      E'\n',
      nullif(order_summary, ''),
      concat(product_row.name, ' x', item_record.quantity)
    );
  end loop;

  insert into public.orders (
    vendor_id,
    vendor_name,
    buyer_id,
    buyer_name,
    items,
    status,
    payment_method,
    payment_status,
    fulfillment_type,
    order_timing,
    requested_fulfillment_at,
    meeting_point_label,
    meeting_point_location,
    customer_note,
    customer_location,
    vendor_location_snapshot,
    vendor_payment_details_snapshot,
    subtotal_amount,
    delivery_fee,
    total_amount,
    inventory_reserved_at
  ) values (
    vendor_row.id,
    vendor_row.name,
    buyer_id,
    coalesce(nullif(trim(buyer_profile.display_name), ''), 'Pelanggan'),
    order_summary,
    'pending',
    target_payment_method,
    'unpaid',
    target_fulfillment_type,
    target_order_timing,
    target_requested_fulfillment_at,
    nullif(left(trim(coalesce(target_meeting_point_label, '')), 240), ''),
    target_meeting_point_location,
    nullif(left(trim(coalesce(target_customer_note, '')), 1000), ''),
    target_customer_location,
    vendor_row.location,
    vendor_row.payment_details,
    subtotal,
    0,
    subtotal,
    now()
  ) returning * into created_order;

  for item_record in
    select
      (item ->> 'product_id')::uuid as product_id,
      sum((item ->> 'quantity')::integer)::integer as quantity,
      nullif(string_agg(nullif(trim(item ->> 'note'), ''), '; '), '') as item_note
    from jsonb_array_elements(target_items) as item
    group by (item ->> 'product_id')::uuid
  loop
    select * into product_row
    from public.products
    where id = item_record.product_id and vendor_id = target_vendor_id
    for update;

    line_total := coalesce(product_row.price, 0) * item_record.quantity;

    insert into public.order_items (
      order_id,
      product_id,
      vendor_id,
      product_name_snapshot,
      price_snapshot,
      quantity,
      line_total,
      item_note
    ) values (
      created_order.id,
      product_row.id,
      vendor_row.id,
      product_row.name,
      coalesce(product_row.price, 0),
      item_record.quantity,
      line_total,
      item_record.item_note
    );

    if product_row.stock is not null then
      update public.products
      set reserved_stock = reserved_stock + item_record.quantity
      where id = product_row.id;
    end if;
  end loop;

  return created_order;
end;
$$;

revoke all on function public.create_order_with_items(
  uuid, text, text, text, timestamptz, text, jsonb, text, jsonb, jsonb
) from public, anon;
grant execute on function public.create_order_with_items(
  uuid, text, text, text, timestamptz, text, jsonb, text, jsonb, jsonb
) to authenticated;

drop policy if exists "orders_buyer_insert" on public.orders;
drop policy if exists "order_items_buyer_insert" on public.order_items;
revoke insert on public.orders from authenticated;
revoke insert on public.order_items from authenticated;

create or replace function public.complete_order_and_decrement_stock(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders%rowtype;
begin
  select * into target_order
  from public.orders
  where id = target_order_id
  for update;

  if not found then
    raise exception 'Pesanan tidak ditemukan.';
  end if;

  if target_order.vendor_id <> auth.uid() then
    raise exception 'Anda tidak berhak menyelesaikan pesanan ini.';
  end if;

  if target_order.status = 'completed' then
    return target_order;
  end if;

  update public.orders
  set status = 'completed'
  where id = target_order_id
  returning * into target_order;

  return target_order;
end;
$$;

revoke all on function public.complete_order_and_decrement_stock(uuid) from public, anon;
grant execute on function public.complete_order_and_decrement_stock(uuid) to authenticated;

create index if not exists vendors_presence_idx
  on public.vendors (online, last_seen_at desc);

do $$
begin
  begin
    alter publication supabase_realtime add table public.products;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.reviews;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.favorites;
  exception when duplicate_object then
    null;
  end;
end
$$;

commit;
