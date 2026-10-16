import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parse } from '../server/node_modules/dotenv/lib/main.js'
import { runHostedBrowserQA } from './hosted-browser-qa.mjs'

// Deliberately opt-in: this script writes only disposable, explicitly labelled QA data.
if (!process.argv.includes('--allow-hosted-writes')) {
  throw new Error(
    'Hosted writes require --allow-hosted-writes and explicit project-owner permission.',
  )
}

const front = parse(readFileSync('.env.local'))
const back = parse(readFileSync('server/.env'))
const secrets = [back.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean)
const redact = (value) =>
  secrets
    .reduce(
      (text, secret) => text.replaceAll(secret, '[redacted]'),
      String(value),
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[redacted token]',
    )
assert.equal(
  front.VITE_SUPABASE_URL,
  back.SUPABASE_URL,
  'Frontend/backend project mismatch',
)
const url = front.VITE_SUPABASE_URL
const publicKey =
  front.VITE_SUPABASE_PUBLISHABLE_KEY || front.VITE_SUPABASE_ANON_KEY
assert.ok(
  url && publicKey && back.SUPABASE_SERVICE_ROLE_KEY,
  'Missing QA environment',
)
const statePath = resolve('test-results/hosted-qa-state.json')
const reportPath = resolve(
  process.argv.includes('--cleanup-only')
    ? 'test-results/hosted-qa-cleanup-report.json'
    : 'test-results/hosted-qa-report.json',
)
mkdirSync(resolve('test-results'), { recursive: true })
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : {
      runId: randomUUID(),
      project: new URL(url).hostname,
      users: [],
      storage: [],
      cleaned: false,
    }
assert.equal(
  state.project,
  new URL(url).hostname,
  'Recovery journal belongs to another project',
)
if (state.cleaned && !process.argv.includes('--cleanup-only')) {
  state.runId = randomUUID()
  state.users = []
  state.storage = []
  state.uploadOwners = []
  state.cleaned = false
}
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2))
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal || AbortSignal.timeout(30_000),
      }),
  },
}
const admin = createClient(url, back.SUPABASE_SERVICE_ROLE_KEY, options)
const clients = []
const checks = []
const warnings = []
const deployedMode = process.argv.includes('--deployed')
let apiProcess
let apiOrigin
let frontend
let appOrigin
const unwrap = ({ data, error }) => {
  if (error)
    throw new Error(
      `${error.code || error.status || 'request'}: ${error.message}`,
    )
  return data
}
const check = async (name, run) => {
  await run()
  checks.push(name)
  console.log(`PASS: ${name}`)
}

async function useDeployedTargets() {
  // Only the production origins explicitly approved by the project owner.
  appOrigin = 'https://pedagang-keliling.vercel.app'
  apiOrigin = 'https://pedagang-keliling-api.onrender.com'
  const htmlResponse = await fetch(appOrigin, { signal: AbortSignal.timeout(30_000) })
  assert.ok(htmlResponse.ok, 'Deployed frontend unavailable')
  const html = await htmlResponse.text()
  const entry = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/)?.[1]
  assert.ok(entry, 'No deployed entry bundle')
  const entryUrl = new URL(entry, appOrigin)
  assert.equal(entryUrl.origin, appOrigin, 'Unexpected deployed entry origin')
  const entryResponse = await fetch(entryUrl, { signal: AbortSignal.timeout(30_000) })
  assert.ok(entryResponse.ok, 'Deployed entry unavailable')
  const bundle = await entryResponse.text()
  assert.ok(bundle.includes(url), 'Deployed frontend uses another Supabase project; no QA accounts created')
  assert.ok(bundle.includes(apiOrigin), 'Deployed frontend uses another API; no QA accounts created')
  const worker = await fetch(`${appOrigin}/sw.js`, { signal: AbortSignal.timeout(30_000) })
  assert.ok(worker.ok && (await worker.text()).includes("const OFFLINE_URL = '/offline.html'"), 'Latest worker is not deployed yet')
  const health = await fetch(apiOrigin, { headers: { Origin: appOrigin }, signal: AbortSignal.timeout(60_000) })
  assert.ok(health.ok && (await health.json()).ok === true, 'Deployed API unavailable')
  assert.equal(health.headers.get('access-control-allow-origin'), appOrigin, 'Deployed API CORS mismatch')
}

