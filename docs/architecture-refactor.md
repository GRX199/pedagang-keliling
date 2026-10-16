# Refactor Adaptif Kelilingku

## Status Terbaru 17 Oktober 2026

Rilis performa/keandalan `168814e` telah dipush dan diperiksa pada
Vercel/Render/Supabase asli: CI, smoke publik dan 22 pemeriksaan hosted lulus;
seluruh data QA dibersihkan. UAT HP fisik, inbox email dan akun admin sah
masih memerlukan pemilik. Bukti penerapan dan status pengerjaan terkini ada di
[performa dan keandalan](performance-reliability.md), skema/ERD aktual di
[model data](supabase-data-model.md), dan UAT fisik di
[checklist perangkat](uat-perangkat.md). Bukti historis di bagian akhir tetap
merujuk run/tanggal yang tertulis, bukan status deployment terbaru.

Tanggal pemeriksaan: 15-16 Oktober 2026. Perubahan dibuat di repositori yang sama, tanpa migrasi ke Next.js dan tanpa mengubah skema database production. Penulisan sementara hanya dilakukan untuk data QA yang diizinkan dan kemudian dibersihkan.

## Fakta Hasil Inspeksi

- React 18, React Router 7, Vite, Tailwind 4.3.3 dan plugin `@tailwindcss/vite` dipertahankan. Tidak menambahkan konfigurasi PostCSS/Tailwind 3.
- Konfigurasi frontend memakai `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SERVER_URL`, dan `VITE_SUPABASE_BUCKET`. `VITE_SUPABASE_ANON_KEY` tetap didukung sebagai fallback. Isi environment tidak disalin ke dokumentasi atau source.
- Skema diperiksa dari `schema.sql`, `phase1-foundation.sql`, `admin-foundation.sql`, `production-hardening.sql`, `order-payment-guard.sql`, `pickup-flow.sql`, `pickup-simple-handover.sql`, dan `pickup-cod-progress.sql`.
- Tipe dibuat dari katalog PostgreSQL lokal setelah seluruh migrasi tersebut diterapkan: 15 tabel dan 10 fungsi yang boleh dieksekusi role authenticated. Ini bukan hasil introspeksi database hosted.
- Kolom seperti `service_flow`, `reserved_stock`, `handed_over_at`, dan nama argumen RPC mengikuti SQL asli. Nilai PostgreSQL text tidak diubah menjadi enum database fiktif; union domain UI disimpan terpisah.
- RPC progres utama saat ini adalah `complete_pickup_order(target_order_id)`. `confirm_pickup_handover` tetap ada untuk kompatibilitas, tetapi bukan jalur COD utama frontend.

## Arsitektur

```text
main.tsx
  QueryClientProvider -> AuthProvider -> BrowserRouter
    App.tsx -> AppNavigation + route lazy-loaded
      features/auth     sesi, login, proteksi route
      features/map      peta, filter, data marker
      features/vendor   toko, katalog, produk, GPS pedagang
      features/orders   daftar, detail pickup, progres, ulasan
      features/chat     inbox, ruang chat, pesan, preview foto
      features/admin    verifikasi dan moderasi pedagang
      shared            UI dasar, hooks, Supabase typed, media, query client
      types             database hasil generasi + tipe domain UI
```

UI memanggil hook fitur. Hook membaca atau memutasi data melalui klien Supabase bertipe. Realtime menginvalidasi cache, dan polling terkontrol menjadi fallback saat halaman terlihat. `useEffect` tetap dipakai untuk efek browser yang memang memerlukannya: instance Leaflet, GPS, subscription, resize, focus, dan preview object URL.

Cache diberi identitas pengguna, dibersihkan saat identitas berubah/logout, serta tidak dipersistensikan ke localStorage. Penggantian token untuk akun yang sama tidak membongkar halaman. Mutasi tidak diulang otomatis ketika hasil jaringan belum pasti.

Ruang chat menggabungkan hasil HTTP dengan cache terbaru berdasarkan ID pesan. Ini mencegah respons awal yang lambat menghapus pesan realtime atau pesan yang baru dikirim. Implementasi terbaru membuka 40 pesan terakhir, menyediakan halaman pesan sebelumnya, dan memakai cursor `(created_at,id)` untuk timestamp sama. Cursor kemajuan HTTP terpisah dari event realtime sehingga pesan terbaru tidak melewati celah koneksi. State caption dan preview tetap lokal per percakapan.

