# Admin Foundation Setup

Dokumen ini menjelaskan langkah minimum agar panel admin Kelilingku bisa dipakai untuk verifikasi pedagang dan moderasi dasar.

## Yang Sudah Ditambahkan di Aplikasi

- Role `admin` sekarang dikenali oleh aplikasi.
- Navbar admin dibedakan dari pelanggan dan pedagang.
- Dashboard admin memiliki panel ringan untuk:
  - verifikasi pedagang
  - aktivasi ulang akun
  - suspend akun
  - blokir akun
- Pedagang yang `suspended` atau `blocked` tidak lagi tampil normal di peta pelanggan.

## Yang Perlu Anda Jalankan di Supabase

1. Buka `SQL Editor`.
2. Jalankan seluruh isi file [`supabase/admin-foundation.sql`](/C:/xampp/htdocs/pedagang-keliling-react/supabase/admin-foundation.sql).

Migration ini menambahkan:

- `profiles.account_status`
- function `public.is_admin()`
- tabel audit `admin_actions`
- policy admin untuk update `profiles` dan `vendors`

## Cara Menjadikan Satu Akun Sebagai Admin

Karena halaman register publik memang hanya untuk pelanggan dan pedagang, akun admin perlu diatur manual.

Contoh SQL:

```sql
update public.profiles
set role = 'admin'
where id = 'USER_ID_ANDA';
```

Kalau Anda belum tahu `USER_ID`, Anda bisa melihatnya di:

- `Authentication > Users` pada Supabase Dashboard
- atau tabel `profiles`

## Setelah Migration

1. Logout lalu login ulang dengan akun admin.
2. Anda akan diarahkan ke `Dashboard > Admin`.
3. Coba:
   - verifikasi pedagang
   - suspend akun vendor
   - aktifkan kembali akun vendor

## Catatan Saat Ini

- Ini adalah `admin foundation`, belum admin dashboard penuh.
- Belum ada laporan abuse, analytics, atau workflow review yang kompleks.
- Tujuannya sekarang hanya membuat verifikasi dan moderasi dasar bisa berjalan end-to-end.
