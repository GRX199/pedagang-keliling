create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  buyer_name text,
  rating integer not null,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_rating_range check (rating between 1 and 5)
);

create index if not exists reviews_vendor_created_idx
  on public.reviews (vendor_id, created_at desc);

create index if not exists reviews_buyer_created_idx
  on public.reviews (buyer_id, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read"
on public.reviews
for select
to anon, authenticated
using (true);

drop policy if exists "reviews_buyer_insert" on public.reviews;
create policy "reviews_buyer_insert"
on public.reviews
for insert
to authenticated
with check (
  auth.uid() = buyer_id
  and exists (
    select 1
    from public.orders
    where orders.id = reviews.order_id
      and orders.buyer_id = auth.uid()
      and orders.vendor_id = reviews.vendor_id
      and orders.status = 'completed'
  )
);

drop policy if exists "reviews_buyer_update" on public.reviews;
create policy "reviews_buyer_update"
on public.reviews
for update
to authenticated
using (auth.uid() = buyer_id)
with check (
  auth.uid() = buyer_id
  and exists (
    select 1
    from public.orders
    where orders.id = reviews.order_id
      and orders.buyer_id = auth.uid()
      and orders.vendor_id = reviews.vendor_id
      and orders.status = 'completed'
  )
);

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();

comment on table public.reviews is 'Customer ratings and written reviews tied to completed orders.';
