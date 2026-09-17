-- Run after pickup-flow.sql, before deploying the code-free handover UI.
begin;

-- Keep the old argument for cached clients, but no longer require or validate a code.
create or replace function public.confirm_pickup_handover(target_order_id uuid, target_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = target_order_id for update;
  if not found or auth.uid() is null or auth.uid() <> o.vendor_id or o.service_flow <> 'pickup_v1'
    or not exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active') then
    raise exception 'Anda tidak dapat menyelesaikan pengambilan ini.';
  end if;
  if o.status = 'completed' then return jsonb_build_object('order', to_jsonb(o)); end if;
  if o.status <> 'ready' or o.payment_status <> 'paid' then
    raise exception 'Barang harus siap dan pembayaran lunas sebelum pesanan diselesaikan.';
  end if;
  update public.orders set status = 'completed', handed_over_at = now() where id = o.id returning * into o;
  delete from public.pickup_codes where order_id = o.id;
  return jsonb_build_object('order', to_jsonb(o));
end;
$$;
revoke all on function public.confirm_pickup_handover(uuid, text) from public, anon;
grant execute on function public.confirm_pickup_handover(uuid, text) to authenticated;
-- The old table remains for compatibility with the original checkout migration.
revoke select (order_id, code) on public.pickup_codes from authenticated;
notify pgrst, 'reload schema';
commit;
