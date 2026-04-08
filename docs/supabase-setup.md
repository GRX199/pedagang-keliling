# Setup Supabase Dari Nol

Panduan ini cocok untuk codebase di folder ini setelah refactor terakhir.

## 1. Buat project baru

1. Buka dashboard Supabase dan buat project baru.
2. Tunggu sampai provisioning database selesai.
3. Simpan 3 nilai penting:
   - `Project URL`
   - `Publishable key` atau `anon key`
   - `service_role key`

## 2. Buat schema database

1. Buka `SQL Editor` di dashboard Supabase.
2. Buat query baru.
3. Paste seluruh isi file [schema.sql](/C:/xampp/htdocs/pedagang-keliling-react/supabase/schema.sql).
4. Jalankan query sampai selesai.

Schema itu sudah menyiapkan:
- tabel `vendors`
- tabel `products`
- tabel `chats`
- tabel `messages`
- tabel `orders`
- trigger untuk `updated_at`
- trigger auto-create row vendor saat signup dengan role vendor
- policy RLS untuk semua fitur utama
- realtime publication untuk `vendors`, `chats`, `messages`, dan `orders`

## 3. Buat storage bucket

1. Buka menu `Storage`.
2. Klik `New bucket`.
3. Buat bucket dengan nama `data`.
4. Set bucket menjadi `Public`.
5. Batasi file:
   - `Allowed MIME types`: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/gif`
   - `File size limit`: `5 MB`

Folder file akan dibuat otomatis oleh aplikasi dengan pola:
- `vendors/<user-id>/products/...`
- `vendors/<user-id>/profiles/...`

## 4. Atur Auth

1. Buka `Authentication`.
2. Pastikan provider Email aktif.
3. Untuk local development, set:
   - `Site URL`: `http://localhost:5173`
   - `Redirect URLs`: tambahkan `http://localhost:5173`
4. Jika nanti deploy ke domain asli, tambahkan domain produksi juga.

Catatan:
- Jika email confirmation tetap aktif, user harus verifikasi email sebelum login.
- Jika ingin testing cepat tanpa verifikasi email, nonaktifkan email confirmation sementara.

## 5. Isi file environment project

Frontend: isi file `.env.local`

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
VITE_SUPABASE_BUCKET=data
VITE_SERVER_URL=http://localhost:4000
```

Backend: isi file `server/.env`

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_BUCKET=data
PORT=4000
CORS_ORIGIN=http://localhost:5173
MAX_UPLOAD_BYTES=5242880
```

Jika frontend nanti diakses dari domain lain, ubah `CORS_ORIGIN` agar sesuai domain frontend Anda. Bisa juga dipisahkan dengan koma jika lebih dari satu origin.

## 6. Jalankan aplikasi

Frontend:

```powershell
npm run dev
```

Backend upload/status:

```powershell
cd server
npm run dev
```

## 7. Data test minimal

Lakukan test berikut:

1. Register akun `Pedagang`.
2. Login sebagai pedagang.
3. Isi profil toko dan tambah produk.
4. Set status toko jadi online dari halaman peta.
5. Register akun `Pelanggan`.
6. Login sebagai pelanggan.
7. Buka peta, pilih pedagang, kirim chat, lalu buat pesanan.
8. Login kembali sebagai pedagang dan cek chat + order masuk.

## 8. Catatan struktur data

`vendors.location` disimpan sebagai JSON agar ringan dan mudah dipakai frontend. Format yang disarankan:

```json
{
  "lat": -5.1477,
  "lng": 119.4327
}
```

Alternatif ini juga tetap didukung:

```json
{
  "latitude": -5.1477,
  "longitude": 119.4327
}
```

## 9. Jika signup vendor gagal membuat row toko

Schema sudah membuat trigger untuk auto-create vendor row berdasarkan metadata signup. Aplikasi juga masih punya fallback insert setelah register, jadi normalnya aman. Jika Anda mengubah flow signup nanti, pastikan metadata berikut tetap terkirim:

```json
{
  "full_name": "Nama Toko",
  "role": "vendor",
  "is_vendor": true
}
```
