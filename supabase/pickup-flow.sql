-- Apply LAST, after production-hardening.sql and order-payment-guard.sql.
-- Existing orders remain legacy. Do not re-run older migrations after this one.
begin;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'message_received', 'order_created', 'order_accepted', 'order_rejected', 'order_cancelled',
  'order_preparing', 'order_on_the_way', 'order_arrived', 'order_ready', 'order_completed',
  'vendor_nearby', 'payment_confirmed'
));

alter table public.vendors
  add column if not exists mobility_type text,
  add column if not exists service_area text,
  add column if not exists route_description text,
  add column if not exists stopping_points text;
alter table public.vendors drop constraint if exists vendors_mobility_valid;
alter table public.vendors add constraint vendors_mobility_valid check (
  (mobility_type is null or mobility_type in ('walking', 'pushcart', 'bicycle', 'motor_vehicle'))
  and length(service_area) <= 240 and length(route_description) <= 500 and length(stopping_points) <= 500
);

alter table public.orders
  add column if not exists service_flow text not null default 'legacy',
  add column if not exists pickup_contact_name text,
  add column if not exists collector_name text,
  add column if not exists courier_consent boolean not null default false,
  add column if not exists point_confirmed_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists handed_over_at timestamptz;
alter table public.orders drop constraint if exists orders_valid_status;
alter table public.orders drop constraint if exists orders_fulfillment_type_check;
alter table public.orders drop constraint if exists orders_service_flow_valid;
alter table public.orders add constraint orders_service_flow_valid check (
  (service_flow = 'legacy' and fulfillment_type in ('meetup', 'delivery')
    and status in ('pending', 'accepted', 'preparing', 'on_the_way', 'arrived', 'completed', 'cancelled', 'rejected'))
  or (service_flow = 'pickup_v1' and fulfillment_type in ('self_pickup', 'customer_courier')
    and status in ('pending', 'accepted', 'ready', 'completed', 'cancelled', 'rejected')
    and coalesce(length(trim(meeting_point_label)), 0) between 1 and 240
    and coalesce(length(trim(pickup_contact_name)), 0) between 1 and 100
    and (fulfillment_type <> 'customer_courier' or courier_consent)
    and (status not in ('accepted', 'ready', 'completed') or point_confirmed_at is not null)
    and (status not in ('ready', 'completed') or ready_at is not null)
    and (status <> 'completed' or (handed_over_at is not null and payment_status = 'paid')))
);

-- Never expose the code on orders, Realtime, chat, or the vendor's SELECT.
create table if not exists public.pickup_codes (
  order_id uuid primary key references public.orders(id) on delete cascade,
  code text not null default upper(left(replace(gen_random_uuid()::text, '-', ''), 10)),
  failed_attempts integer not null default 0,
  locked_until timestamptz
);
alter table public.pickup_codes enable row level security;
revoke all on public.pickup_codes from public, anon, authenticated;
grant select (order_id, code) on public.pickup_codes to authenticated;
drop policy if exists pickup_codes_buyer_read on public.pickup_codes;
create policy pickup_codes_buyer_read on public.pickup_codes for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid()
  and o.status = 'ready') and exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active'));

-- Only status/payment are writable through REST. Detail and handover changes use locked RPCs.
revoke update on public.products from authenticated;
grant update (name, description, price, stock, category_name, is_available, image_url) on public.products to authenticated;
revoke update on public.orders from authenticated;
grant update (status, payment_status) on public.orders to authenticated;
drop policy if exists orders_vendor_update on public.orders;
create policy orders_vendor_update on public.orders for update to authenticated
using (vendor_id = auth.uid()) with check (vendor_id = auth.uid());
drop policy if exists orders_buyer_update on public.orders;
create policy orders_buyer_update on public.orders for update to authenticated
using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());

