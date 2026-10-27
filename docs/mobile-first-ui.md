# UI Mobile-First Kelilingku

## Status 28 Oktober 2026

Implementasi UI disiapkan untuk rilis setelah pemeriksaan ulang 28 Oktober.
Tidak ada migrasi database, perubahan environment, atau dependensi UI baru.
React 18, Router 7, TypeScript, Tailwind 4, Lucide, dan Leaflet tetap dipakai.
Status deployment harus dicocokkan dengan SHA commit dan pemeriksaan online,
bukan disimpulkan hanya dari build lokal.

## Keputusan Tampilan

- Pelanggan: peta paling awal, pencarian/kategori ringkas, daftar toko sederhana.
  Detail marker memakai bottom sheet di HP dan panel samping di laptop.
- Pedagang: status jualan dan kontrol operasional ringkas di atas peta. Area
  pesanan tetap opsional dan hanya berasal dari pesanan toko sendiri.
- Navigasi bawah mempunyai empat tujuan utama per peran. Profil pedagang tetap
  tersedia melalui avatar, sedangkan navigasi desktop menampilkannya langsung.
- Pesanan menonjolkan status, ringkasan, dan satu pintu progres utama. Riwayat
  serta aksi sekunder dibuka bila perlu; pembayaran dan aturan serah terima
  tidak diubah.
- Produk memakai kartu ringkas dengan aksi berlabel, bukan ikon tanpa nama.
  Profil menyembunyikan pengaturan sekunder dalam bagian yang dapat dibuka;
  isian draft tetap tersimpan selama bagian tersebut ditutup.
- Chat memakai ruang layar yang tersedia dan composer satu baris di atas
  navigasi bawah. Review foto/caption, sinkronisasi, dan histori tetap tersedia.
- Warna teal, permukaan lembut, ukuran input mobile 16 piksel, tombol utama
  minimal 44 piksel, safe-area bawah, serta preferensi reduced-motion diterapkan.
- Dialog native mengelola fokus dan Escape. Notifikasi masuk ke lapisan dialog
  yang sedang aktif agar tidak tertutup. Prompt PWA mengikuti ruang navigasi,
  termasuk pada tablet. Instance peta tidak dibuat ulang ketika filter,
  pilihan toko, atau data realtime diperbarui.
- Landing dan autentikasi dipersingkat. Login, ingat saya, konfirmasi password,
  lupa password, serta kirim ulang verifikasi tetap tersedia.

## Bukti Verifikasi Lokal

Seluruh gate lokal berikut kembali lulus pada 28 Oktober 2026.

`npm run check:release` lulus: lint, TypeScript strict, 208 tes pada 30 berkas,
validasi SQL, build produksi, sintaks backend, 132 skenario regresi UI, dan
45 kombinasi tampilan pada lebar 320/375/430/768/1366 piksel. Pemeriksaan baru
mencakup navigasi aktif, fokus dialog, lapisan notifikasi, draft profil, ukuran
editor, identitas instance peta, composer chat, dan posisi prompt PWA.

Smoke build produksi juga mencakup login/daftar/reset tanpa mengirim email.
Service worker nyata lulus uji install, offline deep link, isolasi cache privat,
dan reconnect. Screenshot simulasi tersedia lokal di `test-results/pickup/`.
Tile pihak ketiga sengaja diblokir pada pengujian browser, bukan bukti bahwa
tile production sedang bermasalah.

Pada 17 Oktober, `node scripts/test-hosted-qa.mjs --allow-hosted-writes --local-api --browser-ui`
lulus 22 pemeriksaan menggunakan frontend/API lokal dan Supabase terhubung,
tanpa mock autentikasi/database. Akun, pesanan, chat, serta unggahan QA telah
dibersihkan. Pengujian ini memakai izin pemilik sebelumnya, tanpa uang nyata,
tanpa migrasi, dan tanpa menyentuh transaksi pengguna lain.

Hasil lokal tersebut bukan bukti deployment UI terbaru atau UAT HP fisik.
Sesudah push/deploy, lakukan uji dua HP termasuk keyboard
virtual dan GPS asli. Penerimaan email reset di inbox dan moderasi oleh akun
admin resmi masih perlu diuji sesuai [checklist UAT](uat-perangkat.md).

## Keamanan Backend Saat Rilis

Audit 28 Oktober menemukan advisory baru pada dependensi backend. Baseline
Express tetap major 4, dinaikkan ke 4.22.3; override body-parser minimal 1.20.9
dan qs minimal 6.16.1 mengunci versi patch yang kompatibel. Rujukan:
[body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828) dan
[qs](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw).

Lockfile menghasilkan Express 4.22.3, body-parser 1.20.9 dan qs 6.17.0;
audit production frontend/backend melaporkan nol kerentanan. Smoke lokal
parser JSON/gzip, ketahanan request kompresi rusak, serta metadata health
API aktual lulus tanpa perubahan data Supabase.

Health check API mempertahankan `ok: true` dan menambahkan `release`, berisi
SHA 40 karakter yang valid dari `RENDER_GIT_COMMIT`, atau `null` di lokal.
Tidak menampilkan token, environment lain, atau data pengguna. Render mengisi
[variabel commit ini secara otomatis](https://render.com/docs/environment-variables),
sehingga tidak memerlukan perubahan environment manual.
