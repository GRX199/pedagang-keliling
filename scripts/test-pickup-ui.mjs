// PLAYWRIGHT_MODULE_PATH can point to an already installed Playwright package.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const server = await createServer({
  server: { host: '127.0.0.1', port: 5197, strictPort: true },
  plugins: [{
    name: 'pickup-test-only-services', enforce: 'pre',
    load(id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/lib/supabase.js')) return "export { supabase } from '/tests/ui/pickup-mock.js'"
      if (path.endsWith('/src/lib/auth.jsx')) return "import { user } from '/tests/ui/pickup-mock.js'; export const useAuth = () => ({user});"
      if (path.endsWith('/src/lib/conversations.js')) return "export const findOrCreateDirectChat = async () => ({id:'chat'}); export const sendChatMessage = async () => ({id:'message'});"
    },
  }],
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.gpsCalls = 0
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition(success, failure) {
        window.gpsCalls++
        if (new URLSearchParams(location.search).get('gps') === 'denied') failure({ code: 1 })
        else success({ coords: { latitude: 1.474, longitude: 124.846, accuracy: 10 } })
      },
    } })
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // No production APIs, accounts, tiles, or third-party data are contacted by this test.
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:5197/') ? route.continue() : route.abort())
  await mkdir('test-results/pickup', { recursive: true })
  for (const width of [320, 375, 768, 1366]) {
    await page.setViewportSize({ width, height: 850 })
    for (const role of ['buyer', 'vendor']) {
      for (const status of ['pending', 'accepted', 'ready', 'completed', 'rejected', 'cancelled']) {
        await page.goto(`http://127.0.0.1:5197/tests/ui/pickup.html?role=${role}&status=${status}`)
        await page.getByRole('heading', { level: 1 }).waitFor()
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `horizontal overflow ${width}/${role}/${status}`)
        if (status === 'ready') {
          assert(await page.getByRole('heading', { name: 'Serah terima barang' }).isVisible())
          assert.equal(await page.getByText('Lihat kode pengambilan').count(), 0)
          assert.equal(await page.getByLabel('Kode dari pengambil').count(), 0)
          if (role === 'vendor') assert(await page.getByRole('button', { name: 'Selesaikan pesanan', exact: true }).isDisabled())
        }
        if (width === 375 && status === 'ready') await page.screenshot({ path: `test-results/pickup/${role}-375.png`, fullPage: true })
      }
    }
  }
  await page.setViewportSize({ width: 375, height: 850 })
  await page.goto('http://127.0.0.1:5197/tests/ui/pickup.html?role=buyer&status=pending&method=self_pickup')
  await page.getByText('Ubah usulan titik', { exact: true }).click()
  await page.getByLabel('Patokan titik').fill('Titik baru dekat pasar')
  await page.evaluate(() => window.pickupFixture.refresh())
  assert.equal(await page.getByLabel('Patokan titik').inputValue(), 'Titik baru dekat pasar', 'background refresh preserves draft')
  const mapElement = await page.locator('.leaflet-container').elementHandle()
  const mapId = await mapElement.evaluate(element => element._leaflet_id)
  await page.evaluate(() => window.pickupFixture.refresh())
  assert.equal(await page.locator('.leaflet-container').evaluate(element => element._leaflet_id), mapId, 'background refresh preserves map instance')
  await page.getByRole('button', { name: 'Simpan usulan' }).click()
  await page.getByText('Titik pengambilan berupa patokan tertulis, belum ditandai pada peta.').waitFor()
  await page.evaluate(() => window.pickupFixture.offline())
  await page.getByText('Lokasi pedagang tidak aktif. Koordinasikan titik melalui chat.').waitFor()
  assert.equal(await page.locator('path.leaflet-interactive').count(), 0, 'offline marker removed, manual point has no pin')
  await page.goto('http://127.0.0.1:5197/tests/ui/pickup.html?role=vendor&status=pending')
  await page.getByRole('button', { name: 'Setujui titik' }).click()
  await page.getByRole('button', { name: 'Barang siap diambil' }).click()
  await page.getByRole('heading', { name: 'Serah terima barang' }).waitFor()
  assert.equal(await page.evaluate(() => window.pickupFixture.updates), 2, 'one mutation per action')
  await page.goto('http://127.0.0.1:5197/tests/ui/pickup.html?role=vendor&status=ready&payment=paid')
  await page.getByRole('button', { name: 'Selesaikan pesanan', exact: true }).click()
  await page.getByRole('button', { name: 'Belum', exact: true }).click()
  assert.equal(await page.evaluate(() => window.pickupFixture.updates), 0, 'cancel confirmation does not complete')
  await page.getByRole('button', { name: 'Selesaikan pesanan', exact: true }).click()
  await page.getByRole('button', { name: 'Ya, sudah diserahkan', exact: true }).click()
  await page.getByRole('heading', { name: 'Selesai', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.pickupFixture.updates), 1, 'handover without code or collector form')
  for (const width of [375, 1366]) {
    await page.setViewportSize({ width, height: 850 })
    await page.goto('http://127.0.0.1:5197/tests/ui/pickup.html?view=store&role=buyer')
    await page.getByRole('button', { name: 'Tambah', exact: true }).click()
    await page.getByRole('button', { name: 'Kurir pelanggan', exact: true }).click()
    await page.getByLabel('Nama pelanggan yang mengatur pengambilan').fill('Ani')
    assert.equal(await page.getByLabel('Usulan titik pengambilan').count(), 0)
    assert.equal(await page.locator('input[type="datetime-local"]').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Nanti', exact: true }).count(), 0)
    await page.evaluate(() => window.pickupFixture.refresh())
    assert.equal(await page.getByLabel('Nama pelanggan yang mengatur pengambilan').inputValue(), 'Ani')
    assert(await page.getByLabel('Nama pelanggan yang mengatur pengambilan').evaluate(element => element === document.activeElement), 'vendor GPS refresh preserves checkout focus')
    await page.getByRole('button', { name: 'Kirim permintaan', exact: true }).click()
    assert.equal(await page.evaluate(() => window.pickupFixture.updates), 0, 'courier without consent is not submitted')
    await page.getByRole('checkbox').check()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'checkout fits viewport')
    await page.screenshot({ path: `test-results/pickup/checkout-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Kirim permintaan', exact: true }).click()
    await page.getByRole('heading', { name: 'Permintaan tersimpan' }).waitFor()
    const checkout = await page.evaluate(() => window.pickupFixture.checkout)
    assert.equal(checkout.target_fulfillment_type, 'customer_courier')
    assert.equal(checkout.target_meeting_point_location, null, 'courier has no location')
    assert.equal(await page.evaluate(() => window.gpsCalls), 0, 'courier never requests GPS')
    assert.equal(checkout.target_order_timing, 'asap')
    assert.equal(checkout.target_requested_fulfillment_at, null)
    assert.equal(checkout.target_customer_location, null, 'no implicit customer location storage')
    assert.equal(checkout.target_items[0].quantity, 1)
    assert.equal(await page.evaluate(() => window.pickupFixture.updates), 1, 'single atomic checkout call')
  }
  for (const gps of ['allowed', 'denied']) {
    await page.goto(`http://127.0.0.1:5197/tests/ui/pickup.html?view=store&role=buyer&gps=${gps}`)
    await page.getByRole('button', { name: 'Tambah', exact: true }).click()
    await page.getByLabel('Nama pelanggan yang mengatur pengambilan').fill('Ani')
    await page.getByRole('button', { name: 'Kirim permintaan', exact: true }).click()
    await page.getByRole('heading', { name: 'Permintaan tersimpan' }).waitFor()
    const checkout = await page.evaluate(() => window.pickupFixture.checkout)
    assert.equal(await page.evaluate(() => window.gpsCalls), 1)
    assert.equal(checkout.target_fulfillment_type, 'self_pickup')
    if (gps === 'allowed') assert.equal(checkout.target_meeting_point_location.lat, 1.474)
    else assert.equal(checkout.target_meeting_point_location, null, 'denied GPS never creates fake coordinates')
  }
  assert.deepEqual(errors, [], 'no page runtime errors')
  console.log('PASS: 48 viewport/role/status layouts, 2 checkout layouts, draft/focus/map persistence, offline privacy, vendor actions and atomic checkout UI. Mock services, not hosted UAT.')
} finally {
  await browser?.close()
  await server.close()
}
