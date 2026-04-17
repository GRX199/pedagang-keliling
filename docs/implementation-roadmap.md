# Kelilingku Implementation Roadmap

## Goal

Roadmap ini memecah konsep Kelilingku menjadi fase implementasi yang realistis. Fokusnya adalah membangun fondasi produk yang stabil dulu, baru menambah diferensiasi.

## Phase 0: Product Foundation

Tujuan:

- Menyepakati arah produk dan struktur data.
- Menghindari refactor besar berulang.

Deliverables:

- Blueprint produk
- Roadmap implementasi
- Data model Supabase
- README proyek

Status:

- Sedang dikerjakan sekarang

## Phase 1: Operational MVP

Tujuan:

- Menjadikan Kelilingku usable end-to-end untuk pelanggan dan pedagang.

Scope:

- Landing page sederhana
- Auth pelanggan dan pedagang
- Peta utama sebagai home setelah login
- Marker pedagang online
- Filter dasar: kategori, radius, status
- Detail toko
- Katalog produk
- Keranjang dan checkout
- Order status dasar
- Chat untuk klarifikasi
- Dashboard pelanggan
- Dashboard pedagang

Order states minimum:

- `pending`
- `accepted`
- `preparing`
- `on_the_way`
- `arrived`
- `completed`
- `cancelled`

Acceptance criteria:

- Pelanggan bisa menemukan pedagang online di peta.
- Pelanggan bisa memesan dari katalog toko.
- Vendor menerima order dan update status realtime.
- Chat dan notifikasi bekerja cukup andal di dua device.
- Marker vendor hilang saat vendor offline.

## Phase 2: Trust And Transaction Quality

Tujuan:

- Membuat produk lebih rapi, aman, dan meyakinkan untuk dipakai harian.

Scope:

- Rating dan ulasan
- Jam operasional
- Area layanan
- Stok yang lebih jelas
- ETA dasar
- Payment confirmation flow untuk QRIS dan transfer
- Riwayat transaksi yang lebih rapi
- Admin panel ringan untuk verifikasi vendor dan moderasi

Acceptance criteria:

- Pelanggan punya konteks yang cukup sebelum order.
- Pedagang lebih mudah mengelola ketersediaan dan reputasi.
- Admin bisa menahan akun bermasalah.

## Phase 3: Differentiation

Tujuan:

- Menambahkan nilai pembeda yang kuat dibanding marketplace biasa.

Scope:

- Alert pedagang langganan dalam radius tertentu
- Pre-order berdasarkan area
- Titik temu pintar
- Promo ringan
- Heatmap permintaan
- Analytics wilayah

Acceptance criteria:

- Fitur baru benar-benar meningkatkan repeat order atau efisiensi pedagang.
- Tidak menurunkan performa map-first experience.

## Recommended Build Order

1. Rapikan struktur database dan status order.
2. Finalkan model halaman inti.
3. Rapikan checkout dan tracking order.
4. Stabilkan notifikasi dan realtime.
5. Tambahkan admin foundation.
6. Masuk ke review, rating, dan payment confirmation.
7. Baru tambahkan fitur pembeda.

## Immediate Implementation Backlog

### Backend/Data

- Tambah tabel kategori dan relasi vendor ke kategori utama.
- Ubah model order agar lebih kaya dari sekadar teks item.
- Tambah tabel order items.
- Tambah tabel notifications.
- Tambah field pembayaran dan titik temu.
- Tambah field status operasional vendor.

### Frontend

- Landing page publik
- Filter kategori pada peta
- Vendor store yang lebih lengkap
- Checkout terstruktur
- Halaman tracking order
- Dashboard pelanggan

### Admin

- Role admin di auth/profile
- Daftar vendor untuk verifikasi
- Tindakan approve, suspend, block

## Delivery Rules

- Setiap fase harus selesai end-to-end sebelum masuk ke fase berikutnya.
- Jangan menambah fitur diferensiasi saat status order dan tracking belum stabil.
- Semua penambahan schema harus kompatibel dengan RLS dan realtime.
- Semua perubahan UI harus tetap mobile-first.
