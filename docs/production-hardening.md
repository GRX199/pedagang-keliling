# Production Hardening Kelilingku

## Urutan Penerapan

1. Rotasi `service_role key` di dashboard Supabase karena kunci lama pernah masuk Git.
2. Perbarui `SUPABASE_SERVICE_ROLE_KEY` pada environment backend Render.
3. Jalankan [`supabase/production-hardening.sql`](/C:/xampp/htdocs/pedagang-keliling-react/supabase/production-hardening.sql) melalui SQL Editor Supabase.
4. Deploy backend terlebih dahulu, lalu frontend.
5. Logout dan login ulang seluruh akun pengujian.

## Yang Diamankan

- Role dan status akun tidak dapat diubah oleh pemilik akun.
- Akun suspended atau blocked tidak dapat bertransaksi atau mengaktifkan toko.
- Peserta chat tidak dapat diganti setelah percakapan dibuat.
- Checkout memvalidasi produk, harga, vendor, stok, dan total di database.
- Stok dicadangkan saat checkout dan diselesaikan atau dilepas secara atomik.
- Status order dan pembayaran harus mengikuti transisi yang valid.
- Vendor offline atau presence yang lebih lama dari dua menit tidak dapat dibaca pelanggan.
- Upload langsung ke Storage ditutup; backend memeriksa ukuran, MIME, dan signature file.

## Catatan Git

`.env.local` dan `server/.env` sudah di-ignore dan dikeluarkan dari tracking, tetapi commit lama masih menyimpan nilainya. Rotasi key wajib dilakukan. Pembersihan histori Git dapat dilakukan terpisah setelah semua anggota tim memastikan tidak ada branch penting yang akan hilang.

## Smoke Test Wajib

1. Customer dan vendor dapat login pada dua device.
2. Vendor online baru muncul setelah lokasi berhasil tersinkron.
3. Marker hilang maksimal dua menit setelah location heartbeat berhenti.
4. Customer dapat checkout dan total mengikuti harga database.
5. Dua customer yang memesan stok terakhir tidak dapat sama-sama melewati validasi.
6. Vendor tidak dapat melompati status order.
7. Customer hanya dapat mengirim konfirmasi bayar; vendor yang mengonfirmasi atau menolak.
8. Penolakan atau pembatalan mengembalikan stok yang dicadangkan.
9. Foto chat, avatar, produk, dan QRIS tetap dapat diunggah.
10. Akun yang diblokir tidak dapat mengaktifkan toko atau memperbarui data.
