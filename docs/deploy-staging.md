# Deploy Staging Online

Untuk aplikasi ini, jalur paling aman adalah:

- frontend React/Vite ke Vercel
- backend Express ke Render
- database + auth + storage tetap di Supabase

Kombinasi ini cocok untuk testing 2 device karena:

- frontend dan backend akan dapat HTTPS
- geolocation di browser mobile akan bekerja karena origin aman
- link email auth dan redirect Supabase lebih mudah diatur

## Kenapa test LAN tadi bermasalah

Geolocation browser hanya tersedia di secure context seperti `https://` atau `localhost`. Origin seperti `http://192.168.x.x:5173` biasanya dianggap tidak aman, jadi akses lokasi ditolak oleh browser. MDN menjelaskan bahwa Geolocation hanya tersedia di secure contexts, sementara `localhost` termasuk origin yang dianggap tepercaya untuk development. Sumber: [MDN Geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation), [MDN Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

Error `fetch failed` pada toggle online biasanya muncul karena salah satu dari:

- backend `http://192.168.x.x:4000` tidak bisa dijangkau device lain
- firewall Windows memblokir port 4000
- browser/device membatasi request lintas-origin yang tidak aman

## Opsi yang saya sarankan

### Opsi 1: Staging online dulu

Ini yang paling saya sarankan sekarang.

Frontend:
- deploy ke Vercel
- file [vercel.json](/C:/xampp/htdocs/pedagang-keliling-react/vercel.json) sudah saya tambahkan untuk SPA rewrite

Backend:
- deploy ke Render
- file [render.yaml](/C:/xampp/htdocs/pedagang-keliling-react/render.yaml) sudah saya tambahkan untuk service Express

Supabase:
- tetap jadi auth, database, storage, realtime

### Opsi 2: Production langsung

Bisa, tapi saya tidak sarankan sebelum:

- signup customer/vendor sudah dites
- upload gambar sudah dites
- chat realtime sudah dites
- order dari pelanggan ke pedagang sudah dites
- update status order sudah dites
- toggle online pedagang sudah dites

## Langkah deploy frontend ke Vercel

1. Push repo ini ke GitHub.
2. Login ke Vercel.
3. Import repo.
4. Framework preset akan terdeteksi sebagai Vite.
5. Tambahkan environment variables:

```env
VITE_SUPABASE_URL=https://gjjjspwqxoctucghazoy.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_s2ZGAA5OGZTbENoYZ7rABQ_Hiob2HMH
VITE_SUPABASE_BUCKET=data
VITE_SERVER_URL=https://YOUR-RENDER-BACKEND.onrender.com
```

6. Deploy.

Catatan:
- Untuk SPA routing seperti `/chat/:id` dan `/vendor/:id`, file [vercel.json](/C:/xampp/htdocs/pedagang-keliling-react/vercel.json) sudah menangani rewrite ke `index.html`.

Referensi resmi: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)

## Langkah deploy backend ke Render

1. Login ke Render.
2. Buat `New > Web Service`.
3. Pilih repo GitHub yang sama.
4. Karena backend ada di folder `server`, pakai konfigurasi berikut:
   - Root Directory: `server`
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm run start`
5. Tambahkan environment variables:

```env
SUPABASE_URL=https://gjjjspwqxoctucghazoy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_BUCKET=data
PORT=10000
CORS_ORIGIN=https://YOUR-VERCEL-FRONTEND.vercel.app
MAX_UPLOAD_BYTES=5242880
```

Catatan:
- Di Render, `PORT` biasanya di-inject otomatis. Jika perlu, Anda bisa tetap simpan default; app ini sudah membaca `process.env.PORT`.
- Setelah frontend punya URL final, update `CORS_ORIGIN` di Render agar sesuai.

Referensi resmi:
- [Deploy a Node Express App on Render](https://render.com/docs/deploy-node-express-app)
- [Render Blueprint YAML](https://render.com/docs/blueprint-spec)
- [Render Monorepo Support](https://render.com/docs/monorepo-support)

## Update Supabase setelah deploy

Setelah frontend staging online sudah dapat URL, buka dashboard Supabase dan ubah:

1. `Authentication > URL Configuration`
2. `Site URL` ke URL frontend Vercel, misalnya:
   - `https://pedagang-keliling.vercel.app`
3. Tambahkan `Redirect URLs`:
   - `http://localhost:5173/**`
   - `https://YOUR-VERCEL-FRONTEND.vercel.app/**`

Referensi resmi:
- [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase redirectTo troubleshooting](https://supabase.com/docs/guides/troubleshooting/why-am-i-being-redirected-to-the-wrong-url-when-using-auth-redirectto-option-_vqIeO)

## Urutan testing yang saya sarankan

1. Deploy backend ke Render.
2. Masukkan URL backend Render ke env frontend Vercel.
3. Deploy frontend ke Vercel.
4. Update `CORS_ORIGIN` backend ke domain frontend final.
5. Update `Site URL` dan `Redirect URLs` di Supabase.
6. Test 2 akun di 2 device:
   - vendor login
   - customer login
   - customer lihat peta + lokasi
   - customer chat vendor
   - customer kirim order
   - vendor terima order
   - vendor ubah status online

## Rekomendasi akhir

Jangan langsung production penuh. Deploy `staging online` dulu sekarang. Setelah semua alur di atas lolos, baru domain final dan production.
