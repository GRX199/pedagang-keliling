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

select pg_temp.expect_error(format('select public.complete_pickup_order(%L)', :'self_id'), 'buyer cannot complete');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.expect_error(format('select public.complete_pickup_order(%L)', :'self_id'), 'stranger cannot complete');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.expect_error(format('select public.complete_pickup_order(%L)', :'self_id'), 'pending cannot complete');
update public.orders set status = 'accepted' where id = :'self_id';
update public.orders set status = 'ready' where id = :'self_id';

select pg_temp.expect_error(format('update public.orders set status = ''completed'' where id = %L', :'self_id'), 'direct status cannot bypass handover');
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.orders set collector_name = null where id = :'self_id';
update public.profiles set account_status = 'blocked' where id = '10000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.expect_error(format('select public.complete_pickup_order(%L)', :'self_id'), 'blocked vendor cannot complete');
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.profiles set account_status = 'active' where id = '10000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select public.complete_pickup_order(:'self_id');
select public.complete_pickup_order(:'self_id');
select pg_temp.assert_true((select status = 'completed' and payment_status = 'paid' and handed_over_at is not null from public.orders where id = :'self_id'), 'code-free handover recorded without collector name');
select pg_temp.assert_true((select stock = 8 and reserved_stock = 0 from public.products where id = '20000000-0000-0000-0000-000000000001'), 'stock decremented exactly once');
select pg_temp.assert_true(not has_column_privilege('authenticated', 'public.pickup_codes', 'code', 'SELECT'), 'old codes inaccessible');
rollback;
