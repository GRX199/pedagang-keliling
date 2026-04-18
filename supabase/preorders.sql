alter table public.orders
  add column if not exists order_timing text not null default 'asap',
  add column if not exists requested_fulfillment_at timestamptz;

alter table public.orders
  drop constraint if exists orders_order_timing_check;

alter table public.orders
  add constraint orders_order_timing_check
  check (order_timing in ('asap', 'preorder'));

create index if not exists orders_timing_requested_idx
  on public.orders (order_timing, requested_fulfillment_at desc);

comment on column public.orders.order_timing is 'Whether the order should be processed immediately or kept as a pre-order for a later pass-by area.';
comment on column public.orders.requested_fulfillment_at is 'Requested handoff time for pre-orders or scheduled neighborhood pass-by.';
