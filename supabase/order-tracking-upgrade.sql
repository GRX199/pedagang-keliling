-- Order tracking upgrade for existing Phase 1 databases.
-- Adds customer and vendor location snapshots so the tracking page
-- can show both points consistently for buyer and vendor roles.

alter table public.orders
  add column if not exists customer_location jsonb,
  add column if not exists vendor_location_snapshot jsonb;

comment on column public.orders.customer_location is
  'Snapshot lokasi pelanggan saat checkout untuk kebutuhan tracking order.';

comment on column public.orders.vendor_location_snapshot is
  'Snapshot lokasi pedagang saat order dibuat sebagai fallback tracking.';
