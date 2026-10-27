import assert from 'node:assert/strict'

export async function checkMobileDesign(page, origin) {
  const folder = 'test-results/pickup'
  await page.addInitScript(() => localStorage.removeItem('kelilingku:pwa-install-dismissed'))
  let layouts = 0
  for (const width of [320, 375, 430, 768, 1366]) {
    const height = width === 320 ? 640 : 850
    await page.setViewportSize({ width, height })
    for (const role of ['buyer', 'vendor']) {
      for (const surface of ['map', 'orders', 'profile', ...(role === 'vendor' ? ['products'] : []), 'chat']) {
        console.log(`Mobile design: ${width}/${role}/${surface}`)
        await page.goto(`${origin}/tests/ui/pickup.html?view=mobile-design&surface=${surface}&role=${role}`)
        await page.getByRole('button', { name: 'Menu akun', exact: true }).waitFor()
        const nav = page.getByRole('navigation', { name: 'Navigasi utama mobile', exact: true })
        const mobile = width < 1024
        assert.equal(await nav.isVisible(), mobile, 'bottom navigation follows viewport width')
        if (mobile) {
          const bounds = await nav.boundingBox()
          assert(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height + 1, 'navigation fits viewport')
          assert.equal(await nav.getByRole('link').count(), 4, 'each role has four core mobile destinations')
          assert.equal(await nav.locator('[aria-current="page"]').count(), role === 'vendor' && surface === 'profile' ? 0 : 1, 'active destination reflects the actual route')
          for (const link of await nav.getByRole('link').all()) {
            const box = await link.boundingBox()
            assert(box.height >= 44 && box.width >= 44, 'navigation has comfortable touch targets')
          }
        }

        if (surface === 'map') {
          const map = page.locator('.leaflet-container')
          await map.waitFor()
          await page.getByRole('button', { name: 'Lihat toko Pak Sayur', exact: true }).waitFor()
          const mapId = await map.evaluate(element => element._leaflet_id)
          const mapBox = await map.boundingBox()
          if (mobile) {
            const filters = await page.getByRole('region', { name: 'Pencarian pedagang', exact: true }).boundingBox()
            assert(mapBox.y < filters.y, 'map precedes discovery controls on mobile')
            if (role === 'vendor') {
              const controls = await page.getByRole('region', { name: 'Kontrol pedagang', exact: true }).boundingBox()
              assert(controls.y < mapBox.y, 'merchant operations remain above the map')
            }
          }
          await page.getByRole('button', { name: 'Lokasi Saya', exact: true }).click()
          await page.waitForFunction(() => window.gpsCalls > 0)
          await page.getByRole('button', { name: /^Filter/ }).click()
          const filterDialog = page.getByRole('dialog', { name: 'Filter pedagang', exact: true })
          await filterDialog.waitFor()
          const bounds = await filterDialog.boundingBox()
          assert(bounds.x >= 0 && bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, 'filter dialog fits viewport')
          if (width === 375) await page.screenshot({ path: `${folder}/mobile-${role}-filters.png`, fullPage: true })
          await filterDialog.getByRole('button', { name: 'Dalam radius', exact: true }).click()
          assert.equal(await filterDialog.getByRole('button', { name: 'Dalam radius', exact: true }).getAttribute('aria-pressed'), 'true')
          await page.keyboard.press('Escape')
          await filterDialog.waitFor({ state: 'hidden' })
          assert(await page.getByRole('button', { name: /^Filter/ }).evaluate(element => element === document.activeElement), 'filter close restores trigger focus')
          assert.equal(await map.evaluate(element => element._leaflet_id), mapId, 'filter does not recreate map')
          await page.getByRole('button', { name: 'Lihat toko Pak Sayur', exact: true }).click()
          if (mobile) {
            const sheet = page.getByRole('dialog', { name: 'Detail toko', exact: true })
            await sheet.waitFor()
            const sheetBox = await sheet.boundingBox()
            assert(sheetBox.width <= width && sheetBox.y + sheetBox.height <= height + 1, 'vendor sheet fits mobile')
            if (role === 'buyer') {
              await sheet.getByRole('button', { name: 'Simpan Favorit', exact: true }).click()
              await sheet.getByRole('button', { name: 'Hapus favorit', exact: true }).waitFor()
              const toast = sheet.getByText('Pedagang disimpan ke favorit', { exact: true })
              assert(await toast.isVisible(), 'feedback is displayed inside the active modal layer')
            }
            if (width === 375) await page.screenshot({ path: `${folder}/mobile-${role}-vendor-sheet.png`, fullPage: true })
            await page.keyboard.press('Escape')
            await sheet.waitFor({ state: 'hidden' })
          } else await page.getByRole('complementary', { name: 'Detail toko pilihan', exact: true }).waitFor()
          await page.evaluate(() => window.pickupFixture.moveVendor())
          assert.equal(await map.evaluate(element => element._leaflet_id), mapId, 'selection and realtime refresh preserve map identity')
        } else if (surface === 'orders') {
          await page.locator('[data-order-id]').first().waitFor()
          await page.getByRole('button', { name: 'Buka', exact: true }).click()
          await page.getByLabel('Cari riwayat', { exact: true }).waitFor()
          await page.getByLabel('Status riwayat', { exact: true }).selectOption('completed')
          assert.equal(await page.getByLabel('Status riwayat').inputValue(), 'completed')
          await page.getByRole('button', { name: 'Sembunyikan', exact: true }).click()
        } else if (surface === 'profile') {
          await page.getByRole('button', { name: 'Edit', exact: true }).click()
          await page.getByLabel('Nama profil', { exact: true }).fill('Nama uji mobile')
          if (role === 'vendor') {
            const description = page.getByLabel('Deskripsi toko', { exact: true })
            await description.fill('Draft toko')
            await description.press('End')
            await description.pressSequentially(' tetap utuh')
            assert.equal(await description.inputValue(), 'Draft toko tetap utuh')
            const payment = page.locator('summary').filter({ hasText: /^Pembayaran/ })
            await payment.click()
            await page.getByLabel('Nama bank', { exact: true }).fill('Bank Contoh')
            await payment.click()
            await payment.click()
            assert.equal(await page.getByLabel('Nama bank').inputValue(), 'Bank Contoh', 'collapsing a section preserves its draft')
          }
          await page.getByRole('button', { name: 'Simpan', exact: true }).scrollIntoViewIfNeeded()
          if (mobile) {
            const save = await page.getByRole('button', { name: 'Simpan', exact: true }).boundingBox()
            assert(save.y >= 0 && save.y + save.height <= (await nav.boundingBox()).y + 1, 'save button remains above navigation')
          }
          await page.getByRole('button', { name: 'Batal', exact: true }).click()
          await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        } else if (surface === 'products') {
          await page.getByText('Tomat segar', { exact: true }).waitFor()
          await page.getByRole('button', { name: 'Edit', exact: true }).click()
          const editor = page.getByRole('dialog', { name: 'Edit Produk', exact: true })
          await editor.waitFor()
          const box = await editor.boundingBox()
          assert(box.width <= width && box.y >= 0 && box.y + box.height <= height + 1, 'product editor fits viewport')
          await page.keyboard.press('Escape')
          await editor.waitFor({ state: 'hidden' })
          assert(await page.getByRole('button', { name: 'Edit', exact: true }).evaluate(element => element === document.activeElement), 'product editor restores focus')
        } else if (surface === 'chat') {
          await page.getByRole('button', { name: role === 'buyer' ? /Pak Sayur/ : /Ani/ }).first().click()
          const composer = page.getByPlaceholder('Ketik pesan...')
          await composer.waitFor()
          const box = await composer.boundingBox()
          assert(box.width >= 100 && box.height >= 44, 'composer remains usable on small screens')
          if (mobile) assert(box.y + box.height <= (await nav.boundingBox()).y, 'chat composer stays above bottom navigation')
          await composer.fill('Pesan dari tampilan baru')
          await page.getByRole('button', { name: 'Kirim', exact: true }).click()
          await page.getByText('Pesan dari tampilan baru', { exact: true }).waitFor()
        }
        const accountButton = page.getByRole('button', { name: 'Menu akun', exact: true })
        await accountButton.click()
        const profileLink = page.getByRole('link', { name: 'Profil & pengaturan', exact: true })
        await profileLink.waitFor()
        await page.keyboard.press('Escape')
        await profileLink.waitFor({ state: 'hidden' })
        assert(await accountButton.evaluate(element => element === document.activeElement), 'account menu restores keyboard focus')
        if (surface === 'map' && role === 'vendor') {
          await page.evaluate(() => {
            const event = new Event('beforeinstallprompt', { cancelable: true })
            event.prompt = async () => {}
            event.userChoice = Promise.resolve({ outcome: 'dismissed' })
            window.dispatchEvent(event)
          })
          const prompt = page.getByText('Install Kelilingku', { exact: true })
          await prompt.waitFor()
          const promptBox = await prompt.locator('../..').boundingBox()
          assert(promptBox.x >= 0 && promptBox.x + promptBox.width <= width, 'install prompt fits viewport')
          if (mobile) assert(promptBox.y + promptBox.height <= (await nav.boundingBox()).y, 'install prompt stays above bottom navigation, including tablet')
          await page.getByRole('button', { name: 'Tutup prompt install', exact: true }).click()
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `mobile design overflow ${width}/${role}/${surface}`)
        while (await page.getByRole('button', { name: 'Tutup notifikasi', exact: true }).count()) await page.getByRole('button', { name: 'Tutup notifikasi', exact: true }).first().click()
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
        if (width === 375 || width === 1366) await page.screenshot({ path: `${folder}/${width === 1366 ? 'desktop' : 'mobile'}-${role}-${surface}.png`, fullPage: true })
        layouts++
      }
    }
  }
  console.log(`PASS: ${layouts} mobile-first shell layouts, role navigation, modal focus/layers, map identity, profile drafts and chat composer.`)
}
