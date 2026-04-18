# Vendor Promotions Setup

Fitur promo ringan membantu pedagang menampilkan penawaran singkat langsung dari profil toko dan peta.

## Langkah Aktivasi

1. Buka Supabase `SQL Editor`.
2. Jalankan isi file [vendor-promotions.sql](/C:/xampp/htdocs/pedagang-keliling-react/supabase/vendor-promotions.sql).
3. Redeploy frontend.

## Setelah Aktif

- Pedagang bisa mengisi teks promo dan tanggal berakhir promo dari halaman profil.
- Pelanggan bisa melihat badge promo di peta dan profil toko.
- Peta mendukung filter `Promo Aktif`.

## Catatan

- Jika tanggal promo tidak diisi, promo tetap aktif sampai pedagang menghapus teks promosinya.
- Promo ringan sengaja dibuat sederhana agar tidak membebani alur map-first utama.
