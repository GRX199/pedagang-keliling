# Kelilingku

Kelilingku adalah platform map-first commerce untuk pedagang keliling seperti sayur, bakso, kopi, roti, gas, dan jajanan. Fokus utamanya adalah mempertemukan pelanggan dengan pedagang yang sedang aktif di sekitar mereka, lalu mengubah interaksi itu menjadi transaksi yang lebih rapi melalui chat, order, dan tracking realtime.

## Dokumentasi Utama

- [Alur Pengambilan dan Aktivasi Migrasi](./docs/pengambilan-dan-migrasi.md) - implementasi aplikasi utama, urutan deployment, serta pengujian dua perangkat.
- [Product Blueprint](./docs/product-blueprint.md)
- [Implementation Roadmap](./docs/implementation-roadmap.md)
- [Supabase Data Model](./docs/supabase-data-model.md)
- [Supabase Setup](./docs/supabase-setup.md)
- [Phase 1 Upgrade Guide](./docs/phase1-upgrade.md)
- [Production Hardening](./docs/production-hardening.md)
- [Pembaruan Stabilitas dan Langkah Penerapan](./docs/stability-update.md)
- [Deploy Staging](./docs/deploy-staging.md)
- [Phase 1 Foundation SQL](./supabase/phase1-foundation.sql)

## Stack Saat Ini

- Frontend: React + Vite
- Backend ringan: Node.js untuk upload dan endpoint operasional
- Database/Auth/Realtime/Storage: Supabase

## Perintah Dasar

Frontend dev:

```powershell
npm run dev
```

Frontend build:

```powershell
npm run build
```

Backend dev:

```powershell
cd server
npm run dev
```

## Arah Produk

Produk ini dibangun sebagai `map-first commerce`, bukan marketplace katalog biasa.

Prioritas pengembangan yang penting sekarang:

1. stabilkan flow inti `peta -> toko -> permintaan -> persetujuan -> siap diambil -> serah terima`
2. rapikan UX mobile dan bedakan pengalaman pelanggan vs pedagang
3. hardening keamanan, realtime, dan kesiapan production
4. pertahankan hanya fitur pembeda yang benar-benar membantu transaksi

## Catatan

Untuk database baru, jalankan SQL secara berurutan: `schema.sql`, `phase1-foundation.sql`, `admin-foundation.sql`, `production-hardening.sql`, `order-payment-guard.sql`, lalu `pickup-flow.sql`. Periksa hasil dengan `pickup-verification.sql`.

Untuk database yang sudah berjalan, ikuti [panduan aktivasi](./docs/pengambilan-dan-migrasi.md), bukan mengulang seluruh SQL lama. Terapkan migrasi pengambilan sebelum mengaktifkan frontend baru. Pesanan lama tetap menggunakan alur legacy; pesanan baru memakai ambil sendiri atau kurir yang diatur pelanggan.
