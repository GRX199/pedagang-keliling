import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
const require = createRequire(import.meta.url)

const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}
async function until(predicate, message) {
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(message)
}

// No auth/data mocks: only third-party map tiles/fonts are blocked, and GPS is simulated.
export async function runHostedBrowserQA({
  appOrigin,
  apiOrigin,
  supabaseOrigin,
  buyer,
  vendor,
  product,
  check,
  registerUpload,
  runId,
  redact,
  inspectQueryCache = true,
}) {
  const { chromium } = require(
    process.env.PLAYWRIGHT_MODULE_PATH || 'playwright',
  )
  const browser = await chromium.launch({ headless: true })
  const runtimeErrors = []
  let buyerPage
  let vendorPage
  const folder = `test-results/hosted-browser/${runId}`
  await mkdir(folder, { recursive: true })
  try {
    const pages = []
    for (const viewport of [
      { width: 375, height: 850 },
      { width: 1366, height: 900 },
    ]) {
      const context = await browser.newContext({
        viewport,
        geolocation: { latitude: 1.475, longitude: 124.849, accuracy: 10 },
        permissions: ['geolocation'],
      })
      await context.route('**/*', (route) => {
        const origin = new URL(route.request().url()).origin
        return [appOrigin, apiOrigin, supabaseOrigin].includes(origin)
          ? route.continue()
          : route.abort()
      })
      const page = await context.newPage()
      page.setDefaultTimeout(45_000)
      page.setDefaultNavigationTimeout(45_000)
      page.on('pageerror', (error) => runtimeErrors.push(redact(error.message)))
      pages.push(page)
    }
    ;[buyerPage, vendorPage] = pages
    async function login(page, actor) {
      await page.goto(`${appOrigin}/login`)
      await page.getByLabel('Email', { exact: true }).fill(actor.email)
      await page.getByLabel('Password', { exact: true }).fill(actor.password)
      await page
        .getByRole('button', { name: 'Masuk Sekarang', exact: true })
        .click()
      await page.waitForURL(`${appOrigin}/map`)
      await page.locator('.leaflet-container').waitFor()
    }
    async function logout(page) {
      await page.locator('button[aria-haspopup="menu"]').click()
      await page.getByRole('menuitem', { name: 'Keluar', exact: true }).click()
      await page.waitForURL(`${appOrigin}/login`)
    }
    const currentStock = async () =>
      unwrap(
        await vendor.client
          .from('products')
          .select('stock,reserved_stock')
          .eq('id', product.id)
          .single(),
      )
    const vendorRow = async () =>
      unwrap(
        await vendor.client
          .from('vendors')
          .select('*')
          .eq('id', vendor.id)
          .single(),
      )
    await check(
      'browser: real login bootstraps a new customer profile before private access',
      async () => {
        assert.equal(
          unwrap(
            await buyer.client
              .from('profiles')
              .select('id')
              .eq('id', buyer.id)
              .maybeSingle(),
          ),
          null,
        )
        await login(buyerPage, buyer)
        const profile = unwrap(
          await buyer.client
            .from('profiles')
            .select('id,role,display_name')
            .eq('id', buyer.id)
            .single(),
        )
        assert.equal(profile.role, 'customer')
        assert.match(profile.display_name, /QA TEST browser-buyer/)
        assert.equal(
          await buyerPage
            .getByRole('link', { name: 'Produk', exact: true })
            .count(),
          0,
        )
        await login(vendorPage, vendor)
        await vendorPage
          .getByRole('link', { name: 'Produk', exact: true })
          .first()
          .waitFor()
      },
    )
    const baseline = await currentStock()
    let orderId
    let completionCalls = 0
    vendorPage.on('request', (request) => {
      if (
        new URL(request.url()).pathname.endsWith('/rpc/complete_pickup_order')
      )
        completionCalls++
    })
    await check(
      'browser: mobile checkout, merchant progress, live buyer status and atomic COD stock',
      async () => {
        const ownVendor = await vendorRow()
        await buyerPage
          .getByText(ownVendor.name, { exact: true })
          .first()
          .waitFor()
        await buyerPage.goto(`${appOrigin}/vendor/${vendor.id}`)
        const title = buyerPage.getByText(product.name, { exact: true })
        await title.waitFor()
        const card = buyerPage
          .locator('div')
          .filter({ has: title })
          .filter({
            has: buyerPage.getByRole('button', { name: 'Tambah', exact: true }),
          })
          .last()
        await card.getByRole('button', { name: 'Tambah', exact: true }).click()
        await buyerPage
          .getByRole('button', { name: 'COD', exact: true })
          .click()
        await buyerPage
          .getByLabel('Nama pelanggan yang mengatur pengambilan')
          .fill('QA TEST browser-buyer')
        await buyerPage
          .getByRole('button', { name: 'Kirim permintaan', exact: true })
          .click()
        await buyerPage.waitForURL(/\/orders\/[0-9a-f-]+$/)
        orderId = new URL(buyerPage.url()).pathname.split('/').at(-1)
        const order = unwrap(
          await buyer.client
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single(),
        )
        assert.equal(order.service_flow, 'pickup_v1')
        assert.equal(order.status, 'pending')
        assert.equal(order.total_amount, product.price)
        assert.equal((await currentStock()).reserved_stock, 1)
        assert(
          await buyerPage.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          'mobile checkout/tracking fits viewport',
        )
        await buyerPage.screenshot({
          path: `${folder}/buyer-pending-375.png`,
          fullPage: true,
        })
        await vendorPage.goto(`${appOrigin}/orders/${orderId}`)
        await vendorPage
          .getByRole('button', { name: 'Terima pesanan', exact: true })
          .click()
        await buyerPage
          .getByRole('heading', { level: 1, name: 'Disetujui', exact: true })
          .waitFor()
        await vendorPage
          .getByRole('button', { name: 'Barang siap diambil', exact: true })
          .click()
        await buyerPage
          .getByRole('heading', { level: 1, name: 'Siap diambil', exact: true })
          .waitFor()
        await vendorPage
          .getByRole('button', { name: 'Selesaikan pesanan', exact: true })
          .click()
        await vendorPage
          .getByRole('button', { name: 'Ya, selesaikan pesanan', exact: true })
          .evaluate((button) => {
            button.click()
            button.click()
          })
        await buyerPage
          .getByRole('heading', { level: 1, name: 'Selesai', exact: true })
          .waitFor()
        const completed = unwrap(
          await buyer.client
            .from('orders')
            .select('status,payment_status')
            .eq('id', orderId)
            .single(),
        )
        assert.deepEqual(completed, {
          status: 'completed',
          payment_status: 'paid',
        })
        assert.equal(
          completionCalls,
          1,
          'rapid confirmation submits only one completion RPC',
        )
        const stock = await currentStock()
        assert.equal(stock.stock, baseline.stock - 1)
        assert.equal(stock.reserved_stock, 0)
      },
    )
    const text = `QA UI ping ${runId}`
    let chatId
    await check(
      'browser: sent messages appear without reload and notify the other role',
      async () => {
        await buyerPage.goto(`${appOrigin}/chat/${vendor.id}`)
        await buyerPage.getByPlaceholder('Ketik pesan...').fill(text)
        await buyerPage
          .getByRole('button', { name: 'Kirim', exact: true })
          .click()
        await buyerPage.getByText(text, { exact: true }).waitFor()
        await vendorPage
          .getByRole('status')
          .filter({ hasText: text })
          .first()
          .waitFor()
        chatId = unwrap(
          await buyer.client
            .from('chats')
            .select('id')
            .contains('participants', [buyer.id, vendor.id])
            .single(),
        ).id
        await vendorPage.goto(`${appOrigin}/chat/${buyer.id}`)
        await vendorPage.getByText(text, { exact: true }).waitFor()
        assert.equal(
          await vendorPage.getByRole('button', { name: /Lacak/i }).count(),
          0,
          'completed order has no tracking action in chat',
        )
        assert.equal(
          await vendorPage
            .getByText(`Pesanan #${orderId.slice(0, 8)}`, { exact: true })
            .count(),
          0,
          'completed order has no persistent context card',
        )
        await until(async () => {
          const notifications = unwrap(
            await vendor.client
              .from('notifications')
              .select('is_read')
              .eq('entity_id', chatId)
              .eq('type', 'message_received'),
          )
          return (
            notifications.length > 0 &&
            notifications.every((row) => row.is_read)
          )
        }, 'Visible conversation did not mark its notifications read')
      },
    )
    await check(
      'browser: image preview and caption are reviewed before real authenticated upload',
      async () => {
        registerUpload(buyer.id)
        const before = unwrap(
          await buyer.client
            .from('messages')
            .select('id')
            .eq('chat_id', chatId),
        ).length
        const png = await buyerPage.evaluate(() => {
          const canvas = document.createElement('canvas')
          canvas.width = 96
          canvas.height = 64
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#0f766e'
          ctx.fillRect(0, 0, 96, 64)
          ctx.fillStyle = 'white'
          ctx.fillText('QA TEST', 10, 32)
          return canvas.toDataURL('image/png').split(',')[1]
        })
        await buyerPage
          .locator('input[type="file"]')
          .setInputFiles({
            name: 'qa-browser.png',
            mimeType: 'image/png',
            buffer: Buffer.from(png, 'base64'),
          })
        await buyerPage.locator('img[alt="qa-browser.png"]').waitFor()
        const caption = `QA UI foto ${runId}`
        await buyerPage.getByPlaceholder('Caption opsional...').fill(caption)
        assert.equal(
          unwrap(
            await buyer.client
              .from('messages')
              .select('id')
              .eq('chat_id', chatId),
          ).length,
          before,
          'choosing an image must not send automatically',
        )
        await buyerPage
          .getByRole('button', { name: 'Kirim', exact: true })
          .click()
        await buyerPage.getByPlaceholder('Ketik pesan...').waitFor()
        assert.equal(
          await buyerPage.locator('img[alt="qa-browser.png"]').count(),
          0,
          'sent image preview is cleared',
        )
        await vendorPage.getByText(caption, { exact: true }).waitFor()
        const photo = vendorPage.getByRole('img', {
          name: caption,
          exact: true,
        })
        await until(
          () =>
            photo.evaluate(
              (image) => image.complete && image.naturalWidth === 96,
            ),
          'Uploaded chat image did not decode',
        )
        for (const page of [buyerPage, vendorPage])
          await until(
            () =>
              page.getByText(caption, { exact: true }).evaluate((element) => {
                const pane = element.closest('.overflow-auto')
                const item = element.getBoundingClientRect()
                const area = pane.getBoundingClientRect()
                return (
                  item.bottom <= area.bottom + 1 && item.top >= area.top - 1
                )
              }),
            'Photo caption is clipped after the image loads',
          )
        await buyerPage.screenshot({
          path: `${folder}/buyer-chat-photo-375.png`,
          fullPage: true,
        })
      },
    )
    await check(
      inspectQueryCache
        ? 'browser: mobile logout hides vendor and account switching clears private cache'
        : 'browser: mobile logout hides vendor and account switching restores the correct role',
      async () => {
        await vendorPage.setViewportSize({ width: 375, height: 850 })
        await logout(vendorPage)
        await until(async () => {
          const row = await vendorRow()
          return (
            !row.online && row.location === null && row.last_seen_at === null
          )
        }, 'Merchant remained online after logout')
        await buyerPage.goto(`${appOrigin}/map`)
        const name = (await vendorRow()).name
        await until(
          async () =>
            (await buyerPage.getByText(name, { exact: true }).count()) === 0,
          'Offline merchant remains in customer map list',
        )
        await logout(buyerPage)
        await login(buyerPage, vendor)
        // Source-module introspection is only available on the local Vite test server.
        if (inspectQueryCache) {
          const leaked = await buyerPage.evaluate(async (oldViewer) => {
            const { queryClient } = await import('/src/shared/lib/queryClient.ts')
            return queryClient
              .getQueryCache()
              .getAll()
              .some(
                (query) =>
                  query.queryKey[1] === oldViewer &&
                  query.queryKey[0] !== 'visible-chat',
              )
          }, buyer.id)
          assert.equal(leaked, false, 'previous customer query cache survives account switch')
        }
        await buyerPage
          .getByRole('link', { name: 'Produk', exact: true })
          .first()
          .waitFor()
        await logout(buyerPage)
      },
    )
    assert.deepEqual(runtimeErrors, [], 'browser runtime errors')
  } catch (error) {
    await buyerPage
      ?.screenshot({ path: `${folder}/failure-buyer.png`, fullPage: true })
      .catch(() => {})
    await vendorPage
      ?.screenshot({ path: `${folder}/failure-vendor.png`, fullPage: true })
      .catch(() => {})
    throw error
  } finally {
    await browser.close()
  }
}
