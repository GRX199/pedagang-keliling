alter table public.vendors
  add column if not exists payment_details jsonb not null default '{}'::jsonb;

update public.vendors
set payment_details = '{}'::jsonb
where payment_details is null;

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('cod', 'qris', 'bank_transfer', 'ewallet'));

comment on column public.vendors.payment_details is 'Vendor payment instructions such as QRIS image, bank account, and e-wallet number.';