Daftar pesanan membuka maksimal 20 pesanan aktif dan memuat riwayat hanya saat
dibuka. Join detail/ulasan hanya untuk halaman terpilih. Filter identitas dan
status, pencarian snapshot order, serta cursor dilakukan di server. Hitungan
halaman yang belum lengkap diberi `+`, bukan diklaim sebagai total seluruh toko.

Status sinkronisasi tidak lagi berlabel Realtime tanpa konteks. Data terakhir
dipertahankan ketika pembaruan gagal; browser offline dan koneksi fallback
ditandai ringkas. Mutasi memakai `networkMode=always` dan `retry=false` agar tidak
mengantre transaksi yang kemudian terkirim sendiri saat reconnect. Deadline
request tidak membuktikan bahwa transaksi server dibatalkan; hasil yang belum
pasti harus diperiksa pada order sebelum mencoba ulang.

Query/mutation error dan kegagalan runtime dilaporkan secara best-effort ke
endpoint Express `/client-errors` yang membutuhkan sesi valid dan rate limit.
Payload hanya area/kategori/source/event UUID; tidak berisi query key, pesan
error mentah, stack, email, lokasi, token atau isi chat. Log server berupa JSON
aman dengan `requestId` untuk korelasi. Pelaporan tidak disimpan offline dan
kegagalannya tidak memblokir aksi pengguna. Log Render bukan tabel transaksi.

Express masih digunakan untuk upload terautentikasi dan endpoint operasional pedagang. `shared/lib/media.ts` menjadi abstraction layer bertipe untuk upload, termasuk pembaruan token. Tidak memindahkan upload langsung ke Storage tanpa audit kebijakan bucket. Service-role key tidak boleh berada di bundle frontend.

## Aturan Bisnis

- Pickup baru: `pending -> accepted -> ready -> completed`, atau `rejected`/`cancelled`. Pengambilan: `self_pickup` dan `customer_courier`.
- Checkout menggunakan 12 argumen asli `create_pickup_order`. Tidak meminta jadwal baru atau kode PIN. Lokasi kurir tidak diwajibkan.
- Penyelesaian COD menggunakan satu RPC `complete_pickup_order`. Pelunasan COD, pelepasan reservasi, dan pengurangan stok ditangani transaksi database yang sudah ada, bukan dikurangi manual di React.
- UI publik menyaring pedagang dengan `isVendorPresenceFresh`: terverifikasi, online, koordinat valid, dan data kehadiran tidak lebih dari 120 detik. Data toko sendiri yang offline tetap dapat dibaca pemilik untuk kontrol operasional, tetapi bukan marker publik.
- GPS hanya disinkronkan untuk pedagang online dan terverifikasi, saat bergerak minimal 20 meter atau setelah 15 detik. Heartbeat aktif pada halaman yang terlihat. Request tidak ditumpuk; callback lama tidak menulis setelah cleanup. Query update juga memeriksa `online=true` dan `is_verified=true`.
- Browser/PWA tidak menjamin GPS terus bekerja ketika dibekukan OS atau ditutup. Refactor ini tidak mengubah batasan platform tersebut.
- CSS Leaflet tetap diimpor. Ikon default di-resolve dari asset npm melalui Vite, bukan URL CDN eksternal. Instance peta tidak dibuat ulang setiap polling.

## Status Migrasi

Sudah TypeScript strict: entry point, router, navigasi, autentikasi/login, shared client dan komponen dasar, inbox/ruang chat/pesan, daftar dan detail pickup, timeline, peta pickup, ulasan, halaman dan filter peta utama, sinkronisasi GPS, pengelolaan produk, panel admin, halaman toko, kontainer dashboard, editor profil, pusat notifikasi, kategori, serta helper vendor/chat/ulasan/popup. Hook data peta, toko, orders, chat, produk, presence, profil, favorit, heatmap pesanan sendiri, notifikasi, dan admin menggunakan TanStack Query v5.

Seluruh kode produksi `src` sudah `.ts/.tsx`, termasuk tracking legacy, landing page, PWA, dan helper orders/pickup/network/favorites/routing/territory. JavaScript yang tersisa di `src` adalah tes lama, bukan implementasi aplikasi. Backend Express dan skrip tooling tetap JavaScript. Berkas yang digantikan sudah dihapus, bukan disimpan sebagai duplikat halaman lama.