create or replace function public.guard_pickup_change(previous public.orders, proposed public.orders, actor uuid)
returns public.orders language plpgsql set search_path = public as $$
declare
  allowed text[] := array['status', 'payment_status', 'updated_at', 'accepted_at', 'completed_at',
    'cancelled_at', 'rejected_at', 'point_confirmed_at', 'ready_at', 'handed_over_at',
    'meeting_point_label', 'meeting_point_location', 'collector_name'];
begin
  if (to_jsonb(previous) - allowed) is distinct from (to_jsonb(proposed) - allowed) then
    raise exception 'Detail komersial pesanan tidak dapat diubah.';
  end if;
  if proposed.status is distinct from previous.status and proposed.payment_status is distinct from previous.payment_status then
    raise exception 'Perbarui status dan pembayaran secara terpisah.';
  end if;
  if proposed.meeting_point_label is distinct from previous.meeting_point_label
     or proposed.meeting_point_location is distinct from previous.meeting_point_location then
    if actor <> previous.buyer_id or previous.status <> 'pending' or proposed.status <> 'pending' then
      raise exception 'Titik hanya dapat diubah pelanggan sebelum disetujui.';
    end if;
  end if;
  if proposed.collector_name is distinct from previous.collector_name then
    if actor <> previous.buyer_id or previous.status <> 'ready' or proposed.status <> 'ready' then
      raise exception 'Identitas pengambil diisi pelanggan setelah barang siap.';
    end if;
  end if;
  if proposed.status is distinct from previous.status then
    if actor = previous.buyer_id then
      if not (previous.status = 'pending' and proposed.status = 'cancelled') then
        raise exception 'Pesanan hanya dapat dibatalkan sebelum persetujuan.';
      end if;
    elsif not (
      (previous.status = 'pending' and proposed.status in ('accepted', 'rejected'))
      or (previous.status = 'accepted' and proposed.status = 'ready')
      or (previous.status = 'ready' and proposed.status = 'completed'
        and proposed.handed_over_at is not null and previous.payment_status = 'paid')
    ) then
      raise exception 'Urutan status pengambilan tidak valid. Serah terima membutuhkan kode dan pembayaran lunas.';
    end if;
    if proposed.status = 'accepted' then proposed.point_confirmed_at := now(); end if;
    if proposed.status = 'ready' then proposed.ready_at := now(); end if;
  end if;
  if proposed.payment_status is distinct from previous.payment_status then
    if previous.status not in ('accepted', 'ready') then
      raise exception 'Pembayaran hanya dapat dikonfirmasi setelah titik disetujui dan sebelum selesai.';
    end if;
    if actor = previous.buyer_id then
      if not (previous.payment_method <> 'cod' and previous.payment_status in ('unpaid', 'failed')
        and proposed.payment_status = 'pending_confirmation') then
        raise exception 'Konfirmasi pembayaran tidak valid.';
      end if;
    elsif not (
      (previous.payment_method = 'cod' and previous.status = 'ready'
        and previous.payment_status = 'unpaid' and proposed.payment_status = 'paid')
      or (previous.payment_method <> 'cod' and previous.payment_status = 'pending_confirmation'
        and proposed.payment_status in ('paid', 'failed'))
    ) then
      raise exception 'Perubahan pembayaran tidak valid.';
    end if;
  end if;
  return proposed;
end;
$$;
revoke all on function public.guard_pickup_change(public.orders, public.orders, uuid) from public, anon, authenticated;

create or replace function public.update_pickup_details(
  target_order_id uuid, target_point text default null, target_collector text default null,
  expected_point text default null
)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = target_order_id for update;
  if not found or auth.uid() is null or auth.uid() <> o.buyer_id or o.service_flow <> 'pickup_v1'
    or not exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active') then
    raise exception 'Anda tidak dapat mengubah pengambilan ini.';
  end if;
  if target_point is not null then
    if o.status <> 'pending' or expected_point is distinct from o.meeting_point_label then
      raise exception 'Titik sudah berubah atau disetujui. Muat ulang pesanan.';
    end if;
    if length(trim(target_point)) not between 1 and 240 then raise exception 'Isi titik pengambilan (maksimal 240 karakter).'; end if;
    update public.orders set meeting_point_label = trim(target_point), meeting_point_location = null
      where id = o.id returning * into o;
  elsif target_collector is not null then
    if o.status <> 'ready' or length(trim(target_collector)) not between 1 and 100 then
      raise exception 'Isi nama pengambil ketika barang siap (maksimal 100 karakter).';
    end if;
    update public.orders set collector_name = trim(target_collector) where id = o.id returning * into o;
  else raise exception 'Tidak ada perubahan pengambilan.';
  end if;
  return o;
