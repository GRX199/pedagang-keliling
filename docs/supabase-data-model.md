# Kelilingku Supabase Data Model

## Purpose

Dokumen ini menerjemahkan konsep produk Kelilingku ke model data Supabase. Fokusnya adalah menjaga fondasi tetap sederhana, aman, dan siap dipakai untuk map-first commerce.

## Current Core Tables

Schema saat ini sudah memiliki:

- `vendors`
- `profiles`
- `products`
- `chats`
- `messages`
- `orders`

Ini sudah cukup untuk alur dasar, tetapi belum cukup kaya untuk target produk akhir.

## Target Domain Model

### Identity And Roles

- `profiles`
  - identitas publik user
  - role: `customer`, `vendor`, `admin`
- `vendors`
  - profil operasional pedagang
  - status online/offline
  - lokasi aktif
  - jam operasional
  - area layanan
  - verifikasi admin

### Discovery

- `categories`
  - kategori dagangan seperti sayur, bakso, kopi, gas, jajanan
- `vendor_categories`
  - relasi vendor ke satu atau banyak kategori
- `favorites`
  - pelanggan menyimpan pedagang langganan

### Commerce

- `products`
  - katalog produk vendor
- `orders`
  - header transaksi
- `order_items`
  - item detail per produk
- `payments`
  - status metode bayar
- `meeting_points`
  - titik temu atau alamat tujuan

### Social And Communication

- `chats`
  - kanal percakapan
- `messages`
  - isi percakapan
- `reviews`
  - rating dan ulasan toko
- `notifications`
  - event yang disederhanakan untuk badge, toast, dan inbox

### Admin And Moderation

- `vendor_verifications`
  - status verifikasi pedagang
- `reports`
  - laporan abuse atau masalah
- `admin_actions`
  - audit tindakan admin

## Recommended Tables For MVP+

### profiles

Fields:

- `id`
- `display_name`
- `avatar_url`
- `role`
- `phone`
- `created_at`
- `updated_at`

Role target:

- `customer`
- `vendor`
- `admin`

### vendors

Fields:

- `id`
- `user_id`
- `name`
- `description`
- `photo_url`
- `location`
- `online`
- `category_primary`
- `service_radius_km`
- `operating_hours`
- `service_mode`
- `is_verified`
- `last_seen_at`
- `created_at`
- `updated_at`

Notes:

- `location` sebaiknya `jsonb` untuk fase sekarang.
- Lokasi hanya diupdate saat vendor online.
- Jika vendor offline, marker disembunyikan dari map pelanggan.

### products

Fields:

- `id`
- `vendor_id`
- `name`
- `description`
- `price`
- `stock`
- `image_url`
- `is_available`
- `category_name`
- `created_at`
- `updated_at`

Notes:

- `stock` bisa nullable jika pedagang tidak ingin memberi angka pasti.
- `is_available` penting agar produk cepat dinonaktifkan tanpa dihapus.

### orders

Orders harus naik kelas dari model teks sederhana menjadi header transaksi.

Recommended fields:

- `id`
- `vendor_id`
- `vendor_name`
- `buyer_id`
- `buyer_name`
- `status`
- `payment_method`
- `payment_status`
- `fulfillment_type`
- `meeting_point_label`
- `meeting_point_location`
- `customer_note`
- `subtotal_amount`
- `delivery_fee`
- `total_amount`
- `accepted_at`
- `completed_at`
- `cancelled_at`
- `created_at`
- `updated_at`

Recommended order statuses:

- `pending`
- `accepted`
- `preparing`
- `on_the_way`
- `arrived`
- `completed`
- `cancelled`
- `rejected`

### order_items

Fields:

- `id`
- `order_id`
- `product_id`
- `vendor_id`
- `product_name_snapshot`
- `price_snapshot`
- `quantity`
- `line_total`
- `item_note`
- `created_at`

Kenapa penting:

- riwayat order tetap benar walaupun nama atau harga produk berubah di masa depan
- chat tidak perlu jadi sumber kebenaran item order

### notifications

Fields:

- `id`
- `user_id`
- `type`
- `title`
- `body`
- `entity_type`
- `entity_id`
- `is_read`
- `created_at`

Minimal notification types:

- `message_received`
- `order_created`
- `order_accepted`
- `order_rejected`
- `order_arrived`
- `order_completed`
- `vendor_nearby`
- `payment_confirmed`

### reviews

Fields:

- `id`
- `order_id`
- `vendor_id`
- `buyer_id`
- `rating`
- `comment`
- `created_at`

Rule:

- hanya buyer yang menyelesaikan order yang bisa review

## Realtime Strategy

Use realtime on:

- `vendors`
- `orders`
- `messages`
- `notifications`

Guidelines:

- update lokasi vendor setiap `10-15 detik` atau saat perpindahan `>20 meter`
- jangan simpan lokasi customer secara permanen
- sembunyikan lokasi vendor saat `offline`

## RLS Matrix

### Customer

- bisa membaca vendor online dan produk publik
- hanya bisa membaca order miliknya
- hanya bisa membuat order miliknya
- hanya bisa update order tertentu yang diizinkan, misalnya cancel
- hanya bisa membaca dan mengirim pesan di chat yang ia ikuti

### Vendor

- hanya bisa update profil vendor miliknya
- hanya bisa update produk miliknya
- hanya bisa membaca order yang masuk ke tokonya
- hanya bisa mengubah status order tokonya
- hanya bisa membaca dan mengirim pesan di chat yang ia ikuti

### Admin

- akses khusus berdasarkan service role atau schema admin terpisah
- tidak memakai policy publik biasa

## Data Model Gaps Against Current Schema

Schema saat ini masih belum punya:

- role `admin` pada `profiles`
- `categories`
- `order_items`
- `notifications`
- `reviews`
- field order yang lebih lengkap
- field vendor operasional seperti verifikasi, radius layanan, dan jam operasional
- stok dan availability yang lebih kaya pada `products`

## Recommended Migration Order

1. Tambah role `admin` di `profiles`
2. Tambah field operasional di `vendors`
3. Tambah field stok dan availability di `products`
4. Perluas `orders`
5. Tambah `order_items`
6. Tambah `notifications`
7. Tambah `categories` dan relasi vendor
8. Tambah `reviews`

## Design Rule

Chat adalah lapisan komunikasi, bukan sumber kebenaran transaksi.

Order, item order, status, pembayaran, dan tracking harus tetap memiliki struktur data sendiri agar dashboard, notifikasi, admin, dan analytics bisa berkembang dengan baik.