### Gelombang Lanjutan 16 Oktober

- `DashboardScreen` kini memilih tab langsung dari URL yang diizinkan untuk role, tanpa effect penyalin state yang dapat menampilkan tab sebelumnya sesaat.
- Editor profil dipisahkan menjadi `ProfilePanel`, `useProfile`, `profile-api`, dan `profile-form`. Data server berasal dari query; draft hanya dibuat ketika pengguna memilih Edit. Refresh sesi atau realtime tidak mengisi ulang input. Batal membuang draft, bukan membuka editor lagi.
- Waktu promo pada input `datetime-local` menggunakan zona waktu perangkat, lalu dikonversi ke ISO saat disimpan. Nomor rekening dan e-wallet tetap string agar nol awal tidak hilang. Validasi nama, radius numeric(6,2), mobilitas, tanggal, dan berkas dilakukan sebelum upload atau penyimpanan.
- Favorit peta dan toko memakai cache pengguna yang sama. Penulisan memakai pasangan `buyer_id, vendor_id` asli; operasi ditata serial, diberi pengunci, dan kegagalan mengembalikan hanya vendor terkait tanpa membuang perubahan lain.
- Heatmap berisi pesanan toko milik pedagang yang login, bukan data seluruh pelanggan atau klaim keseluruhan permintaan pasar. Label menjadi Area pesanan dan query tetap difilter `vendor_id` serta dilindungi RLS.
- Komponen ringkasan permintaan lama yang tidak lagi diimpor dihapus. Visualisasi yang dipakai tetap berupa layer peta, tanpa menambah panel panjang.
- Keranjang dihitung dari stok dikurangi reservasi, harga katalog, dan kuantitas integer. Pergantian toko/akun membuat draft baru. Callback GPS yang terlambat setelah meninggalkan toko tidak memulai checkout lama; transaksi yang sudah dikirim ke database tidak dianggap bisa dibatalkan oleh browser.
- Callback lokasi profil setelah unmount tidak menyimpan lokasi. Kegagalan pemuatan profil ditampilkan sebagai error dengan retry, bukan spinner selamanya. Kegagalan katalog menahan checkout; kegagalan ulasan opsional mempertahankan cache tanpa menghalangi transaksi.

