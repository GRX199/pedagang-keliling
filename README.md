# Kelilingku

Kelilingku adalah platform map-first commerce untuk pedagang keliling seperti sayur, bakso, kopi, roti, gas, dan jajanan. Fokus utamanya adalah mempertemukan pelanggan dengan pedagang yang sedang aktif di sekitar mereka, lalu mengubah interaksi itu menjadi transaksi yang lebih rapi melalui chat, order, dan tracking realtime.

## Dokumentasi Utama

- [Product Blueprint](./docs/product-blueprint.md)
- [Implementation Roadmap](./docs/implementation-roadmap.md)
- [Supabase Data Model](./docs/supabase-data-model.md)
- [Supabase Setup](./docs/supabase-setup.md)
- [Phase 1 Upgrade Guide](./docs/phase1-upgrade.md)
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

1. stabilkan flow inti `peta -> toko -> checkout -> chat -> tracking`
2. rapikan UX mobile dan bedakan pengalaman pelanggan vs pedagang
3. hardening keamanan, realtime, dan kesiapan production
4. pertahankan hanya fitur pembeda yang benar-benar membantu transaksi

## Catatan

Schema Supabase saat ini sudah cukup untuk alur dasar, tetapi belum sepenuhnya mencerminkan blueprint produk akhir. Untuk database baru atau upgrade bertahap, gunakan `supabase/schema.sql` lalu lanjutkan dengan `supabase/phase1-foundation.sql`.
