-- Run after pickup-simple-handover.sql. Both updates share one locked transaction.
begin;
create or replace function public.complete_pickup_order(target_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = target_order_id for update;
  if not found or auth.uid() is null or auth.uid() <> o.vendor_id or o.service_flow <> 'pickup_v1'
    or not exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active') then
    raise exception 'Anda tidak dapat menyelesaikan pesanan ini.';
  end if;
  if o.status = 'completed' then return jsonb_build_object('order', to_jsonb(o)); end if;
  if o.status <> 'ready' then raise exception 'Barang belum siap diambil.'; end if;
  if o.payment_method = 'cod' and o.payment_status = 'unpaid' then
    update public.orders set payment_status = 'paid' where id = o.id returning * into o;
  end if;
  if o.payment_status <> 'paid' then raise exception 'Pembayaran non-tunai harus diperiksa terlebih dahulu.'; end if;
  update public.orders set status = 'completed', handed_over_at = now() where id = o.id returning * into o;
  delete from public.pickup_codes where order_id = o.id;
  return jsonb_build_object('order', to_jsonb(o));
end;
$$;
revoke all on function public.complete_pickup_order(uuid) from public, anon;
grant execute on function public.complete_pickup_order(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
