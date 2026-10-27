import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { preview } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const targetIndex = process.argv.indexOf('--url')
const target = targetIndex < 0 ? null : new URL(process.argv[targetIndex + 1])
if (target && (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || target.pathname !== '/')) {
  throw new Error('--url must be an HTTPS frontend origin without credentials, path or query.')
}
const server = target ? null : await preview({ preview: { host: '127.0.0.1', port: 5199, strictPort: true } })
const origin = target?.origin || 'http://127.0.0.1:5199'
let browser
try {
  browser = await chromium.launch({ headless: true })
  // Service worker behavior has its own test; this smoke test checks current network HTML.
  const page = await browser.newPage({ serviceWorkers: 'block' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort())
  for (const width of [320, 375, 1366]) {
    await page.setViewportSize({ width, height: 850 })
    for (const path of ['/', '/login', '/map']) {
      await page.goto(`${origin}${path}`)
      // The desktop introduction is intentionally hidden on small login screens.
      await page.locator('h1:visible, h2:visible').first().waitFor()
      if (path === '/') assert.equal(await page.locator('a[href="/wireframe/index.html"]').count(), 0, 'development wireframe is not a production navigation item')
      if (path === '/map') assert(page.url().endsWith('/login'), 'private map redirects without a session')
      if (path !== '/') {
        const password = page.getByLabel('Password', { exact: true })
        await password.waitFor()
        assert.equal(await password.getAttribute('type'), 'password')
        await page.getByRole('button', { name: 'Tampilkan password', exact: true }).click()
        assert.equal(await password.getAttribute('type'), 'text')
        await page.getByRole('button', { name: 'Sembunyikan password', exact: true }).click()
        assert.equal(await password.getAttribute('type'), 'password')
        await page.getByRole('button', { name: 'Daftar', exact: true }).click()
        await page.getByLabel('Konfirmasi password', { exact: true }).waitFor()
        assert.equal(await page.getByLabel('Konfirmasi password', { exact: true }).getAttribute('autocomplete'), 'new-password')
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `register overflow ${width}`)
        await page.getByRole('button', { name: 'Masuk', exact: true }).click()
        await page.getByRole('button', { name: 'Lupa password?', exact: true }).click()
        await page.getByRole('button', { name: 'Kirim Link Reset', exact: true }).waitFor()
        assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0, 'reset request only asks for email')
        await page.getByRole('button', { name: 'Masuk akun', exact: true }).click()
        await page.locator('summary').filter({ hasText: 'Belum menerima verifikasi?' }).click()
        await page.getByRole('button', { name: 'Kirim ulang verifikasi', exact: true }).waitFor()
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width}/${path}`)
    }
  }
  assert.deepEqual(errors, [], 'no production entry/provider/runtime errors')
  console.log(`PASS: production entry/providers, public pages, login/register/reset forms and login redirect at 320/375/1366. Target: ${origin}. Cross-origin traffic blocked; no login/data writes.`)
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.httpServer.close(resolve))
}
