# UAT Perangkat Dan Operasional

Disiapkan 17 Oktober 2026. Semua skenario fisik di bawah berstatus **belum
diverifikasi pemilik**. Pengujian otomatis/Chromium dengan GPS simulasi bukan
bukti GPS HP, penerimaan email, atau moderasi menggunakan akun admin sah.

## Persiapan

Gunakan website versi yang sudah dipastikan ter-deploy. Catat commit, model HP,
browser/PWA, jaringan, tanggal dan hasil aktual. Pakai akun uji milik sendiri,
produk berlabel uji dan tanpa pembayaran uang sungguhan. Jangan membagikan
password, token, alamat rumah atau foto bukti bayar pribadi dalam laporan.

## Dua Perangkat

1. HP A login pedagang dan HP B login pelanggan. Periksa navigasi sesuai role.
2. Online-kan pedagang dengan GPS diizinkan. Pelanggan melihat pin kategori;
   matikan online dan pastikan pin hilang. Coba izin GPS ditolak, lalu pulihkan.
3. Buat COD dari katalog. Terima, siapkan dan selesaikan melalui progres utama,
   tanpa PIN/konfirmasi COD terpisah. Bandingkan stok sebelum/sesudah: berkurang
   tepat kuantitas sekali, termasuk jika tombol ditekan cepat dua kali.
4. Coba kurir mandiri tanpa lokasi. Koordinasi tetap melalui patokan/chat;
   jangan membuat titik kurir palsu. Coba juga batal dan ditolak: reservasi lepas.
5. Coba QRIS/transfer dengan bukti gambar uji. Periksa preview/caption dahulu;
   belum boleh selesai sebelum pedagang mengonfirmasi pembayaran non-COD.
6. Kirim chat dua arah. Pesan tampil tanpa reload, nama partner benar, notifikasi
   diterima pihak lain. Pesanan selesai tidak menyisakan kartu tracking aktif.
7. Buka riwayat order, cari produk/nama lama, muat halaman selanjutnya. Buka pesan
   lama di chat: posisi baca tidak melompat. Tidak ada halaman melebar di HP.

## Koneksi Dan GPS

1. Putuskan koneksi HP pada halaman yang sudah termuat. Data terakhir tidak
   menghilang; indikator offline muncul tanpa popup bertumpuk.
2. Coba mengirim pesan atau progres saat offline. Jangan tampilkan sukses palsu
   atau mengirim antrean transaksi sendiri ketika jaringan pulih.
3. Putuskan koneksi penerima, kirim beberapa pesan dari perangkat lain, lalu
   sambungkan kembali. Semua pesan harus muncul berurutan, bukan hanya yang
   terakhir. Ulangi ketika tab penerima sempat di latar belakang.
4. Ketika koneksi terputus saat checkout/penyelesaian, periksa daftar/detail order
   sebelum mencoba ulang. Browser tidak bisa membuktikan transaksi server gagal
   hanya karena responsnya tidak diterima.
5. Biarkan GPS pedagang tidak memperbarui lebih dari dua menit. Jangan tampilkan
   seolah lokasi masih live. Pulihkan koneksi/foreground dan sinkronkan ulang.
6. Install PWA, coba offline lalu reconnect. Layar terkunci/background dapat
   menghentikan GPS; PWA bukan layanan lokasi Android yang berjalan permanen.

## Email Reset Dan Admin

UI recovery dan perubahan password akun QA sudah lulus pengujian otomatis
terhadap Supabase asli, termasuk penolakan password lama dan login password baru.
Tautan dibuat melalui API admin khusus akun QA tanpa mengirim email; hasil ini
tidak membuktikan pengiriman atau penerimaan inbox. Mode QA deployment juga
memeriksa redirect recovery aktual, bukan menggantinya dengan URL rekaan.

Pemilik email membuka Lupa Password, memeriksa inbox dan domain tautan, mengganti
password, lalu menguji login password baru dan penolakan password lama. Verifikasi
Site URL/redirect Supabase sesuai domain deployment, termasuk `/login?reset=password`.
Jangan mengirim email ke orang lain untuk pengujian.

Gunakan akun admin yang telah diberi hak secara resmi oleh pemilik project.
Verifikasi/cabut verifikasi toko QA, blokir/aktifkan akun QA, periksa marker dan
audit, lalu pulihkan kondisi uji. Jangan menaikkan role lewat browser atau
memakai service-role key untuk menyamar sebagai login admin.

## Form Hasil

| Skenario | Perangkat/browser | Commit | Hasil aktual | Bukti aman |
| --- | --- | --- | --- | --- |
| COD, stok, batal/ditolak | Belum diisi | Belum diisi | Belum diuji pemilik | - |
| Transfer dan foto chat | Belum diisi | Belum diisi | Belum diuji pemilik | - |
| GPS dan offline/reconnect | Belum diisi | Belum diisi | Belum diuji pemilik | - |
| Riwayat/pagination mobile | Belum diisi | Belum diisi | Belum diuji pemilik | - |
| Email reset password | Belum diisi | Belum diisi | Belum diuji pemilik | - |
| Admin resmi | Belum diisi | Belum diisi | Belum diuji pemilik | - |

Kirim langkah, hasil yang diharapkan dan hasil aktual jika gagal. Screenshot
harus menyamarkan data pribadi. Jangan mengisi Lulus tanpa menjalankan skenario.
