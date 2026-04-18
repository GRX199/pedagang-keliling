# Favorites Setup

Fitur `pedagang favorit` dipakai sebagai fondasi untuk repeat order dan alert pedagang langganan di fase berikutnya.

## Langkah Aktivasi

1. Buka Supabase `SQL Editor`.
2. Jalankan isi file [favorites.sql](/C:/xampp/htdocs/pedagang-keliling-react/supabase/favorites.sql).
3. Redeploy frontend.
4. Login ulang sebagai pelanggan bila perlu.

## Setelah Aktif

- Pelanggan bisa menyimpan pedagang favorit dari halaman toko.
- Peta akan menampilkan chip filter `Favorit Saya`.
- Dashboard pelanggan menampilkan akses cepat ke pedagang favorit.

## Catatan

- Fitur ini hanya tampil untuk role `customer`.
- Kalau SQL belum dijalankan, aplikasi akan menyembunyikan fitur favorit agar UI tetap aman.
