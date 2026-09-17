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
          if (role === 'vendor') assert(await page.getByRole('button', { name: 'Konfirmasi serah terima' }).isDisabled())
        }
        if (width === 375 && status === 'ready') await page.screenshot({ path: `test-results/pickup/${role}-375.png`, fullPage: true })
      }
    }
  }
  await page.setViewportSize({ width: 375, height: 850 })
  await page.goto('http://127.0.0.1:5197/tests/ui/pickup.html?role=buyer&status=pending')
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
  for (const width of [375, 1366]) {
    await page.setViewportSize({ width, height: 850 })
    await page.goto('http://127.0.0.1:5197/tests/ui/pickup.html?view=store&role=buyer')
    await page.getByRole('button', { name: 'Tambah', exact: true }).click()
    await page.getByRole('button', { name: 'Kurir pelanggan', exact: true }).click()
    await page.getByLabel('Nama pelanggan yang mengatur pengambilan').fill('Ani')
    await page.getByLabel('Usulan titik pengambilan').fill('Gerbang pasar')
    await page.evaluate(() => window.pickupFixture.refresh())
    assert.equal(await page.getByLabel('Usulan titik pengambilan').inputValue(), 'Gerbang pasar')
    assert(await page.getByLabel('Usulan titik pengambilan').evaluate(element => element === document.activeElement), 'vendor GPS refresh preserves checkout focus')
    await page.getByRole('button', { name: 'Kirim permintaan', exact: true }).click()
    assert.equal(await page.evaluate(() => window.pickupFixture.updates), 0, 'courier without consent is not submitted')
    await page.getByRole('checkbox').check()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'checkout fits viewport')
    await page.screenshot({ path: `test-results/pickup/checkout-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Kirim permintaan', exact: true }).click()
    await page.getByRole('heading', { name: 'Permintaan tersimpan' }).waitFor()
    const checkout = await page.evaluate(() => window.pickupFixture.checkout)
    assert.equal(checkout.target_fulfillment_type, 'customer_courier')
    assert.equal(checkout.target_customer_location, null, 'no implicit customer location storage')
    assert.equal(checkout.target_items[0].quantity, 1)
    assert.equal(await page.evaluate(() => window.pickupFixture.updates), 1, 'single atomic checkout call')
  }
  assert.deepEqual(errors, [], 'no page runtime errors')
  console.log('PASS: 48 viewport/role/status layouts, 2 checkout layouts, draft/focus/map persistence, offline privacy, vendor actions and atomic checkout UI. Mock services, not hosted UAT.')
} finally {
  await browser?.close()
  await server.close()
}
