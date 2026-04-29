-- Optional inventory automation for Kelilingku.
-- Run this in Supabase SQL Editor so completing an order can reduce product stock atomically.

alter table public.products
  add column if not exists stock integer,
  add column if not exists is_available boolean not null default true;

alter table public.products
  drop constraint if exists products_stock_non_negative;

alter table public.products
  add constraint products_stock_non_negative
  check (stock is null or stock >= 0);

create or replace function public.decrement_product_stock_for_order(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products as products
  set
    stock = greatest(products.stock - item_totals.quantity, 0),
    is_available = case
      when greatest(products.stock - item_totals.quantity, 0) <= 0 then false
      else products.is_available
    end
  from (
    select
      order_items.product_id,
      order_items.vendor_id,
      sum(order_items.quantity)::integer as quantity
    from public.order_items
    where order_items.order_id = target_order_id
      and order_items.product_id is not null
    group by order_items.product_id, order_items.vendor_id
  ) as item_totals
  where products.id = item_totals.product_id
    and products.vendor_id = item_totals.vendor_id
    and products.stock is not null;
end;
$$;

revoke all on function public.decrement_product_stock_for_order(uuid) from public, anon, authenticated;

create or replace function public.complete_order_and_decrement_stock(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders%rowtype;
begin
  select *
  into target_order
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

  if target_order.status <> 'arrived' then
    raise exception 'Pesanan harus berstatus sudah tiba sebelum diselesaikan.';
  end if;

  if target_order.payment_status <> 'paid' then
    raise exception 'Pembayaran harus lunas sebelum pesanan diselesaikan.';
  end if;

  update public.orders
  set status = 'completed'
  where id = target_order_id
  returning * into target_order;

  perform public.decrement_product_stock_for_order(target_order_id);

  return target_order;
end;
$$;

grant execute on function public.complete_order_and_decrement_stock(uuid) to authenticated;
