-- Apply after production-hardening.sql. Safe to run again.
-- Final orders must not accept a new payment confirmation from either participant.
create or replace function public.guard_final_order_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.request_is_service_role() or public.is_admin() then
    return new;
  end if;

  if old.status in ('completed', 'cancelled', 'rejected')
     and new.payment_status is distinct from old.payment_status then
    raise exception 'Pembayaran pesanan yang sudah berakhir tidak dapat diubah.';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_guard_final_payment on public.orders;
create trigger orders_guard_final_payment
before update on public.orders
for each row execute function public.guard_final_order_payment();
