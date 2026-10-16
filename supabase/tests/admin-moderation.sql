-- Disposable local cluster only, after all repository migrations. Every fixture rolls back.
begin;
do $$ begin
  if inet_server_port() is distinct from 55439 then raise exception 'Use the disposable local test cluster.'; end if;
  if exists (select 1 from auth.users where id in ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002'))
    then raise exception 'QA identities already exist; refusing to touch them.'; end if;
end $$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('50000000-0000-0000-0000-000000000001', 'admin-moderation@local.test', '{}'),
  ('50000000-0000-0000-0000-000000000002', 'vendor-moderation@local.test', '{"role":"vendor"}');
insert into public.profiles (id, display_name, role) values
  ('50000000-0000-0000-0000-000000000001', 'QA admin', 'admin'),
  ('50000000-0000-0000-0000-000000000002', 'QA vendor', 'vendor');
update public.vendors set is_verified = true, online = true, location = '{"lat":1.47,"lng":124.84}', last_seen_at = now()
  where id = '50000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000001', true);
update public.profiles set account_status = 'blocked' where id = '50000000-0000-0000-0000-000000000002' and account_status = 'active';
do $$ begin
  if not exists (select 1 from public.vendors where id = '50000000-0000-0000-0000-000000000002' and online = false and location is null and last_seen_at is null)
    then raise exception 'Blocking must hide the vendor and erase public presence in the same statement.'; end if;
end $$;
update public.profiles set account_status = 'active' where id = '50000000-0000-0000-0000-000000000002';
do $$ begin
  if exists (select 1 from public.vendors where id = '50000000-0000-0000-0000-000000000002' and online = true)
    then raise exception 'Unblocking must not make the vendor online automatically.'; end if;
end $$;
update public.vendors set online = true, location = '{"lat":1.47,"lng":124.84}', last_seen_at = now()
  where id = '50000000-0000-0000-0000-000000000002';
update public.vendors set is_verified = false where id = '50000000-0000-0000-0000-000000000002' and is_verified = true;
do $$ begin
  if not exists (select 1 from public.vendors where id = '50000000-0000-0000-0000-000000000002' and online = false and location is null)
    then raise exception 'Revoking verification must hide the vendor.'; end if;
end $$;
insert into public.admin_actions (admin_id, target_user_id, action_type)
  values ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'remove_vendor_verification');
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000002', true);
do $$ begin
  begin
    insert into public.admin_actions (admin_id, target_user_id, action_type)
      values ('50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'verify_vendor');
    raise exception 'Vendor was allowed to forge an admin action.';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
