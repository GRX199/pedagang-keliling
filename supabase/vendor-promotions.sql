alter table public.vendors
  add column if not exists promo_text text,
  add column if not exists promo_expires_at timestamptz;
