# Setup Rating Dan Ulasan

Jalankan file SQL berikut di Supabase SQL Editor untuk database yang sudah live:

- `supabase/reviews-and-ratings.sql`

Fitur yang ditambahkan:

- tabel `reviews`
- satu ulasan untuk setiap order selesai
- hanya pembeli dari order `completed` yang bisa memberi atau mengubah ulasan
- ulasan tampil di halaman toko pedagang
- form ulasan tampil di halaman `Pesanan` dan `Lacak`

Setelah SQL dijalankan:

1. Redeploy frontend.
2. Login sebagai pelanggan.
3. Selesaikan satu order sampai status `completed`.
4. Buka `Pesanan` atau `Lacak`.
5. Kirim ulasan.
6. Buka halaman toko pedagang dan cek ringkasan rating serta daftar ulasan.
