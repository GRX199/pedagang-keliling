# Pengambilan Kelilingku: implementasi dan aktivasi

## Progres Utama Dan COD

Jalankan `supabase/pickup-cod-progress.sql` setelah `pickup-simple-handover.sql`, sebelum deploy pembaruan ini. Pedagang pickup tidak lagi memiliki tombol konfirmasi COD terpisah. Pada status siap, tombol Selesaikan pesanan berada di bagian progres utama. Konfirmasi terakhir secara eksplisit menyatakan barang sudah diserahkan dan uang diterima. Satu RPC mengunci pesanan, mencatat COD lunas, lalu menyelesaikan pesanan dalam transaksi yang sama; kegagalan membatalkan seluruh perubahan. Pengulangan tidak mengurangi stok dua kali. Pembayaran non-tunai tetap harus diperiksa terlebih dahulu; pesanan legacy mempertahankan alur lamanya.

## Checkout Ringkas

Pilihan waktu dihapus dari checkout baru; payload selalu `asap` tanpa jadwal. Ambil sendiri membaca GPS satu kali saat pelanggan mengirim pesanan (dengan izin browser), sebagai lokasi acuan pelanggan saat memesan, bukan kewajiban antar pedagang. Jika GPS ditolak atau gagal, pesanan tetap bisa dikirim tanpa koordinat dan pengambilan dikoordinasikan lewat chat. Kurir tidak meminta GPS atau input lokasi; payload koordinat kosong, dengan keterangan mengambil ke pedagang. Peta kurir hanya menampilkan pedagang, bukan posisi kurir. Perubahan checkout ini tidak membutuhkan SQL tambahan; persyaratan migrasi serah terima tanpa kode di bawah tetap berlaku.

## Pembaruan 17 September: Tanpa Kode

Aturan terbaru menggantikan persyaratan kode dalam dokumentasi historis di bawah. Pedagang memilih **Selesaikan pesanan**, lalu **Ya, sudah diserahkan**. Pelanggan tidak perlu mencari kode. Nama kurir opsional, sedangkan ambil sendiri memakai nama pelanggan. Pembayaran tetap harus lunas dan status harus siap diambil. Penyelesaian hanya oleh pedagang pemilik yang aktif, waktu serah terima dicatat, dan stok berkurang satu kali. Konfirmasi ini adalah pernyataan pedagang, bukan verifikasi identitas dengan kode.

Untuk database yang sudah dimigrasi sebelumnya, jalankan **hanya `supabase/pickup-simple-handover.sql`** di SQL Editor sebelum deployment frontend terbaru. Untuk instalasi baru, jalankan berkas tersebut setelah `pickup-flow.sql`. Jangan menjalankan ulang `pickup-flow.sql` setelahnya. Tabel kode lama dipertahankan sebagai kompatibilitas internal checkout, tetapi akses kode dari browser dicabut dan tidak digunakan untuk menyelesaikan pesanan.

Uji dua perangkat: pesanan ready tetapi belum lunas tidak dapat selesai; setelah lunas tombol tersedia; memilih Belum tidak mengubah status; memilih Ya menyelesaikan pesanan tanpa input; pelanggan tidak memiliki tombol penyelesaian. Ulangi permintaan penyelesaian untuk memastikan stok tidak berkurang dua kali. Tes lama `supabase/tests/pickup-flow.sql` khusus keadaan sebelum migrasi ini; sesudahnya gunakan `supabase/tests/pickup-simple-handover.sql`.

Tanggal: 16 September 2026. Dokumen ini menjelaskan perubahan aplikasi utama, bukan wireframe. Migrasi disiapkan dalam repositori dan diuji pada PostgreSQL lokal terisolasi. Belum diterapkan ke Supabase produksi dan belum diuji antardua perangkat fisik.

## Alur yang berlaku

Pesanan baru menggunakan `service_flow = pickup_v1`. Pelanggan memilih ambil sendiri (`self_pickup`) atau kurir yang dipesan pelanggan di aplikasi lain (`customer_courier`). Kurir eksternal bukan akun Kelilingku. Tidak ada integrasi ojol, perhitungan ongkir, pembayaran kurir, atau pelacakan pengemudi. Total checkout hanya harga barang.

