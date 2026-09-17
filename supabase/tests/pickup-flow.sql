-- Run with psql as postgres against an isolated database with ALL migrations applied.
-- Transaction rolls back fixtures. Never a substitute for hosted two-device UAT.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end;
$$;
create function pg_temp.expect_error(statement text, label text) returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin execute statement; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, label);
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001', 'buyer@local.test', '{"full_name":"Ani"}'),
 ('10000000-0000-0000-0000-000000000002', 'vendor@local.test', '{"full_name":"Pak Sayur","role":"vendor"}'),
 ('10000000-0000-0000-0000-000000000003', 'stranger@local.test', '{}');
insert into public.profiles (id, display_name, role) values
 ('10000000-0000-0000-0000-000000000001', 'Ani', 'customer'),
 ('10000000-0000-0000-0000-000000000002', 'Pak Sayur', 'vendor'),
 ('10000000-0000-0000-0000-000000000003', 'Stranger', 'customer');
update public.vendors set is_verified = true, online = true, location = '{"lat":1.47,"lng":124.84}',
  last_seen_at = now(), payment_details = '{"bank_account_number":"123456"}', mobility_type = 'walking'
  where id = '10000000-0000-0000-0000-000000000002';
insert into public.products(id, vendor_id, name, price, stock) values
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Tomat', 5000, 10),
 ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Sayur tanpa stok', 2000, null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true((select count(*) = 1 from public.vendors), 'customer discovers verified active vendor BEFORE ordering');