async function startLocalApi() {
  const socket = createServer()
  await new Promise((done, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', done)
  })
  const port = socket.address().port
  await new Promise((done) => socket.close(done))
  apiOrigin = `http://127.0.0.1:${port}`
  if (process.argv.includes('--browser-ui')) {
    const { createServer: createViteServer } = await import('vite')
    frontend = await createViteServer({
      cacheDir: 'test-results/vite-hosted-cache',
      server: { host: '127.0.0.1', port: 0, strictPort: true },
      define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify(apiOrigin) },
    })
    await frontend.listen()
    appOrigin = `http://127.0.0.1:${frontend.httpServer.address().port}`
  }
  apiProcess = spawn(process.execPath, ['app.js'], {
    cwd: resolve('server'),
    env: {
      ...process.env,
      ...back,
      PORT: String(port),
      ...(appOrigin ? { CORS_ORIGIN: appOrigin } : {}),
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  let listening = false
  apiProcess.stdout.on('data', (data) => {
    if (String(data).includes('API server listening')) listening = true
  })
  let startError
  let healthStatus
  apiProcess.once('error', (error) => {
    startError = error
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startError) throw startError
    if (apiProcess.exitCode !== null)
      throw new Error('Local API could not start')
    const health = await fetch(apiOrigin, {
      signal: AbortSignal.timeout(1000),
    }).catch((error) => {
      healthStatus = error.cause?.code || error.name
      return null
    })
    if (health) healthStatus = health.status
    if (health?.ok) return
    await new Promise((done) => setTimeout(done, 200))
  }
  throw new Error(
    `Local API startup timeout (listening=${listening}; health=${healthStatus})`,
  )
}

async function createActor(role, suffix, bootstrap = true) {
  const email = `codex-qa-${state.runId}-${suffix}@example.test`
  const password = randomBytes(30).toString('base64url')
  secrets.push(password)
  // Store intended email first, so interrupted account creation remains recoverable.
  const entry = { email, id: null }
  state.users.push(entry)
  save()
  const data = unwrap(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role,
        full_name: `QA TEST ${suffix} - jangan bertransaksi`,
        qa_run_id: state.runId,
      },
    }),
  )
  entry.id = data.user.id
  save()
  const client = createClient(url, publicKey, options)
  clients.push(client)
  const signedIn = unwrap(
    await client.auth.signInWithPassword({ email, password }),
  )
  assert.equal(signedIn.user.id, entry.id)
  secrets.push(signedIn.session.access_token, signedIn.session.refresh_token)
  if (!bootstrap)
    return {
      id: entry.id,
      client,
      email,
      password,
      token: signedIn.session.access_token,
    }
  // AuthProvider calls syncCurrentProfile after login; profiles are not created by an auth trigger.
  unwrap(
    await client
      .from('profiles')
      .upsert({
        id: entry.id,
        display_name: data.user.user_metadata.full_name,
        role,
      })
      .select('id')
      .single(),
  )
  const profile = unwrap(
    await client.from('profiles').select('*').eq('id', entry.id).single(),
  )
  assert.equal(
    profile.role,
    role,
    'The app profile bootstrap must preserve the expected role',
  )
  assert.equal(profile.account_status, 'active')
  return {
    id: entry.id,
    client,
    email,
    password,
    token: signedIn.session.access_token,
  }
}