- Peta utama dipisahkan menjadi `MapViewPage`, `LeafletMap`, `VendorMarker`, `useVendorMarkers`, dan `map-model`. Marker diperbarui berdasarkan ID, bukan dibongkar pada setiap heartbeat. Popup dan viewport bertahan saat data disegarkan; vendor offline/kedaluwarsa tetap dihapus. `VendorProductsPreview` memakai query produk bersama.
- Pengubahan online/offline memakai `useVendorOperations`: status dikonfirmasi server, bukan disimulasikan sebagai berhasil. Token 401 diperbarui satu kali untuk operasi set status yang idempoten. `usePresenceClock` menjadwalkan kedaluwarsa marker; `last_seen_at` wajib tersedia seperti aturan RLS, bukan diganti timestamp JSON lokasi.
- Notifikasi memakai tabel `notifications` yang telah diuji pada hosted, termasuk `is_read` dan `read_at`. Badge berasal dari data belum dibaca, bukan hitungan selama satu sesi browser saja. Paginasi berdasarkan ID menghindari kehilangan baris dengan timestamp identik. Respons HTTP terlambat digabung dengan event realtime dan perubahan status baca lokal. Percakapan ditandai dibaca hanya jika sudah termuat dan benar-benar terlihat, termasuk pada tab dashboard; daftar chat atau ruang yang tersembunyi di HP tidak dianggap sedang dibaca. Membuka satu tracking tidak membisukan pesanan lain.
- Kesiapan channel dan kesiapan listener PostgreSQL berbeda. Sinkronisasi ulang berjalan ketika event `system` dengan `extension=postgres_changes` dan `status=ok` diterima, termasuk setelah tersambung kembali. Ini mengikuti [panduan troubleshooting resmi Supabase](https://supabase.com/docs/guides/troubleshooting/realtime-postgres-changes-troubleshooting). Polling tetap menjadi cadangan.

- Tracking legacy sekarang menerima `initialOrder` dari router dan memakai `useOrderDetails`/`useUpdateOrderStatus` yang sama dengan pickup. Tidak menggandakan subscription, polling, atau fetch detail. `LegacyTrackingMap` mempertahankan instance peta, marker, dan viewport; rute jalan berasal dari `useDrivingRoute`, dengan garis putus-putus yang jelas bila layanan rute gagal. GPS pribadi hanya dipantau pelanggan untuk pesanan aktif yang belum memiliki titik tersimpan, dan dihentikan setelah pesanan berakhir atau halaman tersembunyi.
- Pembentuk payload insert pesanan langsung dan helper keranjang/preset lama yang tidak dipakai dihapus. Checkout tetap melalui RPC resmi; stok tidak dipotong browser. Kontrak mutasi dan label legacy tetap tersedia untuk riwayat lama.
- Prompt PWA menangkap event instalasi sebelum role selesai dimuat, tetapi hanya ditampilkan kepada pedagang. Klik ganda dicegah, event instalasi yang sudah dipakai dibuang, dan storage browser yang dibatasi tidak membuat aplikasi crash.
- Endpoint backend production yang masih menunjuk localhost atau memakai HTTP dari halaman HTTPS ditolak dengan pesan konfigurasi yang jelas. Pengujian LAN development tetap didukung. Ikon menu/keluar memakai Lucide; SVG khusus pin kategori tetap dipertahankan sebagai asset Leaflet.
- Moderasi admin memakai mutation hook dan API bertipe. Penulisan membandingkan status sebelumnya sehingga perubahan admin lain tidak ditimpa diam-diam. Akun hanya tampil berhasil setelah baris dikonfirmasi database. Trigger SQL yang sudah ada menyembunyikan lokasi dalam statement pemblokiran/pencabutan verifikasi. Audit admin masih berupa insert terpisah sesuai skema asli; kegagalan audit ditampilkan jujur sebagai peringatan, bukan klaim transaksi audit atomik.
- Login pertama menunggu konfirmasi profil sebelum membuka halaman privat. Bootstrap yang gagal dapat dicoba ulang dan respons terlambat tidak menghidupkan kembali akun yang sudah logout. Pembatasan akun diterapkan segera dari hasil pemeriksaan database, tanpa menunggu penulisan profil yang tidak diperlukan. Refresh token akun yang sama tetap tidak membongkar halaman.
- Label Password pada login terhubung secara eksplisit ke input. Tombol tampilkan/sembunyikan memiliki nama aksesibel sendiri sehingga teks tombol tidak mengubah nama field password.
- Konteks pesanan di chat hanya menampilkan pesanan aktif. Shortcut bukti bayar mengikuti aksi pembayaran yang memang diizinkan untuk status pesanan. Gambar yang selesai dimuat menjaga caption tetap terlihat jika pembaca berada di bawah percakapan, tanpa menarik pengguna yang sedang membaca riwayat.
- Katalog toko, konfirmasi serah terima, dan kontrol moderasi dipisahkan menjadi `ProductList`, `HandoverModal`, dan `VendorVerification`. Ketiganya dipakai halaman produksi, bukan komponen contoh yang tidak terhubung.

Pengujian antarmuka autentikasi dan transaksi terhadap hosted sudah dijalankan menggunakan browser terisolasi. Gerbang rilis berikutnya adalah pemeriksaan deployment dan perangkat fisik. Backend unification tetap opsional: migrasi hardening yang berlaku mencabut penulisan langsung Storage dari role authenticated, sehingga Express tidak boleh dihapus tanpa rancangan otorisasi pengganti.

`strict: true` dan `allowJs: false` berlaku untuk seluruh kode produksi frontend. Tidak memakai `any`, `@ts-ignore`, atau `@ts-nocheck` untuk melewati pemeriksaan. `npm run build` juga menjalankan `tsc --noEmit`, sehingga build deployment tidak dapat melewati error tipe. Ini bukan klaim bahwa Express/tooling JavaScript diperiksa oleh TypeScript; keduanya mempunyai pemeriksaan sintaks/lint tersendiri.

Shared primitives tersedia untuk pemakaian bertahap. `HandoverModal` memakai dialog native yang dapat ditutup dengan Escape dan mengembalikan fokus ke tombol asal. Jumlah aksi konfirmasi tetap sama dengan sebelumnya: tombol progres utama lalu konfirmasi serah terima. Tidak ada PIN atau langkah konfirmasi COD terpisah; COD dan penyelesaian tetap satu RPC.

## Menjalankan Pemeriksaan

```powershell
npm ci
npm run typecheck
npm run check
```

`check` menjalankan ESLint JS/TS dan service worker, TypeScript, Vitest, parser delapan migrasi SQL beserta satu skrip verifikasi read-only, build Vite, dan pemeriksaan sintaks backend. `npm run dev` tetap digunakan untuk pengembangan frontend.

Playwright sudah menjadi dev dependency yang dikunci versinya. Setelah `npm ci`, pasang Chromium lalu jalankan seluruh gate tanpa menulis ke hosted:

```powershell
npx playwright install chromium
npm run check:release
```

Untuk menjalankan tes UI secara terpisah:

```powershell
# Isi hanya jika Playwright berada di luar node_modules proyek.
$env:PLAYWRIGHT_MODULE_PATH = 'PATH_ABSOLUT_KE_PACKAGE_PLAYWRIGHT'
node scripts/test-pickup-ui.mjs
npm run build
node scripts/test-public-ui.mjs
node scripts/test-pwa-ui.mjs
```

Kedua tes UI di atas tidak menghubungi production. Fixture mencakup 132 kombinasi layout pada HP/laptop, checkout, izin GPS, cleanup offline, pemulihan tracking pickup/legacy, progres COD, respons chat terlambat, pindah percakapan, Enter ganda, profil, favorit, keranjang antartoko, kestabilan marker/popup, race notifikasi, pergantian akun, transisi role PWA, dan moderasi admin beserta kegagalan audit. Tes public memeriksa bundle build, providers, landing/login, dan redirect route privat tanpa sesi. Output dan screenshot fixture berada di `test-results/`, tidak di-push.

Untuk meregenerasi tipe, siapkan PostgreSQL lokal kosong/disposable pada `127.0.0.1:55439`, database `postgres`, lalu jalankan `supabase/tests/local-bootstrap.sql` dan delapan migrasi sesuai urutan di atas. Bootstrap hanya untuk simulasi lokal, jangan dijalankan di hosted Supabase.

```powershell
$env:PSQL_PATH = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
node scripts/generate-database-types.mjs
npm run typecheck
```

Generator sengaja terkunci ke loopback/port lokal dan gagal bila menemukan tipe PostgreSQL yang belum dipetakan. Sesudah skema berubah, regenerasi tipe, jangan menebak nama kolom/RPC. Jangan mengedit hasil generasi secara manual.

Pada cluster lokal yang sama, tes transaksi dan race stok dapat dijalankan dengan `supabase/tests/pickup-cod-progress.sql` dan `scripts/test-pickup-concurrency.mjs`. `supabase/tests/admin-moderation.sql` memeriksa hak admin, penolakan pemalsuan audit oleh vendor, penghapusan presence saat diblokir/dicabut verifikasinya, serta bahwa aktivasi akun tidak otomatis membuat pedagang online. Ketiganya sudah dijalankan kembali setelah migrasi TypeScript. Tes SQL berjalan dalam transaksi rollback; tes concurrency membersihkan fixture miliknya. Regenerasi tipe dari katalog lokal menghasilkan berkas identik.

## Bukti Historis Refactor 16 Oktober

Hasil pemeriksaan terbaru: 219 tes dalam 30 berkas, 102 berkas produksi frontend TypeScript strict, 132 kombinasi layout/regresi UI beserta regresi Area Pesanan, halaman publik/redirect pada lebar 320/375/1366, service worker offline/reconnect nyata, serta transaksi COD, perebutan stok terakhir, dan moderasi/RLS pada PostgreSQL lokal lulus. Pemeriksaan bundle terbaru tidak menemukan service-role key. Audit npm frontend/backend melaporkan nol kerentanan pada sesi refactor; penambahan Playwright juga melaporkan nol kerentanan. Tidak ada migrasi skema production atau perubahan `.env` yang perlu diterapkan. `pickup-verification.sql` kini juga memeriksa RPC penyelesaian tanpa kode, grants, dan penutupan akses tabel kode; ini query read-only, bukan migrasi.

Pembaruan kesiapan rilis memperbaiki fallback offline yang sebelumnya bergantung pada HTML lama tanpa bundle lengkap. Service worker sekarang menyimpan halaman offline mandiri, bukan HTML privat; menolak cache aset error/HTML yang menyamar sebagai JavaScript, membatasi cache bundle, serta hanya membersihkan namespace cache Kelilingku. Registrasi melewati HTTP cache worker. Header Vercel dan workflow CI disiapkan, tetapi baru berlaku setelah commit/deploy. Hasil pemeriksaan deployment aktif dan langkah perangkat fisik ada di [release-readiness.md](release-readiness.md).

Dengan izin eksplisit pemilik project, pada 16 Oktober 2026 skrip `scripts/test-hosted-qa.mjs` menguji Supabase terhubung memakai tiga akun QA untuk API dan satu pelanggan baru untuk bootstrap browser. Tiga belas pemeriksaan API berhasil: auth dan bootstrap profil, trigger toko, pencegahan eskalasi role/verifikasi, RLS produk/order/chat/notifikasi, presence publik, kedua mode pengambilan, reservasi/pengurangan/pelepasan stok, penyelesaian COD idempoten tanpa kode, transfer manual tanpa uang sungguhan, stok opsional, penolakan stok berlebih, pesan dan identitas pelanggan, notifikasi otomatis, serta pengiriman pesan WebSocket setelah listener siap. Upload PNG nyata dan endpoint presence diuji melalui backend Express lokal yang terhubung ke hosted, bukan deployment Render.

Opsi `--browser-ui` menjalankan tambahan lima pemeriksaan melalui `scripts/hosted-browser-qa.mjs`, sehingga total 18 pemeriksaan berhasil. Dua konteks Chromium terisolasi (375 dan 1366 piksel) login lewat form asli, tanpa mock auth/data. Alur yang diuji: bootstrap pelanggan baru sebelum akses privat, checkout mobile dan progres pedagang, status pelanggan realtime tanpa reload, klik ganda penyelesaian hanya menghasilkan satu RPC, pesan dan notifikasi lintas role, foto dengan preview/caption sebelum upload, caption setelah gambar dimuat, kartu pesanan selesai tidak memenuhi chat, logout mobile menyembunyikan pedagang, dan pergantian akun membersihkan cache privat. GPS browser disimulasikan; tile peta/font pihak ketiga diblokir, jadi ini bukan pengujian GPS fisik atau ketersediaan provider peta.

Seluruh akun, baris terkait, chat, dan PNG QA dibersihkan; hasil akhir `cleaned=true`, tanpa warning. Run terakhir: `9979c848-f6c7-4f4d-af3a-070087b6bfa0`. Laporan dan jurnal ID berada di `test-results/hosted-qa-report.json` dan `test-results/hosted-qa-state.json` yang diabaikan Git. Tidak ada password atau token disimpan di jurnal. Skrip tidak boleh dijalankan pada project lain tanpa izin baru. Cleanup memeriksa penanda run dan kepemilikan akun/chat sebelum menghapus; bila terputus, gunakan jurnal yang sama untuk pemulihan.

```powershell
# Menulis data QA: jalankan hanya setelah mendapat izin pemilik project.
node scripts/test-hosted-qa.mjs --allow-hosted-writes --local-api
# Tambahkan uji dua konteks browser asli; memerlukan Playwright/Chromium.
node scripts/test-hosted-qa.mjs --allow-hosted-writes --local-api --browser-ui
# Pemulihan pembersihan jika proses sebelumnya terputus; gunakan environment project yang sama.
node scripts/test-hosted-qa.mjs --allow-hosted-writes --cleanup-only
```

Sebelum deploy, masih perlu UAT dua perangkat fisik: GPS perangkat nyata, perilaku PWA/background, email lupa password, sesi browser bergantian, moderasi lewat akun admin asli, dan pemeriksaan Vercel/Render yang telah memakai commit terbaru. Uji API hosted dan fixture browser bukan klaim bahwa semua jalur deployment atau perilaku perangkat fisik sudah terverifikasi.

Audit cakupan terhadap Tahap 0-3 ada di [refactor-completion-audit.md](refactor-completion-audit.md). Penerapan memerlukan commit/push yang disetujui pemilik dan verifikasi deployment untuk SHA tersebut; hasil lokal di atas tidak otomatis membuktikan versi online sudah diperbarui.