select id as self_id from public.create_pickup_order(
 '10000000-0000-0000-0000-000000000002', 'cod', 'self_pickup', 'asap', null,
 'Gerbang pasar', null, '', null, '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":2}]', 'Ani', false
) \gset
select pg_temp.assert_true((select stock = 10 and reserved_stock = 2 from public.products where id = '20000000-0000-0000-0000-000000000001'), 'checkout reserves, does not decrement stock');
select pg_temp.assert_true((select service_flow = 'pickup_v1' and customer_location is null and vendor_location_snapshot is null from public.orders where id = :'self_id'), 'new flow and no retained live location snapshots');
select pg_temp.assert_true((select count(*) = 0 from public.pickup_codes), 'code hidden before ready');
select pg_temp.expect_error(format('update public.orders set status = %L where id = %L', 'accepted', :'self_id'), 'buyer cannot accept');
select pg_temp.expect_error(format('update public.orders set total_amount = 1 where id = %L', :'self_id'), 'commercial fields not REST writable');
select pg_temp.expect_error(format('update public.orders set handed_over_at = now() where id = %L', :'self_id'), 'handover proof not REST writable');
select public.update_pickup_details(:'self_id', 'Depan pasar', null, 'Gerbang pasar');
select pg_temp.assert_true((select meeting_point_label = 'Depan pasar' and meeting_point_location is null from public.orders where id = :'self_id'), 'pending point edit persists without old pin');
select pg_temp.expect_error(format('select public.update_pickup_details(%L, %L, null, %L)', :'self_id', 'Lost edit', 'Gerbang pasar'), 'stale point edit rejected');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true((select count(*) = 0 from public.orders), 'stranger cannot read orders');
select pg_temp.expect_error(format('select public.update_pickup_details(%L, %L, null, %L)', :'self_id', 'Hacked', 'Depan pasar'), 'stranger cannot change point through RPC');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.expect_error(format('update public.orders set status = %L where id = %L', 'ready', :'self_id'), 'vendor cannot skip approval');
select pg_temp.expect_error('update public.products set reserved_stock = 0', 'vendor cannot forge reserved stock');
select pg_temp.expect_error('update public.products set stock = null where stock is not null', 'active order prevents stock mode change');
select pg_temp.expect_error('delete from public.products where stock is not null', 'active order prevents product deletion');
update public.orders set status = 'accepted' where id = :'self_id';
select pg_temp.assert_true((select point_confirmed_at is not null from public.orders where id = :'self_id'), 'approval timestamp persisted');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.expect_error(format('select public.update_pickup_details(%L, %L, null, %L)', :'self_id', 'New point', 'Depan pasar'), 'approved point locked');
select pg_temp.expect_error(format('update public.orders set status = %L where id = %L', 'cancelled', :'self_id'), 'buyer cannot cancel accepted order');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
update public.orders set status = 'ready' where id = :'self_id';
select pg_temp.assert_true((select count(*) = 0 from public.pickup_codes), 'vendor cannot SELECT buyer code');
select pg_temp.expect_error(format('select public.confirm_pickup_handover(%L,%L)', :'self_id', 'BAD'), 'unpaid handover rejected');
update public.orders set payment_status = 'paid' where id = :'self_id';
select pg_temp.expect_error(format('select public.complete_order_and_decrement_stock(%L)', :'self_id'), 'old RPC cannot bypass pickup code');
select pg_temp.expect_error(format('update public.orders set status = %L where id = %L', 'completed', :'self_id'), 'direct completion cannot bypass pickup code');
select pg_temp.assert_true(public.confirm_pickup_handover(:'self_id', 'BAD') ? 'error', 'wrong code does not complete');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select code as pickup_code from public.pickup_codes where order_id = :'self_id' \gset
select pg_temp.assert_true(length(:'pickup_code') = 10, 'buyer reads own ready code');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select public.confirm_pickup_handover(:'self_id', :'pickup_code');
select public.confirm_pickup_handover(:'self_id', :'pickup_code');
select pg_temp.assert_true((select stock = 8 and reserved_stock = 0 from public.products where id = '20000000-0000-0000-0000-000000000001'), 'completion decrements exactly once');
select pg_temp.assert_true((select status = 'completed' and handed_over_at is not null from public.orders where id = :'self_id'), 'handover proof persisted');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select id as courier_id from public.create_pickup_order(
 '10000000-0000-0000-0000-000000000002', 'bank_transfer', 'customer_courier', 'asap', null,
 'Gerbang pasar', null, '', null, '[{"product_id":"20000000-0000-0000-0000-000000000002","quantity":3}]', 'Ani', true
) \gset
select pg_temp.expect_error(format('update public.orders set payment_status = %L where id = %L', 'pending_confirmation', :'courier_id'), 'no payment confirmation before approval');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
update public.orders set status = 'accepted' where id = :'courier_id';
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
update public.orders set payment_status = 'pending_confirmation' where id = :'courier_id';
select pg_temp.expect_error(format('select public.update_pickup_details(%L, null, %L)', :'courier_id', 'Budi kurir'), 'courier identity only after ready');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
update public.orders set payment_status = 'paid' where id = :'courier_id';
update public.orders set status = 'ready' where id = :'courier_id';
select pg_temp.expect_error(format('select public.confirm_pickup_handover(%L,%L)', :'courier_id', 'BAD'), 'courier must be identified');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.update_pickup_details(:'courier_id', null, 'Budi kurir');
select code as courier_code from public.pickup_codes where order_id = :'courier_id' \gset
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select public.confirm_pickup_handover(:'courier_id', 'WRONG') from generate_series(1,5);
select pg_temp.assert_true(public.confirm_pickup_handover(:'courier_id', :'courier_code') ? 'error', 'lockout also blocks correct code temporarily');
reset role;
select pg_temp.assert_true((select failed_attempts = 5 and locked_until > now() from public.pickup_codes where order_id = :'courier_id'), 'failed-attempt counter commits');
update public.pickup_codes set locked_until = now() - interval '1 minute' where order_id = :'courier_id';
set local role authenticated;
select public.confirm_pickup_handover(:'courier_id', :'courier_code');
select pg_temp.assert_true((select stock is null and is_available from public.products where id = '20000000-0000-0000-0000-000000000002'), 'optional stock stays unlimited after handover');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select id as cancelled_id from public.create_pickup_order(
 '10000000-0000-0000-0000-000000000002', 'cod', 'self_pickup', 'asap', null,
 'Pasar', null, '', null, '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":3}]', 'Ani', false
) \gset
update public.orders set status = 'cancelled' where id = :'cancelled_id';
select pg_temp.assert_true((select stock = 8 and reserved_stock = 0 from public.products where id = '20000000-0000-0000-0000-000000000001'), 'cancellation releases reservation without decrement');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.create_order_with_items(uuid,text,text,text,timestamptz,text,jsonb,text,jsonb,jsonb)', 'execute'), 'old checkout entry point revoked');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.create_pickup_order(uuid,text,text,text,timestamptz,text,jsonb,text,jsonb,jsonb,text,boolean)', 'execute'), 'anonymous checkout denied');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.expect_error('insert into public.vendors(id,user_id,name,is_verified) values (auth.uid(),auth.uid(),''fake'',true)', 'new vendor cannot self-verify');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