async function cleanup() {
  // Resolve only our journalled email if execution stopped before recording its ID.
  if (state.users.some((entry) => !entry.id)) {
    for (let page = 1; ; page += 1) {
      const { users } = unwrap(
        await admin.auth.admin.listUsers({ page, perPage: 100 }),
      )
      for (const entry of state.users) {
        const match = users.find(
          (user) =>
            user.email === entry.email &&
            user.user_metadata.qa_run_id === state.runId,
        )
        if (!entry.id && match) entry.id = match.id
      }
      if (users.length < 100 || state.users.every((entry) => entry.id)) break
    }
    save()
  }
  const ids = state.users.map((entry) => entry.id).filter(Boolean)
  for (const entry of state.users.filter((item) => item.id)) {
    const result = await admin.auth.admin.getUserById(entry.id)
    if (result.error?.status === 404) continue
    const { user } = unwrap(result)
    assert.equal(
      user.email,
      entry.email,
      'Refuse to clean an unrelated account',
    )
    assert.equal(
      user.user_metadata.qa_run_id,
      state.runId,
      'Missing QA ownership marker',
    )
  }
  if (ids.length) {
    // Hide the disposable shop before cleanup and stop if a real account interacted with it.
    unwrap(await admin.from('vendors').update({ online: false, location: null, last_seen_at: null }).in('id', ids))
    const orders = unwrap(await admin.from('orders').select('buyer_id,vendor_id').or(`buyer_id.in.(${ids.join(',')}),vendor_id.in.(${ids.join(',')})`))
    assert.ok(orders.every(order => ids.includes(order.buyer_id) && ids.includes(order.vendor_id)), 'QA order has an external participant; manual review required')
    const favorites = unwrap(await admin.from('favorites').select('buyer_id').in('vendor_id', ids))
    assert.ok(favorites.every(favorite => ids.includes(favorite.buyer_id)), 'QA shop was favorited by an external account; manual review required')
    for (const id of ids) {
      const chats = unwrap(await admin.from('chats').select('participants').contains('participants', [id]))
      assert.ok(chats.every(chat => chat.participants.every(participant => ids.includes(participant))), 'QA chat has an external participant; manual review required')
    }
  }
  // Recover uploads if the process stopped after the API wrote a file but before its response was journalled.
  for (const owner of state.uploadOwners || []) {
    assert.ok(ids.includes(owner), 'Unowned upload recovery folder')
    const bucket = back.SUPABASE_BUCKET || 'data'
    const folder = `vendors/${owner}/chat`
    const files = unwrap(await admin.storage.from(bucket).list(folder))
    for (const file of files) {
      assert.ok(!file.name.includes('/'), 'Unexpected nested recovery path')
      const path = `${folder}/${file.name}`
      if (
        !state.storage.some(
          (item) => item.bucket === bucket && item.path === path,
        )
      )
        state.storage.push({ bucket, path })
    }
    save()
  }
  for (const object of state.storage) {
    assert.ok(
      ids.some((id) => object.path.startsWith(`vendors/${id}/chat/`)),
      'Unowned storage path',
    )
    unwrap(await admin.storage.from(object.bucket).remove([object.path]))
    const folder = object.path.slice(0, object.path.lastIndexOf('/'))
    const filename = object.path.slice(object.path.lastIndexOf('/') + 1)
    const files = unwrap(
      await admin.storage
        .from(object.bucket)
        .list(folder, { search: filename }),
    )
    assert.ok(
      !files.some((file) => file.name === filename),
      'Uploaded QA image remains',
    )
  }
  // Chat participants have no user FK, so they need explicit, ownership-checked cleanup.
  for (const id of ids) {
    const chats = unwrap(
      await admin
        .from('chats')
        .select('id,participants')
        .contains('participants', [id]),
    )
    for (const chat of chats) {
      assert.ok(
        chat.participants.every((participant) => ids.includes(participant)),
        'QA chat has an external participant; manual review required',
      )
      unwrap(await admin.from('chats').delete().eq('id', chat.id))
    }
  }
  for (const id of ids) {
    // All other test records have real cascading FKs to these QA auth users/vendors.
    const result = await admin.auth.admin.deleteUser(id)
    if (result.error?.status !== 404) unwrap(result)
  }
  for (const id of ids) {
    const result = await admin.auth.admin.getUserById(id)
    assert.equal(result.error?.status, 404, 'QA auth account still exists')
    for (const [table, column] of [
      ['profiles', 'id'],
      ['vendors', 'id'],
      ['orders', 'buyer_id'],
      ['products', 'vendor_id'],
      ['messages', 'from_user'],
      ['notifications', 'user_id'],
    ]) {
      const rows = unwrap(
        await admin.from(table).select('id').eq(column, id).limit(1),
      )
      assert.equal(rows.length, 0, `QA rows remain in ${table}`)
    }
  }
  state.cleaned = true
  save()
  console.log(
    'PASS: all journalled QA accounts, rows and uploaded images removed',
  )
}

