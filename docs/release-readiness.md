# Pemeriksaan Rilis Kelilingku

Status 17 Oktober: rilis kode `168814e` lulus CI, smoke publik 320/375/1366
dan 22 pemeriksaan pada frontend Vercel/API Render/Supabase nyata; seluruh data
QA dibersihkan. Endpoint diagnostik baru serta UI recovery/password QA sudah
diverifikasi online. Lihat [bukti rilis](performance-reliability.md). UAT HP
fisik/inbox/admin sah masih manual. Bagian baseline lama di bawah bersifat
historis, bukan daftar error yang masih aktif atau bukti UAT fisik terbaru.

Diperbarui 16 Oktober 2026. Dokumen ini memisahkan baseline sebelum rilis, gate lokal dan UAT yang masih perlu dilakukan. Refactor ini tidak memerlukan perubahan environment atau migrasi database production. Status penerapan harus dicocokkan dengan SHA commit dan hasil deployment, bukan hanya build lokal.

## Yang Diselesaikan

- Fallback PWA tidak lagi memuat HTML aplikasi lama yang bisa kehilangan bundle saat offline. Halaman offline mandiri menampilkan status koneksi dan tombol Coba lagi; URL tujuan dipertahankan.
- Service worker tidak menyimpan navigasi privat, request berotorisasi, POST, URL aset dengan query, error HTTP atau HTML yang salah dikirim sebagai JavaScript. Cache bundle dibatasi 64 entri; cache aplikasi lain tidak dihapus.
- Worker terdaftar dengan `updateViaCache: none`. Konfigurasi Vercel menyediakan revalidasi worker/manifest/offline HTML dan header keamanan dasar, tanpa mematikan geolokasi same-origin. Perubahan header belum berlaku pada deployment lama.
- `npm run check:release` menjalankan lint, tipe, 219 tes, delapan migrasi SQL dan verifikasi read-only, build, sintaks backend, 132 kombinasi UI beserta regresi Area Pesanan, smoke publik serta uji offline/reconnect service worker nyata.
- `.github/workflows/quality.yml` menjalankan gate dan audit dependensi pada push main, pull request atau pemicu manual. Token GitHub hanya `contents: read`; environment Supabase adalah placeholder. Tidak menjalankan pengujian hosted, mengunggah artefak privat atau melakukan deployment.
- Playwright 1.62.1 dikunci sebagai dev dependency agar tes browser tidak bergantung pada runtime editor. Dependensi inti React 18/Router 7/Tailwind 4 dipertahankan. Render menggunakan `npm ci` sesuai lockfile.
- Panduan instalasi diselaraskan: delapan migrasi, tanpa PIN, COD melalui progres utama. `pickup-verification.sql` memeriksa RPC penyelesaian/grants/akses kode; seluruh boolean dan publication lulus pada cluster lokal yang kemudian dihentikan.

## Baseline Deployment Sebelum Rilis

Rilis refactor `539685d` kemudian berhasil dipush dan diterapkan; CI serta 18 pemeriksaan pada Vercel/Render/Supabase asli lulus dengan cleanup QA berhasil. Rincian baseline di tabel berikut adalah hasil sebelum rilis tersebut, bukan status gangguan saat ini. UAT perangkat fisik tetap belum digantikan oleh pengujian browser.

