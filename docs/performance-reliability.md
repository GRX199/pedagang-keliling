# Performa Dan Keandalan

Status pekerjaan 17 Oktober 2026. Dokumen ini merupakan daftar penyelesaian,
bukan klaim bahwa seluruh pengujian sudah lulus.

## Persyaratan

1. Pesanan aktif terpisah dari riwayat; maksimal 20 kartu per halaman data.
   Riwayat hanya diminta ketika dibuka. Pencarian/filter berjalan di server
   dengan identitas pemilik, bukan hanya menyaring halaman yang sudah dimuat.
2. Chat membuka 40 pesan terbaru; pesan lama dimuat bertahap tanpa memindahkan
   posisi baca. Pesan masuk/kirim tetap muncul langsung dan sinkronisasi HTTP
   mengejar celah koneksi tanpa melewati pesan karena event realtime baru.
3. Status jaringan/realtime dan lokasi kedaluwarsa ditampilkan ringkas tanpa
   mengklaim selalu realtime atau menjanjikan GPS saat OS membekukan PWA.
4. Error production dicatat terstruktur dengan batas frekuensi dan tanpa
   token, password, isi percakapan, identitas pelanggan atau koordinat.
5. Gate otomatis mencakup pagination, timestamp yang sama, pergantian akun,
   pencarian, scroll chat, koneksi putus/pulih dan regresi transaksi.
6. Dokumen arsitektur, ERD/alur dan checklist UAT sesuai implementasi terbaru.
   UAT dua HP fisik, inbox reset password dan akun admin sah tetap membutuhkan
   pemilik. Simulasi browser tidak dinyatakan sebagai UAT fisik.

## Progres

- Pagination pesanan aktif/riwayat dan chat sudah terpasang. Uji fixture mencakup 65 order dengan timestamp sama, pencarian order di luar halaman pertama, 95 pesan lama, posisi scroll dan pemulihan 90 pesan terlewat setelah event realtime yang lebih baru.
- Indikator offline/terakhir diperbarui/fallback berkala menggantikan klaim Realtime tanpa konteks. Data lama dipertahankan; initial load offline memberikan arahan, bukan spinner tanpa penjelasan.
- Lokasi berusia lebih dari 120 detik diberi label kedaluwarsa. Sinkronisasi pedagang mencoba kembali saat online/foreground tanpa menjanjikan layanan background native.
- Mutasi tidak diantrekan offline atau diulang otomatis; request diberi deadline, tanpa menganggap timeout sebagai rollback.
- Pelaporan error best-effort dan log backend JSON sudah terpasang. Endpoint baru membutuhkan sesi valid, validasi allowlist dan rate limit. Tidak membutuhkan tabel/environment baru.
- Gate source terakhir lulus: 256 tes/37 berkas, lint, tipe, parser delapan migrasi dan verifikasi read-only, build, 132 layout beserta regresi pagination/offline, smoke publik 320/375/1366 dan PWA offline/reconnect nyata. Regresi tambahan membuktikan gagal memuat pesan lama tidak menghentikan sinkronisasi pesan baru atau menggeser posisi baca.
- Pengulangan source final terhadap Supabase asli lulus 22 pemeriksaan: run `a856dc41-3368-49cd-be0d-1dc5a37ab309`, `failure=null`, warning kosong dan `cleaned=true`. Termasuk UI recovery dan perubahan password akun QA asli: password lama ditolak dan login baru berhasil, tanpa mengirim email. Frontend/Express yang diuji adalah versi lokal; ini bukan verifikasi deployment baru atau UAT perangkat fisik.
- Audit production dependencies frontend/backend: nol kerentanan terlapor. Scan 18 bundle JavaScript akhir tidak menemukan service-role key.
- Tidak ada perubahan skema/environment/deployment. Data asli pengguna tidak diubah; data QA sementara dibuat hanya dengan izin pemilik dan dibersihkan.
- README/dokumen proposal pribadi yang sudah berubah sebelumnya tetap di luar pekerjaan ini.

## Diagnostik Operasional

`POST /client-errors` menerima `eventId` UUID v4, `area`, `category`, `source`.
Field tambahan tidak diteruskan ke log. Browser maksimal lima laporan per lima
menit dan satu signature area/source/kategori per menit; server membatasi sepuluh
request endpoint per lima menit per IP, selain limiter API yang sudah ada.
Tidak ada antrean disk/offline, retry laporan, atau kewajiban layanan berbayar.

