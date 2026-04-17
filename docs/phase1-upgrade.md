# Upgrade Existing Supabase To Phase 1 Foundation

Dokumen ini dipakai jika project Supabase Anda sudah berjalan dan Anda ingin menaikkan fondasi Kelilingku tanpa membuat database baru.

## Jalankan SQL Ini

1. Buka `Supabase Dashboard`.
2. Masuk ke `SQL Editor`.
3. Jalankan file berikut:

- [phase1-foundation.sql](/C:/xampp/htdocs/pedagang-keliling-react/supabase/phase1-foundation.sql)

Jika database Anda sudah pernah menjalankan `phase1-foundation.sql` versi lama dan hanya ingin menambahkan tracking dua titik pelanggan-pedagang, jalankan juga:

- [order-tracking-upgrade.sql](/C:/xampp/htdocs/pedagang-keliling-react/supabase/order-tracking-upgrade.sql)

## Apa Yang Ditambahkan

- role `admin` di `profiles`
- field operasional tambahan di `vendors`
- stok dan availability di `products`
- workflow status order yang lebih lengkap
- field pembayaran dan titik temu di `orders`
- tabel `categories`
- tabel `vendor_categories`
- tabel `order_items`
- tabel `notifications`
- trigger notifikasi otomatis dari pesan dan order

## Setelah SQL Selesai

1. Redeploy frontend.
2. Login ulang akun vendor dan pelanggan.
3. Test flow ini:

- pelanggan pilih produk lalu checkout
- vendor menerima order lalu ubah status bertahap
- pelanggan menerima update status
- kirim pesan dan pastikan notifikasi tetap masuk
- buka halaman tracking order dan pastikan dua titik lokasi serta garis rute tampil

## Catatan Kompatibilitas

Frontend saat ini sudah dibuat kompatibel bertahap:

- jika field atau tabel baru sudah ada, app akan memakainya
- jika migration belum dijalankan penuh, flow lama masih berusaha tetap jalan

Tetap disarankan menjalankan migration ini penuh agar fitur status order, notifikasi, dan struktur item pesanan bekerja konsisten.
