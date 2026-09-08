# Pembaruan Stabilitas Kelilingku

Pembaruan ini mempertahankan React/Vite, Supabase, dan backend yang sudah dipakai.
Fokusnya adalah memperkuat sesi, transaksi, dan keamanan peta tanpa menambah layar baru.

## Perubahan

- Pembaruan token tidak lagi mengosongkan role, membongkar halaman aktif, atau mengulang subscription realtime.
- Verifikasi akun saat kembali ke tab berjalan di background. Hasil lookup lama tidak dapat memulihkan akun setelah logout atau menimpa akun yang baru login.
- Aksi status dan pembayaran di daftar pesanan dan tracking menggunakan satu fungsi bersama. Tombol transaksi dikunci selama penyimpanan dan sinkronisasi.
- Update status biasa memeriksa status dan pembayaran sebelumnya. Jika perangkat lain sudah mengubah pesanan, aplikasi memuat ulang data dan tidak mengklaim berhasil.
- Penyelesaian pesanan hanya melalui RPC database. Pengurangan stok dari browser yang tidak atomik sudah dihapus.
- Pesanan berakhir tidak lagi menawarkan konfirmasi pembayaran baru. Konfirmasi COD hanya tersedia saat tiba dan belum dibayar.
- Tujuan pembayaran mengikuti snapshot checkout, termasuk saat pedagang mengganti rekening setelah order dibuat. Pesanan lama tanpa snapshot memakai data toko.
- Popup tracking dan tooltip heatmap menampilkan masukan pengguna sebagai teks, bukan HTML.
- Respons pemuatan pesanan yang sudah digantikan permintaan baru diabaikan.

## Langkah Pemilik Project

1. Untuk database yang sudah menjalankan `production-hardening.sql`, jalankan [order-payment-guard.sql](../supabase/order-payment-guard.sql) di SQL Editor Supabase. File kecil ini menolak perubahan pembayaran oleh peserta pada pesanan yang sudah berakhir; tidak menghapus data.
2. Pastikan RPC penyelesaian sudah ada dengan query baca-saja berikut:

```sql
select to_regprocedure('public.complete_order_and_decrement_stock(uuid)') as completion_rpc;
```

Jika hasilnya `null`, terapkan [production-hardening.sql](../supabase/production-hardening.sql) sesuai [panduan hardening](./production-hardening.md) sebelum menguji penyelesaian order. Jangan menjalankan ulang `product-stock-automation.sql` sesudah hardening: file lama tersebut memakai mekanisme stok sebelum reservasi.

3. Deploy frontend dari commit pembaruan ini. Tidak ada perubahan environment atau backend Render dalam pembaruan ini.
4. Uji alur berikut dengan pelanggan dan pedagang di dua perangkat.

## Uji Dua Perangkat

1. Login sebagai kedua role. Buka tracking atau ketik draft chat, lalu pindah tab dan kembali. Draft, peta, dan halaman aktif tidak boleh hilang hanya karena pembaruan sesi.
2. Buat pesanan COD. Jalankan progres sampai tiba, tandai lunas, lalu selesaikan. Stok berkurang satu kali sesuai jumlah produk; stok opsional tetap dapat digunakan.
3. Ketuk Terima atau Selesaikan beberapa kali dengan cepat. Aksi dikunci selama proses; hasilnya tidak boleh menggandakan pengurangan stok.
4. Buka order yang sama di dua tab. Ubah status di satu tab dan coba aksi lama di tab lainnya. Tab lama harus menerima data terbaru atau pesan bahwa order sudah berubah.
5. Buat order non-tunai, kirim konfirmasi, lalu tolak order saat pending. Tidak boleh ada tombol pembayaran baru di daftar maupun tracking. Jika dana sudah terkirim, koordinasikan pengembalian melalui chat; fitur refund otomatis tidak ditambahkan.
6. Ubah rekening toko setelah checkout. Tracking order yang memiliki snapshot harus tetap menampilkan rekening saat checkout.
7. Logout saat koneksi lambat. Hasil verifikasi lama tidak boleh membuat akun kembali masuk.

## Batas Verifikasi

`npm run check` memeriksa lint, unit test, parsing SQL, build frontend, dan sintaks backend.
Unit test menggunakan simulasi respons auth dan database untuk menguji transisi dan kondisi balapan.
Parsing SQL tidak mengeksekusi trigger/RLS pada Supabase. Penerapan migration dan uji transaksi dua perangkat tetap diperlukan pada project yang sudah deploy.