Target yang dikonfirmasi pemilik: [frontend Vercel](https://pedagang-keliling.vercel.app/). Backend ditemukan dari origin publik bundle: [API Render](https://pedagang-keliling-api.onrender.com/).

| Pemeriksaan baca-saja | Hasil 16 Oktober 2026 |
| --- | --- |
| Frontend `/`, `/login`, URL detail order langsung | HTTP 200 HTML; SPA rewrite tersedia. Tidak login atau membuka data order sungguhan. |
| Entry JavaScript yang dipublikasikan | `/assets/index-mEuIEQc9.js`, berbeda dari build lokal terbaru; origin Supabase/Render sesuai project. |
| Worker | Masih `kelilingku-shell-v1`, bukan worker baru di direktori lokal. |
| `/offline.html` | HTTP 200 tetapi isinya fallback SPA, bukan halaman offline mandiri. Status 200 saja tidak membuktikan file tersedia. |
| Header frontend | `nosniff` dan Permissions-Policy baru belum terlihat pada respons. |
| Smoke browser publik | Belum lulus: input password ada, tetapi nama label terbaca `PasswordLihat`, bukan `Password`; tombol Lihat masih menyatu dengan label. Ini masalah aksesibilitas build lama, bukan bukti login biasa gagal. Kode lokal dengan perbaikan label lulus pada 320/375/1366. |
| Health Render | GET `/` HTTP 200, JSON `ok: true`; tanpa token. |
| CORS Render | Origin Vercel diizinkan tepat; OPTIONS `/upload-only` mengizinkan POST dan header authorization/content-type. Tidak melakukan upload. |
| Provider rute/tile | Satu contoh rute OSRM mengembalikan `Ok`, satu tile OSM mengembalikan PNG HTTP 200. Ini bukan jaminan uptime atau GPS perangkat. |

Pemeriksaan deployment di atas hanya GET/OPTIONS dan browser publik tanpa sesi. Tidak mengirim email, checkout, chat, pembayaran, upload atau perubahan data. Tidak perlu membersihkan data baru karena tahap ini tidak membuat fixture hosted.

## Menjalankan Gate Lokal

```powershell
npm ci
npx playwright install chromium
npm run check:release
```

Pada runner Linux CI, instalasi browser memakai `npx playwright install --with-deps chromium`. Workflow telah diperiksa lokal; kelulusan GitHub harus diperiksa untuk SHA yang dirilis setelah push. Status CI tidak otomatis memblokir Vercel/Render; atur required checks/aturan branch sesuai kebijakan repository jika ingin menjadikannya syarat merge/rilis.

Untuk memeriksa frontend yang telah dipublikasikan:

```powershell
node scripts/test-public-ui.mjs --url https://pedagang-keliling.vercel.app/
```

Perintah ini tidak login dan memblokir request lintas origin. Tes service worker lokal terpisah memakai `npm run test:ui:pwa`. Jika konten offline/precache diubah lagi, perbarui versi worker dan ulangi tes; jangan mengandalkan cache lama.

## Area Pesanan Pedagang

Fitur ini memetakan pesanan toko milik akun pedagang, bukan lokasi semua pelanggan di platform. Default periode 14 hari dapat kosong jika riwayat lebih lama; ini sebelumnya membuat tombol tidak aktif tanpa penjelasan. Sekarang pilih Area pesanan, lalu 14 hari, 30 hari, atau Semua periode. Aktivasi/pergantian periode memfokuskan peta sekali ke area yang dipilih. Polling latar belakang mempertahankan layer dan viewport; data kosong atau gagal dimuat ditampilkan jelas.

Semua sel area dalam hasil terpilih digambar, bukan hanya lima terbesar. Query dibatasi maksimal 1.000 pesanan terbaru milik toko dengan penanda jika hasil terpotong. Pesanan aktif yang belum selesai tetap dipertahankan walaupun lebih lama dari periode. Pesanan tanpa koordinat, termasuk kurir mandiri tanpa GPS, tidak diberi titik buatan. Tidak ada migrasi atau perubahan lokasi/data pesanan production untuk perbaikan ini.

## Pengujian Hosted

Pengujian transaksi pada deployment nyata, hanya dengan izin eksplisit pemilik:

```powershell
node scripts/test-hosted-qa.mjs --allow-hosted-writes --deployed --browser-ui
```

Mode deployed hanya memakai dua origin yang disetujui di atas. Sebelum membuat akun, skrip memeriksa project Supabase/backend pada bundle, worker terbaru, serta health/CORS API. Akun dan transaksi bertanda QA dibersihkan; bila ada interaksi dari akun non-QA, toko QA di-offline-kan dan cleanup berhenti untuk pemeriksaan manual, bukan menghapus data pihak lain. Jurnal/report tetap lokal. Jangan menjalankan pengujian ini otomatis di CI atau pada project lain tanpa izin baru.

## Urutan Penerapan

1. Tinjau perubahan refactor beserta file TS baru sebelum commit/push yang disetujui pemilik. Jangan ikutkan `.env`, `test-results/`, proposal/seminar pribadi, atau isi `.codegraph` yang tidak diperlukan. Wireframe dan revisi proposal tetap lokal; tautan wireframe hanya muncul pada development.
2. Jalankan gate lokal, lalu pastikan workflow GitHub lulus setelah push. Untuk backend Render, pastikan root `server`, build `npm ci`, start `npm run start`, health `/`. Jika layanan dibuat manual, cocokkan dashboard dengan `render.yaml`; file YAML saja belum tentu mengubah layanan manual.
3. Frontend Vercel tetap Vite, root repository, build `npm run build`, output `dist`. Pastikan environment Vercel memakai URL Supabase terhubung, publishable key, bucket, dan `VITE_SERVER_URL=https://pedagang-keliling-api.onrender.com`, bukan localhost. Service-role key hanya di Render.
4. Tidak perlu migrasi tambahan untuk perubahan TypeScript/PWA ini. Jika memeriksa instalasi database, gunakan `pickup-verification.sql` yang read-only; jangan jalankan ulang migrasi lama atau fixture `supabase/tests` pada hosted.
5. Verifikasi konfigurasi Auth Supabase: Site URL domain Vercel dan redirect URL untuk domain tersebut, termasuk alur `/login?reset=password`. Pengaturan dashboard serta pengiriman email belum diverifikasi oleh smoke anonim.
6. Setelah deployment selesai, buka ulang browser/PWA. Periksa `/sw.js` sudah baru, `/offline.html` berisi halaman offline, header sudah aktif, dan ulangi smoke frontend. Bila tab lama masih menggunakan versi lama, tutup lalu buka ulang; jangan menghapus seluruh storage karena akan membuang sesi.
7. Lanjutkan UAT fisik di bawah sebelum menyatakan production terbaru terverifikasi.

## UAT Yang Masih Manual

| Skenario | Hasil yang harus dibuktikan |
| --- | --- |
| Pelanggan dan pedagang pada dua HP | Role/nav tepat; vendor online muncul setelah GPS dan hilang saat offline atau presence kedaluwarsa. |
| GPS diizinkan/ditolak/sinyal lemah | Tidak crash, tidak membuat pin palsu, dan pengambilan tetap dapat dikoordinasikan. Kurir tidak wajib mengisi GPS. |
| COD dari peta sampai selesai | Terima, siap, serah terima melalui progres utama tanpa PIN/konfirmasi COD terpisah; stok berkurang satu kali. |
| Transfer/QRIS/e-wallet | Detail pedagang terlihat; bukti dapat dikirim lewat chat; pedagang memeriksa pembayaran sebelum penyelesaian non-COD. Tanpa uang sungguhan untuk QA. |
| Chat/foto/notifikasi | Pesan muncul tanpa reload, nama partner benar, foto ditinjau sebelum kirim, preview hilang setelah sukses; order selesai tidak memenuhi chat. |
| Install PWA dan jaringan putus/pulih | Offline menampilkan informasi jujur; Coba lagi pulih ke alur yang diminta. OS dapat membekukan browser; instalasi PWA bukan jaminan GPS background. |
| Lupa password | Pemilik email menerima link pada domain yang benar, dapat mengganti password, dan password lama tidak lagi dipakai login. Jangan menguji menggunakan inbox orang lain. |
| Admin sah | Login menggunakan akun admin yang sudah diberi hak secara resmi; moderasi dan audit sesuai kebijakan. Jangan membuat admin dari browser atau menaikkan role untuk melewati RLS. |

Catat perangkat, browser, tanggal, langkah dan hasil aktual. Jangan menulis simulasi browser sebagai UAT pengguna fisik.

## Referensi Implementasi

[Lifecycle dan cache service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [waitUntil](https://developer.mozilla.org/en-US/docs/Web/API/ExtendableEvent/waitUntil), [Cache-Control Vercel](https://vercel.com/docs/caching/cache-control-headers), dan [CI Playwright](https://playwright.dev/docs/ci-intro) digunakan untuk pemeriksaan implementasi. Hasil aplikasi di atas berasal dari tes lokal/HTTP pada sesi ini, bukan dari dokumentasi vendor.