end;
$$;
revoke all on function public.update_pickup_details(uuid, text, text, text) from public, anon;
grant execute on function public.update_pickup_details(uuid, text, text, text) to authenticated;

create or replace function public.confirm_pickup_handover(target_order_id uuid, target_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; secret public.pickup_codes%rowtype;
begin
  select * into o from public.orders where id = target_order_id for update;
  if not found or auth.uid() is null or auth.uid() <> o.vendor_id or o.service_flow <> 'pickup_v1'
    or not exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active') then
    raise exception 'Anda tidak dapat menyelesaikan pengambilan ini.';
  end if;
  if o.status = 'completed' then return jsonb_build_object('order', to_jsonb(o)); end if;
  if o.status <> 'ready' or o.payment_status <> 'paid' or nullif(trim(o.collector_name), '') is null then
    raise exception 'Barang harus siap, pembayaran lunas, dan nama pengambil sudah diisi.';
  end if;
  select * into secret from public.pickup_codes where order_id = o.id for update;
  if not found then raise exception 'Kode pengambilan tidak tersedia. Hubungi pengelola.'; end if;
  if secret.locked_until > now() then
    return jsonb_build_object('error', 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
  end if;
  if secret.locked_until is not null then secret.failed_attempts := 0; end if;
  if upper(trim(coalesce(target_code, ''))) <> secret.code then
    -- Return, not RAISE: the failed-attempt counter must commit.
    update public.pickup_codes set failed_attempts = secret.failed_attempts + 1,
      locked_until = case when secret.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
      where order_id = o.id;
    return jsonb_build_object('error', 'Kode tidak cocok. Minta pengambil memeriksa kode pesanan.');
  end if;
  update public.orders set status = 'completed', handed_over_at = now() where id = o.id returning * into o;
  delete from public.pickup_codes where order_id = o.id;
  return jsonb_build_object('order', to_jsonb(o));
end;
$$;
revoke all on function public.confirm_pickup_handover(uuid, text) from public, anon;
grant execute on function public.confirm_pickup_handover(uuid, text) to authenticated;

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

  if old.service_flow = 'pickup_v1' then
    return public.guard_pickup_change(old, new, actor_id);
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

create or replace function public.create_pickup_order(
  target_vendor_id uuid,
  target_payment_method text,
  target_fulfillment_type text,
  target_order_timing text,
  target_requested_fulfillment_at timestamptz,
  target_meeting_point_label text,
  target_meeting_point_location jsonb,
  target_customer_note text,
  target_customer_location jsonb,
  target_items jsonb,
  target_pickup_contact_name text,
  target_courier_consent boolean
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

  if buyer_profile.id is null or buyer_profile.role <> 'customer' or buyer_profile.account_status <> 'active' then
    raise exception 'Akun sedang dibatasi dan tidak dapat membuat pesanan.';
  end if;

  select * into vendor_row
  from public.vendors
  where id = target_vendor_id
  for update;

  if not found then
    raise exception 'Pedagang tidak ditemukan.';
  end if;

  if vendor_row.is_verified is not true then
    raise exception 'Pedagang belum terverifikasi.';
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

  if target_payment_method is null or target_payment_method not in ('cod', 'qris', 'bank_transfer', 'ewallet') then
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

  if target_fulfillment_type is null or target_fulfillment_type not in ('self_pickup', 'customer_courier') then
    raise exception 'Pilih ambil sendiri atau kurir yang diatur pelanggan.';
  end if;
  if coalesce(length(trim(target_meeting_point_label)), 0) not between 1 and 240
     or coalesce(length(trim(target_pickup_contact_name)), 0) not between 1 and 100 then
    raise exception 'Usulan titik dan nama pelanggan wajib diisi.';
  end if;
  if target_fulfillment_type = 'customer_courier' and target_courier_consent is not true then
    raise exception 'Pengaturan dan biaya kurir menjadi tanggung jawab pelanggan di luar Kelilingku.';
  end if;
  if target_meeting_point_location is not null and (
    jsonb_typeof(target_meeting_point_location -> 'lat') is distinct from 'number'
    or jsonb_typeof(target_meeting_point_location -> 'lng') is distinct from 'number'
    or (target_meeting_point_location ->> 'lat')::numeric not between -90 and 90
    or (target_meeting_point_location ->> 'lng')::numeric not between -180 and 180
  ) then raise exception 'Titik pengambilan tidak valid.'; end if;

  if target_order_timing is null or target_order_timing not in ('asap', 'preorder') then
    raise exception 'Waktu pesanan tidak valid.';
  end if;

  if target_order_timing = 'preorder' and target_requested_fulfillment_at is null then
    raise exception 'Waktu target wajib diisi untuk pre-order.';
  end if;

  if target_order_timing = 'preorder' and target_requested_fulfillment_at <= now() then
    raise exception 'Waktu pengambilan harus di masa depan.';
  end if;

  if target_items is null or jsonb_typeof(target_items) <> 'array'
     or jsonb_array_length(target_items) < 1
     or jsonb_array_length(target_items) > 50 then
    raise exception 'Item pesanan harus berisi 1 sampai 50 produk.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(target_items) item
    where coalesce(item ->> 'quantity', '') !~ '^[1-9][0-9]{0,2}$'
      or coalesce(item ->> 'product_id', '') = ''
  ) then raise exception 'Jumlah setiap produk harus bilangan bulat 1 sampai 100.'; end if;

  for item_record in
    select
      (item ->> 'product_id')::uuid as product_id,
      sum((item ->> 'quantity')::integer)::integer as quantity,
      nullif(string_agg(nullif(trim(item ->> 'note'), ''), '; '), '') as item_note
    from jsonb_array_elements(target_items) as item
    group by (item ->> 'product_id')::uuid
    order by (item ->> 'product_id')::uuid
  loop
    if item_record.quantity <= 0 or item_record.quantity > 100 then
      raise exception 'Jumlah produk tidak valid.';
    end if;

    select * into product_row
    from public.products
    where id = item_record.product_id
      and vendor_id = target_vendor_id
    for update;

    if not found or not product_row.is_available or product_row.price is null then
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
    service_flow, pickup_contact_name, collector_name, courier_consent,
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
    'pickup_v1', trim(target_pickup_contact_name),
    case when target_fulfillment_type = 'self_pickup' then trim(target_pickup_contact_name) else null end,
    coalesce(target_courier_consent, false),
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
    null,
    null,
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
    order by (item ->> 'product_id')::uuid
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

  insert into public.pickup_codes(order_id) values (created_order.id);
  return created_order;
end;
$$;

revoke all on function public.create_pickup_order(
  uuid, text, text, text, timestamptz, text, jsonb, text, jsonb, jsonb, text, boolean
) from public, anon;
grant execute on function public.create_pickup_order(
  uuid, text, text, text, timestamptz, text, jsonb, text, jsonb, jsonb, text, boolean
) to authenticated;


revoke all on function public.create_order_with_items(uuid, text, text, text, timestamptz, text, jsonb, text, jsonb, jsonb) from authenticated;

create or replace function public.guard_vendor_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_status text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.request_is_service_role() and not public.is_admin()
       and (new.is_verified or new.online) then
      raise exception 'Toko baru harus menunggu verifikasi admin sebelum berjualan.';
    end if;
    new.online := false;
    new.location := null;
    new.last_seen_at := null;
    return new;
  end if;
  if new.online and (new.is_verified is not true or not exists (
    select 1 from public.profiles where id = new.id and account_status = 'active'
  )) then
    if new.is_verified is distinct from old.is_verified then
      new.online := false;
    else
      raise exception 'Toko harus terverifikasi dan akun aktif sebelum berjualan.';
    end if;
  end if;
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
    if new.online and (new.last_seen_at is distinct from old.last_seen_at) then
      new.last_seen_at := now();
    end if;
    select account_status into actor_status
    from public.profiles
    where id = auth.uid();

    if coalesce(actor_status, 'active') <> 'active' and (
      new.online or (to_jsonb(new) - array['online', 'location', 'last_seen_at', 'updated_at'])
        is distinct from (to_jsonb(old) - array['online', 'location', 'last_seen_at', 'updated_at'])
    ) then
      raise exception 'Akun sedang dibatasi dan tidak dapat mengubah toko.';
    end if;
  end if;

  return new;
end;
$$;

drop policy if exists "vendors_public_read" on public.vendors;
drop trigger if exists vendors_guard_sensitive_fields on public.vendors;
create trigger vendors_guard_sensitive_fields before insert or update on public.vendors
for each row execute function public.guard_vendor_sensitive_fields();
drop policy if exists "vendors_authenticated_read" on public.vendors;
create policy "vendors_authenticated_read"
on public.vendors
for select
to authenticated
using (
  auth.uid() = id
  or public.is_admin()
  or (
    is_verified = true
    and online = true
    and location is not null
    and last_seen_at >= now() - interval '2 minutes'
    and last_seen_at <= now() + interval '30 seconds'
    and exists (
      select 1
      from public.profiles
      where profiles.id = vendors.id
        and profiles.account_status = 'active'
    )
  )
);

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

  if new.payment_status is distinct from old.payment_status and new.payment_status = 'paid' then
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    values (new.buyer_id, 'payment_confirmed', 'Pembayaran dikonfirmasi',
      'Pedagang telah mengonfirmasi pembayaran barang.', 'order', new.id);
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.service_flow = 'pickup_v1' then
    notif_type := 'order_' || new.status;
    notif_title := case new.status
      when 'accepted' then 'Titik pengambilan disetujui'
      when 'ready' then 'Barang siap diambil'
      when 'completed' then 'Serah terima selesai'
      when 'rejected' then 'Permintaan ditolak'
      when 'cancelled' then 'Permintaan dibatalkan'
    end;
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    values (case when new.status = 'cancelled' then new.vendor_id else new.buyer_id end,
      notif_type, notif_title, notif_title || ': pesanan #' || left(new.id::text, 8), 'order', new.id);
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


-- Revoking verification also hides an online vendor. Blocked accounts are hidden by SELECT
-- and may not activate through the backend or direct writes.
update public.vendors set online = false, location = null, last_seen_at = null
where is_verified is not true;

create or replace function public.hide_restricted_vendor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.account_status <> 'active' then
    update public.vendors set online = false, location = null, last_seen_at = null where id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_hide_restricted_vendor on public.profiles;
create trigger profiles_hide_restricted_vendor after update of account_status on public.profiles
for each row execute function public.hide_restricted_vendor();

create or replace function public.guard_product_inventory_mode()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or (new.stock is null) is distinct from (old.stock is null) then
    if exists (select 1 from public.order_items i join public.orders o on o.id = i.order_id
      where i.product_id = old.id and o.status not in ('completed', 'cancelled', 'rejected')) then
      raise exception 'Produk masih memiliki pesanan aktif. Selesaikan pesanan sebelum menghapus atau mengubah mode stok.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists products_guard_inventory_mode on public.products;
create trigger products_guard_inventory_mode before update or delete on public.products
for each row execute function public.guard_product_inventory_mode();

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
      is_available = products.is_available and greatest(products.stock - item_totals.quantity, 0) > 0
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

notify pgrst, 'reload schema';

commit;