| Tahap | Pelanggan | Pedagang |
| --- | --- | --- |
| Menunggu persetujuan (`pending`) | Mengusulkan titik sesuai rute; boleh memperbaiki patokan atau membatalkan | Memeriksa stok, titik, dan jadwal; menyetujui titik atau menolak |
| Disetujui (`accepted`) | Menunggu barang siap; boleh konfirmasi pembayaran non-tunai | Menyiapkan barang; memeriksa pembayaran; menandai siap diambil |
| Siap diambil (`ready`) | Datang sendiri atau memesan kurir eksternal, mengisi nama pengambil, membagikan kode hanya untuk serah terima | Mencocokkan nama, memastikan dana diterima, memasukkan kode ketika barang diserahkan |
| Selesai (`completed`) | Melihat riwayat dan memberi ulasan | Stok barang berkurang satu kali sesuai jumlah pesanan |

Persetujuan mengunci titik. Perubahan setelah persetujuan harus dikoordinasikan lewat chat, bukan memindahkan pin sepihak. Pembatalan mandiri dibatasi pada pending. Jika pengambilan tidak bisa diselesaikan setelah diterima, kedua pihak menghubungi pengelola; fitur penyelesaian sengketa dan refund otomatis belum dibuat. Jangan menandai transaksi selesai tanpa serah terima hanya untuk mengosongkan antrean.

Pembayaran non-tunai baru dikonfirmasi setelah persetujuan. Tombol pelanggan bukan bukti otomatis dana masuk: pedagang tetap memeriksa QRIS/rekening/e-wallet. COD dikonfirmasi saat barang siap dan dana diterima. Untuk kurir, pelanggan dan pedagang menyepakati pembayaran barang melalui chat; pembayaran jasa kurir tetap di luar website.

## Aturan Data

- `create_pickup_order` memeriksa pelanggan aktif, pedagang aktif terverifikasi, lokasi segar, cara pengambilan, persetujuan kurir, produk, harga, dan stok. Order, item, cadangan stok, serta kode dibuat dalam satu transaksi database. Jalur INSERT browser dan RPC checkout lama tidak digunakan lagi.
- Stok tersedia untuk dipesan adalah stok fisik dikurangi `reserved_stock`. Selesai mengurangi stok; pembatalan dan penolakan melepas cadangan. Produk tanpa angka stok tetap fleksibel. Mode stok dan penghapusan produk dikunci selama masih ada pesanan aktif. Tombol Habis tidak menghapus stok yang sudah dicadangkan.
- RLS membatasi peserta pesanan. Hak UPDATE dari browser hanya mencakup status dan pembayaran. Field titik serta pengambil menggunakan RPC dengan penguncian baris; field komersial dan bukti serah terima tidak bisa diubah langsung.
- Kode hanya bisa dibaca pelanggan pemilik saat status ready. Kode tidak dimasukkan ke chat otomatis, tabel orders, atau publication Realtime. Pedagang memverifikasi melalui `confirm_pickup_handover`. Lima kode salah menyebabkan jeda 15 menit. Pengulangan penyelesaian tidak mengurangi stok lagi.
- Lokasi pedagang disembunyikan ketika offline, tidak terverifikasi, dibatasi, atau lebih lama dari dua menit. Offline menghapus lokasi aktif. Lokasi pelanggan tidak diambil otomatis pada checkout; koordinat hanya disimpan sebagai usulan titik jika pengguna secara eksplisit memilih lokasinya. Edit patokan menghapus pin lama agar tidak menyesatkan.
- Mobilitas (`walking`, `pushcart`, `bicycle`, `motor_vehicle`) terpisah dari kategori barang. Profil menyediakan area berjualan, rute deskriptif, dan titik berhenti. Pencarian peta mencakup area/rute dan filter mobilitas.
- Peta pengambilan menampilkan jarak garis lurus dan usia lokasi, bukan estimasi perjalanan. Pembaruan data tidak membuat ulang instance peta atau menghapus draft form. Angka ETA berbasis asumsi kecepatan di pelacakan lama juga dihapus.

Pesanan yang sudah ada tetap `legacy`, dengan jenis meetup/delivery dan urutan status lamanya. Halaman detail memberi label alur lama. Data lama tidak dikonversi menjadi kurir pelanggan atau dipaksakan membutuhkan kode baru.

## Aktivasi Supabase Dan Deployment