create function pg_temp.make_pickup(qty integer, method text default 'self_pickup', consent boolean default false)
returns public.orders language sql as $$
  select public.create_pickup_order('10000000-0000-0000-0000-000000000002', 'cod', method, 'asap', null,
    'Pasar', null, '', null, jsonb_build_array(jsonb_build_object('product_id', '20000000-0000-0000-0000-000000000001', 'quantity', qty)), 'Ani', consent);
$$;
select pg_temp.expect_error('select pg_temp.make_pickup(99)', 'insufficient stock rejects whole checkout');
select pg_temp.expect_error('select pg_temp.make_pickup(-1)', 'negative quantity rejected');
select pg_temp.expect_error('select pg_temp.make_pickup(null)', 'null quantity rejected');
select pg_temp.expect_error('select pg_temp.make_pickup(1, ''delivery'')', 'new order cannot use merchant delivery');
select pg_temp.expect_error('select pg_temp.make_pickup(1, ''customer_courier'', false)', 'courier consent enforced by database');
select id as rejected_id from pg_temp.make_pickup(3) \gset
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
update public.orders set status = 'rejected' where id = :'rejected_id';
select pg_temp.assert_true((select stock = 8 and reserved_stock = 0 from public.products where id = '20000000-0000-0000-0000-000000000001'), 'rejection releases reservation');

reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.vendors set last_seen_at = now() - interval '3 minutes' where id = '10000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true((select count(*) = 0 from public.vendors), 'stale vendor hidden by RLS');
select pg_temp.expect_error('select pg_temp.make_pickup(1)', 'stale vendor cannot receive order');
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.vendors set last_seen_at = now(), is_verified = false where id = '10000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true((select count(*) = 0 from public.vendors), 'unverified vendor hidden by RLS');
select pg_temp.expect_error('select pg_temp.make_pickup(1)', 'unverified vendor cannot receive order');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.expect_error('update public.vendors set online = true', 'unverified vendor cannot activate');
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.vendors set online = false where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.assert_true((select location is null and last_seen_at is null from public.vendors where id = '10000000-0000-0000-0000-000000000002'), 'offline clears live location');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true((select count(*) = 0 from public.vendors), 'offline vendor hidden from customer');
reset role;
select pg_temp.assert_true((select count(*) >= 2 from public.notifications where type = 'order_ready'), 'ready notifications persist');
select pg_temp.assert_true((select count(*) >= 2 from public.notifications where type = 'payment_confirmed'), 'payment notifications persist');
select set_config('request.jwt.claim.sub', '', true);
update public.vendors set is_verified = true, online = true, location = '{"lat":1.47,"lng":124.84}' where id = '10000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
update public.vendors set last_seen_at = now() + interval '1 year' where id = auth.uid();
select pg_temp.assert_true((select last_seen_at = now() from public.vendors where id = auth.uid()), 'heartbeat time comes from database');
update public.vendors set online = false where id = auth.uid();
select pg_temp.assert_true((select location is null and not online from public.vendors where id = auth.uid()), 'vendor may go offline directly');
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.vendors set online = true, location = '{"lat":1.47,"lng":124.84}' where id = '10000000-0000-0000-0000-000000000002';
update public.profiles set account_status = 'blocked' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.assert_true((select not online and location is null from public.vendors where id = '10000000-0000-0000-0000-000000000002'), 'blocking vendor clears presence immediately');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.expect_error('update public.vendors set online = true where id = auth.uid()', 'blocked vendor cannot reactivate');
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.profiles set account_status = 'active' where id = '10000000-0000-0000-0000-000000000002';
insert into public.orders(vendor_id, buyer_id, items, status, payment_method, payment_status, fulfillment_type)
values ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Pesanan lama', 'arrived', 'cod', 'paid', 'delivery') returning id as legacy_id \gset
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select public.complete_order_and_decrement_stock(:'legacy_id');
select pg_temp.assert_true((select service_flow = 'legacy' and status = 'completed' and fulfillment_type = 'delivery' from public.orders where id = :'legacy_id'), 'legacy order remains legacy and can finish');
rollback;