Di Render Logs, cari event `client.error`, `upload.failed`, `presence.failed`,
atau `http.*.failed`. `requestId` pada respons/header dapat dipakai untuk
korelasi. Detail error mentah/stack tidak dikirim; untuk reproduksi tetap
butuh langkah dan versi aplikasi, tanpa data pribadi. Log platform di luar
aplikasi mengikuti kebijakan penyedia hosting, bukan dikendalikan reporter ini.

Frontend dan backend harus sama-sama di-deploy agar endpoint diagnostik tersedia.
Jika backend lama/offline, pelaporan boleh gagal tanpa menggagalkan transaksi.
Gangguan jaringan/Auth upstream menghasilkan 503 dengan `Retry-After`, bukan
401 yang keliru memaksa pengguna login ulang. Token tidak valid tetap 401 dan
akun dibatasi tetap 403; detail rahasia tidak dicatat atau dipantulkan.

## Bukti Dan Penerapan

Perintah gate utama `npm run check:release`. Uji terfokus tanpa data hosted:
`node scripts/test-pickup-ui.mjs --performance-only`. Laporan, screenshot dan
jurnal tetap di `test-results/` yang diabaikan Git. Tidak ada kredensial yang
boleh dimasukkan ke dokumentasi/commit.

Pengujian data nyata dengan izin eksplisit memakai
`node scripts/test-hosted-qa.mjs --allow-hosted-writes --local-api --browser-ui`.
Mode ini memakai frontend/Express lokal terhadap project Supabase terhubung,
bukan bukti deployment Render/Vercel. Setelah push/deploy disetujui, ulangi mode
`--deployed --browser-ui --diagnostics` dan cocokkan SHA CI/Vercel serta perubahan
backend. Flag `--diagnostics` memeriksa endpoint baru pada Render, bukan hanya
menyimpulkan deployment backend dari kelulusan frontend.

Pemilik telah menyetujui push ke `main` dan verifikasi online. Sebelum penerapan
diverifikasi, baseline online tetap `6c4caef`. Tidak perlu menjalankan SQL migration
baru. Pastikan `server/authentication.js` dan `server/diagnostics.js` ikut commit
bersama `server/app.js`.

## Dokumentasi Dan UAT

[Arsitektur dan alur transaksi](arsitektur-sistem.md) serta
[model data/ERD aktual](supabase-data-model.md) menggantikan deskripsi tabel
rencana lama yang belum pernah dibuat. Panduan [UAT perangkat](uat-perangkat.md)
menyediakan langkah dan form hasil untuk dua HP, GPS, reset password dan admin
sah. Jangan mengisi lulus berdasarkan simulasi browser.

## Batas Transaksi

Pertahankan RPC database asli, RLS per akun dan progres pickup tanpa PIN.
Tidak melakukan retry otomatis untuk pembuatan/penyelesaian transaksi yang
hasilnya belum pasti. COD serta stok tetap diselesaikan secara atomik oleh SQL.

## Audit Penyelesaian

| Persyaratan | Bukti saat ini | Status |
| --- | --- | --- |
| Pemuatan pesanan bertahap dan pencarian server | Unit batas/ownership/query, fixture 65 order bertimestamp sama, browser Supabase asli dengan join/filter/pencarian berkarakter khusus | Lulus lokal + hosted data |
| Chat terbaru/riwayat dan pemulihan celah | Fixture 95 pesan + 90 pesan terlewat, scroll, ganti percakapan, respon awal terlambat; chat/foto dua konteks browser asli | Lulus lokal + hosted data |
| Offline, deadline dan mutasi tidak mengantre | Unit cancellation/timeout/guard sebelum mutationFn, fixture draft/offline/reconnect dan fallback subscription | Lulus otomatis; GPS fisik belum |
| Log aman dan endpoint terproteksi | Unit allowlist/redaksi/throttle; API lokal auth, format, correlation ID terhadap sesi QA asli | Lulus; Render baru belum deploy |
| Dokumentasi skema/arsitektur/UAT | ERD sesuai FK SQL, alur tanpa PIN, kontrak data dan checklist perangkat diselaraskan | Tersedia; hasil UAT pemilik belum |
| Penerapan online | Baseline online `6c4caef`; push dan verifikasi baru sudah disetujui | Menunggu bukti deployment baru |

Jangan menandai seluruh pekerjaan rilis selesai sebelum deployment baru dan
bagian UAT yang memerlukan perangkat/inbox/akun resmi dibuktikan. Tidak ada
pengujian uang sungguhan atau pembuatan akun admin production untuk melewati izin.