1. Pastikan proyek Supabase sudah aktif, bukan paused. Pilih waktu pemeliharaan ketika pengguna tidak sedang checkout. Siapkan backup database dan pastikan cara pemulihannya tersedia. Backup database tidak mencakup isi file Storage, sehingga foto perlu ditangani terpisah. Ikuti [panduan backup resmi Supabase](https://supabase.com/docs/guides/platform/backups).
2. Periksa bahwa database sudah memakai `schema.sql`, `phase1-foundation.sql`, `admin-foundation.sql`, `production-hardening.sql`, lalu `order-payment-guard.sql`. Pada proyek yang selama ini sudah berjalan dengan hardening, jangan mengulang seluruh SQL lama. Jika ragu, periksa fungsi `guard_order_update`, kolom `products.reserved_stock`, dan tabel `order_inventory_settlements` terlebih dahulu. Hentikan aktivasi jika prasyarat belum jelas.
3. Buka proyek Supabase yang sama, pilih **SQL Editor**, buat query baru, dan jalankan seluruh isi `supabase/pickup-flow.sql`. Berkas memakai transaksi `begin`/`commit`: bila error, hentikan dan periksa pesan, jangan menjalankan potongan sisanya. Jangan jalankan berkas di `supabase/tests` pada produksi.
4. Jalankan `supabase/pickup-verification.sql`. Semua pemeriksaan boolean harus bernilai true. Hasil ini hanya memeriksa instalasi, bukan membuktikan transaksi antarakun. Jangan menonaktifkan RLS untuk mengatasi error. [RLS dan grants sama-sama menentukan akses](https://supabase.com/docs/guides/database/postgres/row-level-security).
5. Periksa publication `supabase_realtime`: orders, vendors, messages, dan notifications harus ada. Jangan tambahkan `pickup_codes`. Konfigurasi publication mengikuti [panduan Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes). Tidak dibutuhkan tabel atau akun kurir baru.
6. Deploy frontend versi kode ini ke Vercel dan backend `server/app.js` ke Render pada jendela pemeliharaan yang sama. Build frontend tetap `npm run build`, hasil `dist`; tidak ada migrasi Next.js. URL Supabase dan publishable key tetap sama. Tidak ada kebutuhan menaruh service-role key di frontend.
7. Pastikan pedagang pengujian telah diverifikasi admin. Migrasi menonaktifkan pedagang yang belum terverifikasi; mereka tidak otomatis mendapat verifikasi. Isi mobilitas, area, rute, titik berhenti, harga, dan metode pembayaran melalui Profil/Produk.
8. Setelah deploy berhasil, buka ulang website/PWA di kedua perangkat agar memakai bundle baru. Aplikasi lama tidak bisa checkout lewat RPC lama setelah migrasi; itu disengaja untuk mencegah pesanan baru dengan alur yang berbeda.
9. Jalankan skenario dua perangkat di bawah. Aktifkan pemakaian lebih luas setelah hasilnya dicatat dan masalah penting ditutup.

Jangan menjalankan ulang SQL migrasi lama setelah `pickup-flow.sql`: migrasi lama akan mengganti kembali aturan status dan grants. Jangan melakukan rollback frontend saja setelah mulai ada pesanan pickup. Jika terjadi gangguan, hentikan checkout baru, periksa log, dan siapkan perbaikan maju; pemulihan backup dapat menghilangkan transaksi setelah waktu backup dan membutuhkan keputusan pengelola.

## Tes Dua Perangkat

Gunakan produk dan akun uji. Jangan mengirim uang nyata untuk simulasi tanpa kesepakatan kedua pihak.

1. Pelanggan menemukan pedagang terverifikasi yang online. Coba pencarian area dan filter mobilitas secara terpisah dari kategori barang.
2. Pilih produk, jumlah, catatan, patokan titik, dan ambil sendiri. Jangan izinkan GPS: checkout manual tetap bisa dibuat, tanpa pin pelanggan palsu.
3. Sebelum diterima, ubah titik. Pastikan pedagang melihat titik terbaru. Coba aksi menerima dari halaman lama bersamaan dengan edit: halaman lama tidak boleh melaporkan persetujuan berhasil bila data berubah.
4. Pedagang menerima lalu menandai siap diambil. Pelanggan tidak boleh melompati status, mengubah titik setelah diterima, atau menandai pembayaran sendiri sebagai lunas.
5. Pada COD, pedagang tandai lunas saat menerima dana. Coba kode salah, lalu kode pelanggan yang benar saat serah terima. Stok berkurang sesuai jumlah hanya sekali; kode hilang dari tampilan setelah selesai.
6. Buat pesanan kurir pelanggan. Tanpa persetujuan biaya/pengaturan eksternal, checkout harus ditolak. Setelah ready, isi nama pengambil. Coba transfer manual, konfirmasi pelanggan, pengecekan pedagang, lalu serah terima memakai kode.
7. Tolak atau batalkan pesanan pending. Cadangan stok kembali tanpa menurunkan stok fisik. Coba dua pelanggan memesan unit terakhir: hanya satu berhasil.
8. Matikan status online, cabut verifikasi, dan coba kondisi lokasi lebih lama dari dua menit. Pelanggan tidak boleh terus melihat marker aktif. Pesanan yang sudah diterima tetap tersedia untuk koordinasi, dengan patokan tertulis dan chat.
9. Ketik draft titik/nama saat pembaruan realtime terjadi. Draft, fokus input, dan zoom peta tidak boleh hilang. Uji jaringan terputus/pulih, foto chat, serta notifikasi order dan pembayaran.
10. Buka pesanan legacy yang belum selesai: label lama terlihat dan status lama tetap bisa diteruskan. Buka histori pickup selesai: tidak ada aksi pembayaran atau serah terima ulang.

Catat perangkat, browser, akun/role, langkah, hasil yang diharapkan, hasil aktual, dan bukti. Tes pengembang/simulasi tidak boleh ditulis sebagai wawancara atau UAT pengguna yang sudah dilakukan.

## Pengujian Lokal

`npm run check` menjalankan lint, unit test, parser SQL, build, dan pengecekan sintaks backend. Parser SQL tidak mengeksekusi isi PL/pgSQL atau memeriksa transaksi.

Pengujian database tambahan memakai PostgreSQL 18 lokal terisolasi pada `127.0.0.1:55439`, bukan Supabase cloud. `supabase/tests/local-bootstrap.sql` hanya untuk database kosong lokal; berkas itu mensimulasikan skema auth, role, dan storage yang dibutuhkan migrasi. Auth HTTP dan Realtime Supabase tidak berjalan dalam simulasi ini. Jalankan keenam migrasi dalam urutan di atas lalu `supabase/tests/pickup-flow.sql` menggunakan psql. Berkas tes membuat data contoh dan rollback di akhir. Tidak dijalankan lewat `supabase test db` karena memakai perintah psql, bukan pgTAP.

`node scripts/test-pickup-concurrency.mjs` menguji dua checkout simultan dengan koneksi PostgreSQL lokal terpisah. `PSQL_PATH` dapat menunjuk executable psql. Host dan port sengaja dibatasi ke cluster tes lokal. Script membersihkan fixture miliknya, bukan tabel aplikasi produksi.

`node scripts/test-pickup-ui.mjs` menggunakan Playwright yang sudah terpasang (`PLAYWRIGHT_MODULE_PATH` bila perlu). Pengujian memuat komponen aplikasi sebenarnya dengan layanan tiruan khusus tes: 48 kombinasi viewport/role/status dan checkout pada mobile/desktop. Semua akses layanan eksternal diblokir, termasuk tile peta. Tangkapan layar berada di `test-results/pickup/` yang diabaikan Git. Berkas fixture dalam `tests/ui` tidak diimpor entry production dan tidak ditempatkan di `public`.

## Batas Sebelum Pemakaian Luas

- Pengujian Supabase live, dua perangkat fisik, notifikasi realtime jaringan nyata, dan pengambilan lapangan masih harus dilakukan.
- Browser/PWA tidak menjamin GPS berjalan terus di latar belakang. Usia lokasi dan status tidak aktif tetap digunakan.
- Pembayaran dan refund manual, bukan gateway. Pengambilan gagal setelah acceptance membutuhkan koordinasi/pengelola; belum ada alur sengketa, kedaluwarsa reservasi otomatis, atau pembatalan bersama.
- Klik ganda dicegah pada UI dan stok dijaga transaksi database. Pengulangan checkout baru setelah hasil jaringan tidak jelas belum memiliki kunci idempotensi lintas-reload; periksa daftar pesanan sebelum mengulang permintaan. Penyelesaian serah terima sendiri sudah idempotent.
- Rute deskriptif dan jenis mobilitas diisi pedagang, bukan prediksi rute. Heatmap lama belum dikembangkan menjadi analisis permintaan populasi dan tidak boleh diklaim mewakili seluruh wilayah.