async function run() {
  assert.ok(!(deployedMode && process.argv.includes('--local-api')), 'Choose --deployed or --local-api, not both')
  assert.ok(
    !process.argv.includes('--browser-ui') ||
      process.argv.includes('--local-api') || deployedMode,
    '--browser-ui requires --local-api or --deployed',
  )
  assert.ok(
    !state.users.length,
    'Unfinished QA journal exists; first run with --cleanup-only',
  )
  if (deployedMode) await useDeployedTargets()
  const buyer = await createActor('customer', 'customer')
  const vendor = await createActor('vendor', 'vendor')
  const stranger = await createActor('customer', 'outsider')
  if (process.argv.includes('--local-api')) await startLocalApi()
  await check(
    'real auth, app profile bootstrap, vendor trigger and roles',
    async () => {
      const row = unwrap(
        await vendor.client
          .from('vendors')
          .select('*')
          .eq('id', vendor.id)
          .single(),
      )
      assert.equal(row.online, false)
      assert.equal(row.is_verified, false)
      const forbidden = await vendor.client
        .from('vendors')
        .update({ is_verified: true })
        .eq('id', vendor.id)
        .select('id')
      assert.ok(forbidden.error, 'Vendor must not self-verify')
      const escalation = await buyer.client
        .from('profiles')
        .update({ role: 'admin' })
        .eq('id', buyer.id)
        .select('id')
      assert.ok(escalation.error, 'Customer must not self-promote')
    },
  )
  unwrap(
    await admin
      .from('vendors')
      .update({
        is_verified: true,
        category_primary: 'Kopi',
        mobility_type: 'pushcart',
      })
      .eq('id', vendor.id),
  )
  unwrap(
    await vendor.client
      .from('vendors')
      .update({
        online: true,
        location: { lat: 1.475, lng: 124.849 },
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', vendor.id),
  )
  const product = unwrap(
    await vendor.client
      .from('products')
      .insert({
        vendor_id: vendor.id,
        name: 'QA TEST - bukan produk jual',
        price: 1000,
        stock: 10,
        is_available: true,
      })
      .select('*')
      .single(),
  )
  const unlimited = unwrap(
    await vendor.client
      .from('products')
      .insert({
        vendor_id: vendor.id,
        name: 'QA TEST stok opsional',
        price: 500,
        stock: null,
        is_available: true,
      })
      .select('*')
      .single(),
  )
  const productRow = async () =>
    unwrap(
      await vendor.client
        .from('products')
        .select('*')
        .eq('id', product.id)
        .single(),
    )
  const refreshPresence = async () =>
    unwrap(
      await vendor.client
        .from('vendors')
        .update({
          online: true,
          location: { lat: 1.475, lng: 124.849 },
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', vendor.id),
    )
  const createOrder = async (overrides = {}) => {
    await refreshPresence()
    return unwrap(
      await buyer.client.rpc('create_pickup_order', {
        target_vendor_id: vendor.id,
        target_payment_method: 'cod',
        target_fulfillment_type: 'self_pickup',
        target_order_timing: 'asap',
        target_requested_fulfillment_at: null,
        target_meeting_point_label: 'QA TEST titik pengambilan',
        target_meeting_point_location: { lat: 1.476, lng: 124.85 },
        target_customer_note: `QA TEST ${state.runId}; tidak ada uang sungguhan`,
        target_customer_location: null,
        target_items: [
          { product_id: product.id, quantity: 2, note: 'QA TEST' },
        ],
        target_pickup_contact_name: 'QA TEST pelanggan',
        target_courier_consent: false,
        ...overrides,
      }),
    )
  }
  if (apiOrigin)
    await check(
      `authenticated ${deployedMode ? 'deployed' : 'local'} API presence, ownership checks and real Storage upload`,
      async () => {
        const onlineRequest = (actor, id, online) =>
          fetch(`${apiOrigin}/api/vendor/${id}/online`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${actor.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ online }),
          })
        assert.equal(
          (
            await fetch(`${apiOrigin}/api/vendor/${vendor.id}/online`, {
              method: 'POST',
            })
          ).status,
          401,
        )
        assert.equal((await onlineRequest(buyer, vendor.id, false)).status, 403)
        const response = await onlineRequest(vendor, vendor.id, true)
        assert.equal(response.status, 200)
        assert.equal((await response.json()).online, true)
        const form = new FormData()
        form.append('folder', 'chat')
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=',
          'base64',
        )
        form.append(
          'file',
          new Blob([png], { type: 'image/png' }),
          `qa-${state.runId}.png`,
        )
        state.uploadOwners = [
          ...new Set([...(state.uploadOwners || []), buyer.id]),
        ]
        save()
        const upload = await fetch(`${apiOrigin}/upload-only`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${buyer.token}` },
          body: form,
        })
        assert.equal(
          upload.status,
          200,
          'Authenticated chat upload must work with the actual project key',
        )
        const uploaded = await upload.json()
        assert.ok(uploaded.path.startsWith(`vendors/${buyer.id}/chat/`))
        state.storage.push({
          bucket: back.SUPABASE_BUCKET || 'data',
          path: uploaded.path,
        })
        save()
        assert.ok(uploaded.imageUrl)
        const image = await fetch(uploaded.imageUrl)
        assert.equal(image.status, 200)
        assert.match(image.headers.get('content-type'), /image\/png/)
      },
    )
  await check('public presence and cross-vendor product RLS', async () => {
    const visible = unwrap(
      await buyer.client
        .from('vendors')
        .select('id,location')
        .eq('id', vendor.id),
    )
    assert.equal(visible.length, 1)
    const denied = await buyer.client
      .from('products')
      .update({ price: 1 })
      .eq('id', product.id)
      .select('id')
    assert.equal(denied.data?.length || 0, 0)
    assert.equal((await productRow()).price, 1000)
  })
  const order = await createOrder()
  await check(
    'pickup RPC, authoritative prices and stock reservation',
    async () => {
      assert.equal(order.service_flow, 'pickup_v1')
      assert.equal(order.status, 'pending')
      assert.equal(order.total_amount, 2000)
      assert.equal((await productRow()).stock, 10)
      assert.equal((await productRow()).reserved_stock, 2)
      const inaccessible = unwrap(
        await stranger.client.from('orders').select('id').eq('id', order.id),
      )
      assert.equal(inaccessible.length, 0)
      const denied = await buyer.client
        .from('orders')
        .update({ status: 'accepted' })
        .eq('id', order.id)
        .select('id')
      assert.ok(denied.error || !denied.data?.length)
    },
  )
  await check(
    'vendor progress + atomic code-free COD completion + idempotent retry',
    async () => {
      for (const status of ['accepted', 'ready']) {
        const changed = unwrap(
          await vendor.client
            .from('orders')
            .update({ status })
            .eq('id', order.id)
            .select('status')
            .single(),
        )
        assert.equal(changed.status, status)
      }
      const result = unwrap(
        await vendor.client.rpc('complete_pickup_order', {
          target_order_id: order.id,
        }),
      )
      assert.equal(result.order.status, 'completed')
      assert.equal(result.order.payment_status, 'paid')
      assert.ok(result.order.handed_over_at)
      unwrap(
        await vendor.client.rpc('complete_pickup_order', {
          target_order_id: order.id,
        }),
      )
      const stock = await productRow()
      assert.equal(stock.stock, 8)
      assert.equal(stock.reserved_stock, 0)
    },
  )
  await check(
    'courier without location, customer cancellation and stock release',
    async () => {
      const courier = await createOrder({
        target_fulfillment_type: 'customer_courier',
        target_courier_consent: true,
        target_meeting_point_location: null,
      })
      assert.equal(courier.meeting_point_location, null)
      unwrap(
        await buyer.client
          .from('orders')
          .update({ status: 'cancelled' })
          .eq('id', courier.id)
          .select('id')
          .single(),
      )
      assert.equal((await productRow()).reserved_stock, 0)
      assert.equal((await productRow()).stock, 8)
    },
  )
  await check('optional inventory and rejected order release', async () => {
    const next = await createOrder({
      target_items: [{ product_id: unlimited.id, quantity: 3 }],
    })
    unwrap(
      await vendor.client
        .from('orders')
        .update({ status: 'rejected' })
        .eq('id', next.id)
        .select('id')
        .single(),
    )
    const row = unwrap(
      await vendor.client
        .from('products')
        .select('*')
        .eq('id', unlimited.id)
        .single(),
    )
    assert.equal(row.stock, null)
    assert.equal(row.reserved_stock, 0)
  })
  await check(
    'manual non-COD payment must be confirmed before completion',
    async () => {
      unwrap(
        await vendor.client
          .from('vendors')
          .update({
            payment_details: {
              bank_name: 'QA TEST',
              bank_account_name: 'QA TEST - jangan transfer',
              bank_account_number: '0000000000',
            },
          })
          .eq('id', vendor.id),
      )
      const manual = await createOrder({
        target_payment_method: 'bank_transfer',
        target_items: [{ product_id: product.id, quantity: 1 }],
      })
      for (const status of ['accepted', 'ready'])
        unwrap(
          await vendor.client
            .from('orders')
            .update({ status })
            .eq('id', manual.id)
            .select('id')
            .single(),
        )
      const unpaid = await vendor.client.rpc('complete_pickup_order', {
        target_order_id: manual.id,
      })
      assert.ok(unpaid.error, 'Unpaid bank transfer cannot complete')
      unwrap(
        await buyer.client
          .from('orders')
          .update({ payment_status: 'pending_confirmation' })
          .eq('id', manual.id)
          .select('id')
          .single(),
      )
      unwrap(
        await vendor.client
          .from('orders')
          .update({ payment_status: 'paid' })
          .eq('id', manual.id)
          .select('id')
          .single(),
      )
      const result = unwrap(
        await vendor.client.rpc('confirm_pickup_handover', {
          target_order_id: manual.id,
        }),
      )
      assert.equal(result.order.status, 'completed')
      assert.equal((await productRow()).stock, 7)
      assert.equal((await productRow()).reserved_stock, 0)
    },
  )
  await check(
    'overselling is rejected without orphan order/reservation',
    async () => {
      const result = await buyer.client.rpc('create_pickup_order', {
        target_vendor_id: vendor.id,
        target_payment_method: 'cod',
        target_fulfillment_type: 'self_pickup',
        target_order_timing: 'asap',
        target_requested_fulfillment_at: null,
        target_meeting_point_label: 'QA TEST',
        target_meeting_point_location: null,
        target_customer_note: 'QA TEST',
        target_customer_location: null,
        target_items: [{ product_id: product.id, quantity: 99 }],
        target_pickup_contact_name: 'QA TEST',
        target_courier_consent: false,
      })
      assert.ok(result.error)
      assert.equal((await productRow()).reserved_stock, 0)
    },
  )
  const chat = unwrap(
    await buyer.client
      .from('chats')
      .insert({ participants: [buyer.id, vendor.id] })
      .select('*')
      .single(),
  )
  let realtimeResolve
  const realtimeEvent = new Promise((done) => {
    realtimeResolve = done
  })
  let readyResolve
  const backendReady = new Promise((done) => {
    readyResolve = done
  })
  const systemStatuses = []
  await vendor.client.realtime.setAuth()
  const channel = vendor.client
    .channel(`qa-${state.runId}`)
    .on('system', {}, (payload) => {
      systemStatuses.push(`${payload.extension}:${payload.status}`)
      if (payload.extension === 'postgres_changes' && payload.status === 'ok')
        readyResolve(true)
    })
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chat.id}`,
      },
      () => realtimeResolve(true),
    )
  let subscribeTimer
  const realtimeStatuses = []
  const subscribed = await new Promise((done) => {
    subscribeTimer = setTimeout(() => done(false), 12_000)
    channel.subscribe((status) => {
      realtimeStatuses.push(status)
      if (status === 'SUBSCRIBED') {
        clearTimeout(subscribeTimer)
        done(true)
      }
    })
  })
  try {
    let readyTimer
    const ready =
      subscribed &&
      (await Promise.race([
        backendReady,
        new Promise((done) => {
          readyTimer = setTimeout(() => done(false), 12_000)
        }),
      ]))
    clearTimeout(readyTimer)
    if (!ready)
      warnings.push(
        `Postgres replication readiness not confirmed (${systemStatuses.join(',') || 'no system status'}).`,
      )
    await check(
      'chat message, participant identity, RLS and generated notification',
      async () => {
        const message = unwrap(
          await buyer.client
            .from('messages')
            .insert({
              chat_id: chat.id,
              from_user: buyer.id,
              text: `QA TEST ${state.runId}`,
            })
            .select('*')
            .single(),
        )
        const rows = unwrap(
          await vendor.client
            .from('messages')
            .select('id,text')
            .eq('id', message.id),
        )
        assert.equal(rows.length, 1)
        assert.equal(
          unwrap(
            await stranger.client
              .from('messages')
              .select('id')
              .eq('id', message.id),
          ).length,
          0,
        )
        const identity = unwrap(
          await vendor.client
            .from('profiles')
            .select('display_name')
            .eq('id', buyer.id)
            .single(),
        )
        assert.match(identity.display_name, /QA TEST/)
        const inbox = unwrap(
          await vendor.client
            .from('notifications')
            .select('*')
            .eq('user_id', vendor.id)
            .eq('entity_id', chat.id),
        )
        assert.ok(inbox.length, 'Chat trigger must generate notification')
        assert.ok(
          inbox.some(
            (row) =>
              row.body?.includes('QA TEST') || row.title.includes('QA TEST'),
          ),
        )
        const notification = inbox[0]
        unwrap(
          await vendor.client
            .from('notifications')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('id', notification.id)
            .select('id')
            .single(),
        )
        assert.equal(
          unwrap(
            await stranger.client
              .from('notifications')
              .select('id')
              .eq('id', notification.id),
          ).length,
          0,
        )
      },
    )
    let timeout
    const delivered =
      subscribed &&
      (await Promise.race([
        realtimeEvent,
        new Promise((done) => {
          timeout = setTimeout(() => done(false), 12_000)
        }),
      ]))
    clearTimeout(timeout)
    if (delivered) {
      checks.push('hosted WebSocket message delivery')
      console.log('PASS: hosted WebSocket message delivery')
    } else
      warnings.push(
        `Realtime subscription/delivery not confirmed (${realtimeStatuses.join(',') || 'no status'}; ${systemStatuses.join(',') || 'no system status'}); check publication, project settings and network WebSocket access.`,
      )
  } finally {
    await vendor.client.removeChannel(channel)
  }
  await check(
    'order and payment notifications belong to the correct participants',
    async () => {
      const own = unwrap(
        await buyer.client
          .from('notifications')
          .select('type,entity_id')
          .eq('user_id', buyer.id)
          .eq('entity_id', order.id),
      )
      assert.ok(own.some((row) => row.type === 'order_completed'))
      assert.ok(own.some((row) => row.type === 'payment_confirmed'))
    },
  )
  await check(
    'offline vendor is hidden and coordinates are cleared',
    async () => {
      unwrap(
        await vendor.client
          .from('vendors')
          .update({ online: false })
          .eq('id', vendor.id),
      )
      const own = unwrap(
        await vendor.client
          .from('vendors')
          .select('*')
          .eq('id', vendor.id)
          .single(),
      )
      assert.equal(own.location, null)
      assert.equal(own.last_seen_at, null)
      assert.equal(
        unwrap(
          await buyer.client.from('vendors').select('id').eq('id', vendor.id),
        ).length,
        0,
      )
    },
  )
  if (process.argv.includes('--browser-ui')) {
    const freshBuyer = await createActor('customer', 'browser-buyer', false)
    unwrap(
      await vendor.client
        .from('vendors')
        .update({
          online: true,
          location: { lat: 1.475, lng: 124.849 },
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', vendor.id),
    )
    await runHostedBrowserQA({
      appOrigin,
      apiOrigin,
      inspectQueryCache: !deployedMode,
      supabaseOrigin: new URL(url).origin,
      buyer: freshBuyer,
      vendor,
      product,
      check,
      registerUpload(owner) {
        state.uploadOwners = [
          ...new Set([...(state.uploadOwners || []), owner]),
        ]
        save()
      },
      runId: state.runId,
      redact,
    })
  }
}

let failure
try {
  if (!process.argv.includes('--cleanup-only')) await run()
} catch (error) {
  failure = redact(
    error instanceof Error ? error.message : 'Unknown QA failure',
  )
  console.error(`FAIL: ${failure}`)
} finally {
  await Promise.all(clients.map((client) => client.removeAllChannels()))
  try {
    await cleanup()
  } catch (error) {
    failure = redact(
      `${failure || ''} Cleanup failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
    console.error(
      'Cleanup incomplete. Retain the journal and run --cleanup-only after resolving access.',
    )
  }
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        runId: state.runId,
        target: { mode: deployedMode ? 'deployed' : 'local', frontend: appOrigin || null, backend: apiOrigin || null },
        at: new Date().toISOString(),
        checks,
        warnings,
        failure: failure || null,
        cleaned: state.cleaned,
      },
      null,
      2,
    ),
  )
  apiProcess?.kill()
  await frontend?.close()
}
if (failure) process.exitCode = 1
