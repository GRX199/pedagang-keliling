import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { preview } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const server = await preview({ preview: { host: '127.0.0.1', port: 5198, strictPort: true } })
const origin = 'http://127.0.0.1:5198'
let browser
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 375, height: 850 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)))
  await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort())
  // A cold install on login must work offline without previously visiting the home page.
  await page.goto(`${origin}/login`)
  await page.getByLabel('Password', { exact: true }).waitFor()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 15_000 })
  const manifest = await (await context.request.get(`${origin}/manifest.webmanifest`)).json()
  assert.equal(manifest.start_url, '/map?source=pwa')
  for (const icon of manifest.icons.filter(icon => icon.type === 'image/png')) {
    const response = await context.request.get(`${origin}${icon.src}`)
    assert(response.ok(), `missing install icon ${icon.src}`)
    assert.equal((await response.body()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  }
  await context.setOffline(true)
  const offlinePage = await context.newPage()
  const offlinePath = '/orders/offline-check?source=pwa'
  const response = await offlinePage.goto(`${origin}${offlinePath}`)
  await offlinePage.getByRole('heading', { name: 'Koneksi terputus', exact: true }).waitFor({ timeout: 10_000 })
  assert.equal(response.status(), 503, 'offline fallback must not claim an online success')
  assert(offlinePage.url().endsWith(offlinePath), 'retry retains the requested route')
  assert.equal(await offlinePage.locator('script').count(), 0, 'offline screen has no missing app bundle dependency')
  for (const width of [320, 375, 1366]) {
    await offlinePage.setViewportSize({ width, height: 850 })
    assert(await offlinePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `offline overflow at ${width}`)
  }
  const entries = await offlinePage.evaluate(async () => {
    const result = []
    for (const name of await caches.keys()) {
      if (!name.startsWith('kelilingku-')) continue
      for (const request of await (await caches.open(name)).keys()) result.push(new URL(request.url).pathname)
    }
    return result
  })
  assert(entries.includes('/offline.html'), 'standalone offline screen is precached')
  assert(!entries.some(path => path === '/' || path === '/login' || path.startsWith('/orders/')), 'private navigation HTML is never cached')
  await mkdir('test-results/pwa', { recursive: true })
  await offlinePage.setViewportSize({ width: 375, height: 850 })
  await offlinePage.screenshot({ path: 'test-results/pwa/offline-375.png' })
  await context.setOffline(false)
  await offlinePage.getByRole('link', { name: 'Coba lagi', exact: true }).click()
  await offlinePage.waitForURL(`${origin}/login`)
  await offlinePage.getByLabel('Password', { exact: true }).waitFor()
  assert.deepEqual(errors, [], 'no runtime errors during offline and recovery')
  console.log('PASS: real service worker cold install, PNG icons, offline deep link at 320/375/1366, private-cache isolation and reconnect. Local preview only.')
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
