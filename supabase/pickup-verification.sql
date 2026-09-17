-- Read-only deployment verification. Run AFTER pickup-flow.sql.
select
  to_regprocedure('public.create_pickup_order(uuid,text,text,text,timestamptz,text,jsonb,text,jsonb,jsonb,text,boolean)') is not null as checkout_installed,
  to_regprocedure('public.update_pickup_details(uuid,text,text,text)') is not null as details_installed,
  to_regprocedure('public.confirm_pickup_handover(uuid,text)') is not null as handover_installed,
  not has_function_privilege('authenticated', 'public.create_order_with_items(uuid,text,text,text,timestamptz,text,jsonb,text,jsonb,jsonb)', 'execute') as old_checkout_blocked,
  not has_function_privilege('anon', 'public.create_pickup_order(uuid,text,text,text,timestamptz,text,jsonb,text,jsonb,jsonb,text,boolean)', 'execute') as anonymous_checkout_blocked,
  not has_column_privilege('authenticated', 'public.orders', 'handed_over_at', 'update') as handover_not_directly_writable,
  not has_column_privilege('authenticated', 'public.products', 'reserved_stock', 'update') as stock_reservation_protected,
  (select relrowsecurity from pg_class where oid = 'public.pickup_codes'::regclass) as pickup_codes_rls,
  not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pickup_codes') as codes_not_published;

select wanted.table_name,
  exists(select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime'
    and p.schemaname = 'public' and p.tablename = wanted.table_name) as realtime_enabled
from (values ('vendors'), ('orders'), ('messages'), ('notifications')) wanted(table_name);

select service_flow, status, count(*) as order_count from public.orders group by service_flow, status order by service_flow, status;
