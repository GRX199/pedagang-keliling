# Kelilingku Essential Roadmap

## Fokus Utama

Roadmap ini sengaja dipersempit hanya ke hal yang paling penting untuk Kelilingku.

Prinsipnya:

- utamakan alur inti `peta -> toko -> checkout -> chat -> tracking -> selesai`
- stabilkan pengalaman mobile lebih dulu
- jangan menambah fitur baru jika transaksi inti belum benar-benar nyaman dipakai

## Posisi Produk Saat Ini

Fondasi utama sudah ada:

- auth pelanggan dan pedagang
- peta utama dengan pedagang online
- toko vendor dan katalog produk
- checkout, chat, dan status order
- tracking order di peta
- payment info vendor
- review dan rating
- admin foundation
- fitur pembeda awal seperti favorit, pre-order, dan insight wilayah sederhana

Artinya roadmap berikutnya tidak perlu lagi terlalu lebar. Fokus kita sekarang adalah membuat yang sudah ada menjadi kuat, rapi, dan siap dipakai harian.

## Prioritas 1: Core Flow Stability

Tujuan:

- memastikan alur transaksi inti benar-benar stabil di dua device dan di mobile

Yang termasuk penting:

- live location vendor tetap konsisten saat online
- notifikasi chat dan order tetap andal tanpa refresh kasar
- tracking order stabil sampai status selesai
- tampilan mobile untuk pelanggan dan pedagang benar-benar jelas per role
- edge case order ditangani dengan baik: batal, ditolak, pembayaran belum cocok, vendor offline

Acceptance criteria:

- pelanggan bisa pesan tanpa bingung dari peta sampai tracking
- pedagang bisa menerima, memproses, dan menyelesaikan order tanpa langkah yang mubazir
- tidak ada refresh visual yang mengganggu di chat, pesanan, dan tracking

## Prioritas 2: Production Readiness

Tujuan:

- membuat aplikasi aman dan layak diuji lebih serius di lingkungan online

Yang termasuk penting:

- audit RLS Supabase per role
- validasi dan hardening upload
- audit CORS, env, dan secret handling
- error state yang lebih jelas untuk jaringan lambat atau izin lokasi ditolak
- logging operasional dasar untuk bug penting
- staging checklist dan smoke test sebelum release

Acceptance criteria:

- pelanggan hanya melihat data miliknya
- pedagang hanya bisa mengelola tokonya sendiri
- admin punya kontrol dasar yang aman
- aplikasi tetap usable saat koneksi tidak ideal

## Prioritas 3: Trust And Operations

Tujuan:

- memperkuat rasa percaya dan kualitas operasional, bukan sekadar menambah fitur

Yang termasuk penting:

- verifikasi pedagang yang lebih jelas
- profil toko yang konsisten: kategori, jam operasional, area layanan, pembayaran
- status pembayaran dan order yang mudah dipahami
- riwayat transaksi yang rapi untuk kedua role
- review dan rating tetap relevan dan tidak mengganggu flow

Acceptance criteria:

- pelanggan punya cukup konteks sebelum order
- pedagang lebih mudah menjaga reputasi dan kesiapan toko
- admin bisa menahan akun bermasalah tanpa merusak flow utama

## Prioritas 4: Differentiation, Tapi Selektif

Tujuan:

- memakai fitur pembeda hanya yang benar-benar membantu repeat order atau efisiensi vendor

Yang tetap layak dipertahankan:

- pedagang favorit
- alert pedagang favorit sudah dekat
- pre-order berdasarkan area
- insight wilayah sederhana dari order

Yang tidak perlu diprioritaskan dulu:

- promo yang terlalu kompleks
- loyalty program
- analytics admin yang detail
- heatmap atau dashboard analitik yang terlalu berat
- fitur baru yang menambah banyak layar baru

Acceptance criteria:

- fitur pembeda membantu keputusan, bukan menambah kebingungan
- tidak membuat UI makin ramai
- tidak menurunkan performa pengalaman map-first

## Build Order Yang Paling Penting

1. stabilkan core flow pelanggan dan pedagang
2. rapikan mobile UX per role
3. hardening security dan production readiness
4. rapikan trust and operations
5. pertahankan hanya fitur pembeda yang terbukti berguna

## Yang Harus Ditahan Dulu

Jangan diprioritaskan sekarang:

- payment gateway penuh
- multi-vendor checkout
- loyalty
- sistem promo kompleks
- analytics admin lanjutan
- fitur baru yang belum jelas dampaknya ke transaksi inti

## Aturan Kerja

- setiap perubahan harus mobile-first
- pelanggan dan pedagang harus punya tampilan dan prioritas aksi yang berbeda
- jika sebuah fitur tidak membantu transaksi inti, pertimbangkan untuk disederhanakan atau dihapus
- kualitas flow lebih penting daripada banyaknya fitur
