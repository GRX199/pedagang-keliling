# Pre-Order Setup

Fitur ini menambahkan mode `Pesan sekarang` dan `Titip untuk nanti` ke alur checkout yang sama.

## SQL Yang Perlu Dijalankan

Jalankan file berikut di Supabase SQL Editor:

- `supabase/preorders.sql`

## Field Baru

- `orders.order_timing`
  - `asap`
  - `preorder`
- `orders.requested_fulfillment_at`
  - waktu target saat pelanggan ingin pedagang melewati area atau titik temu tertentu

## Alur Produk

- `Pesan sekarang`
  - dipakai untuk transaksi normal yang ingin diproses secepatnya
- `Titip untuk nanti`
  - dipakai saat pelanggan ingin pedagang menyiapkan pesanan untuk area atau waktu tertentu
  - pelanggan sebaiknya mengisi area/titik temu dan waktu target

## Setelah SQL

1. Redeploy frontend.
2. Test dari halaman toko pedagang.
3. Coba buat dua jenis order:
   - order langsung
   - pre-order
4. Cek:
   - chat otomatis membawa konteks waktu pesanan
   - dashboard menampilkan label `Titip untuk nanti`
   - halaman lacak menampilkan jadwal pre-order jika ada
