# Setup Pembayaran Pedagang

Jalankan file SQL berikut di Supabase SQL Editor untuk database yang sudah live:

- `supabase/vendor-payment-methods.sql`

Perubahan yang ditambahkan:

- kolom `vendors.payment_details` untuk menyimpan:
  - foto QRIS
  - nama bank
  - nama pemilik rekening
  - nomor rekening
  - nama e-wallet
  - nomor e-wallet
  - catatan pembayaran
- metode pembayaran baru `ewallet` pada tabel `orders`

Setelah SQL dijalankan:

1. Redeploy frontend.
2. Login sebagai pedagang.
3. Buka `Profil`.
4. Isi QRIS, rekening bank, atau e-wallet.
5. Simpan profil.
6. Login sebagai pelanggan dan cek halaman toko pedagang.
