// Deliberately restricted to the disposable local PostgreSQL cluster, never hosted data.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
const psql = process.env.PSQL_PATH || 'psql'
const vendor = '30000000-0000-0000-0000-000000000002'
const buyers = ['30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003']
const product = '40000000-0000-0000-0000-000000000001'
const fixtureIds = [vendor, ...buyers].map(id => `'${id}'`).join(',')
const run = sql => new Promise(resolve => {
  const child = spawn(psql, ['-X', '-qAt', '-h', '127.0.0.1', '-p', '55439', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  child.on('error', error => resolve({ code: -1, output: error.message }))
  child.on('close', code => resolve({ code, output }))
  child.stdin.end(sql)
})
const checked = async sql => { const result = await run(sql); assert.equal(result.code, 0, result.output); return result.output.trim() }
let seeded = false
try {
  assert.equal(await checked(`select count(*) from auth.users where id in (${fixtureIds});`), '0', 'fixture IDs must be unused')
  await checked(`begin;
    insert into auth.users(id,email,raw_user_meta_data) values ('${vendor}','race-vendor@local.test','{"role":"vendor"}'), ('${buyers[0]}','race-a@local.test','{}'), ('${buyers[1]}','race-b@local.test','{}');
    insert into public.profiles(id,display_name,role) values ('${vendor}','Vendor race','vendor'), ('${buyers[0]}','Buyer A','customer'), ('${buyers[1]}','Buyer B','customer');
    update public.vendors set is_verified=true, online=true, location='{"lat":1.47,"lng":124.84}', last_seen_at=now() where id='${vendor}';
    insert into public.products(id,vendor_id,name,price,stock) values ('${product}','${vendor}','Stok terakhir',5000,1);
    commit;`)
  seeded = true
  const checkout = buyer => `begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${buyer}',true);
    select id from public.create_pickup_order('${vendor}','cod','self_pickup','asap',null,'Pasar',null,'',null,'[{"product_id":"${product}","quantity":1}]','Pelanggan',false);
    select pg_sleep(0.3);
    commit;`
  const results = await Promise.all(buyers.map(buyer => run(checkout(buyer))))
  assert.equal(results.filter(result => result.code === 0).length, 1, 'exactly one checkout succeeds')
  assert(results.find(result => result.code !== 0).output.includes('tidak mencukupi'), 'loser receives insufficient stock, not a deadlock or unrelated error')
  assert.equal(await checked(`select count(*) from public.orders where vendor_id='${vendor}';`), '1')
  assert.equal(await checked(`select stock || ':' || reserved_stock from public.products where id='${product}';`), '1:1')
  console.log('PASS: concurrent checkouts reserve the last unit once; the other transaction rolls back cleanly.')
} finally {
  if (seeded) await checked(`begin;
    delete from public.orders where vendor_id='${vendor}';
    delete from auth.users where id in (${fixtureIds});
    commit;`)
}
