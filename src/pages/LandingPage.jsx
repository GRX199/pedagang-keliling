import React from 'react'
import { Link } from 'react-router-dom'

const categories = [
  'Sayur segar',
  'Bakso & mie',
  'Kopi keliling',
  'Roti & jajanan',
  'Gas & kebutuhan rumah',
  'Minuman dingin',
]

const customerPoints = [
  'Lihat pedagang yang benar-benar sedang online di sekitar Anda.',
  'Pesan dari menu yang tersedia sebelum pedagang sampai.',
  'Lacak status, chat, dan titik temu tanpa pindah ke banyak layar.',
]

const vendorPoints = [
  'Terima order lebih awal sambil tetap bergerak di area jualan.',
  'Ubah status toko dan sinkronkan lokasi otomatis saat online.',
  'Kelola produk, pesanan, dan komunikasi pelanggan dengan alur yang lebih rapi.',
]

const steps = [
  {
    title: 'Buka peta',
    body: 'Pelanggan melihat pedagang online yang aktif, dekat, dan sesuai kategori.',
  },
  {
    title: 'Pilih toko',
    body: 'Profil toko menampilkan deskripsi, produk, stok, jam operasional, dan area layanan.',
  },
  {
    title: 'Pesan lebih awal',
    body: 'Order dikirim ke pedagang beserta catatan dan titik temu untuk tindak lanjut di chat.',
  },
  {
    title: 'Lacak sampai selesai',
    body: 'Status pesanan dan pergerakan pedagang dipantau secara realtime sampai transaksi selesai.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eff6ff_24%,#f8fafc_52%,#e2e8f0_100%)]">
      <section className="border-b border-slate-200/80">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-[minmax(0,1.1fr)_420px] lg:items-center lg:py-20">
          <div>
            <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
              Map-First Commerce Untuk Pedagang Keliling
            </div>

            <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Pedagang keliling terlihat real-time, pelanggan bisa pesan sebelum pedagang tiba.
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              Kelilingku membantu pelanggan menemukan pedagang yang sedang online di sekitar mereka, lalu
              melanjutkan transaksi dari peta ke chat, checkout, dan tracking dalam satu alur yang lebih rapi.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800"
              >
                Masuk atau Daftar
              </Link>
              <a
                href="#cara-kerja"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Lihat Cara Kerja
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-2">
              {categories.map((category, index) => (
                <span
                  key={category}
                  className={`rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm ${
                    index >= 3 ? 'hidden sm:inline-flex' : ''
                  }`}
                >
                  {category}
                </span>
              ))}
            </div>
          </div>

          <div className="relative hidden lg:block">
            <div className="absolute -left-6 top-6 hidden h-36 w-36 rounded-full bg-emerald-200/50 blur-3xl lg:block" />
            <div className="absolute -bottom-4 right-0 hidden h-40 w-40 rounded-full bg-sky-200/50 blur-3xl lg:block" />

            <div className="relative overflow-hidden rounded-[34px] border border-slate-200/80 bg-slate-950 p-5 text-white shadow-2xl shadow-slate-900/20">
              <div className="rounded-[28px] bg-[linear-gradient(135deg,#0f172a_0%,#0f766e_55%,#022c22_100%)] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-emerald-100/80">Peta Utama</div>
                    <div className="mt-2 text-2xl font-semibold">Pedagang online sekitar</div>
                  </div>
                  <div className="rounded-full bg-white/12 px-3 py-1 text-xs font-medium text-emerald-50">
                    Realtime aktif
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-200">Online</div>
                    <div className="mt-2 text-3xl font-semibold">18</div>
                    <div className="mt-1 text-sm text-slate-200/80">Pedagang siap melayani</div>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-200">Radius dekat</div>
                    <div className="mt-2 text-3xl font-semibold">7</div>
                    <div className="mt-1 text-sm text-slate-200/80">Cocok untuk pesanan cepat</div>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-200">Tracking</div>
                    <div className="mt-2 text-3xl font-semibold">Live</div>
                    <div className="mt-1 text-sm text-slate-200/80">Status dan rute terhubung</div>
                  </div>
                </div>

                <div className="mt-5 rounded-[28px] border border-white/10 bg-slate-950/40 p-4 backdrop-blur">
                  <div className="grid gap-3">
                    <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">Bakso Mas Ridho</div>
                          <div className="mt-1 text-xs text-slate-300">Bakso & mie • 320 m • ETA 4 menit</div>
                        </div>
                        <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-medium text-emerald-100">
                          Online
                        </span>
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">Sayur Bu Ani</div>
                          <div className="mt-1 text-xs text-slate-300">Sayur segar • 540 m • COD / Titik temu</div>
                        </div>
                        <span className="rounded-full bg-sky-400/20 px-3 py-1 text-xs font-medium text-sky-100">
                          Pesan dulu
                        </span>
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">Kopi Sore Keliling</div>
                          <div className="mt-1 text-xs text-slate-300">Kopi keliling • 1,1 km • Tracking aktif</div>
                        </div>
                        <span className="rounded-full bg-amber-400/20 px-3 py-1 text-xs font-medium text-amber-100">
                          Dalam perjalanan
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[30px] border border-slate-200/80 bg-white/85 p-6 shadow-sm backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Untuk Pelanggan</div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Lebih cepat tahu siapa yang benar-benar dekat</h2>
            <div className="mt-5 space-y-3">
              {customerPoints.map((point) => (
                <div key={point} className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-4">
                  <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">✓</span>
                  <p className="text-sm leading-7 text-slate-600">{point}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-slate-200/80 bg-slate-950 p-6 text-white shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Untuk Pedagang</div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">Bukan sekadar tampil di katalog, tapi siap menerima order saat bergerak</h2>
            <div className="mt-5 space-y-3">
              {vendorPoints.map((point) => (
                <div key={point} className="flex items-start gap-3 rounded-2xl bg-white/6 px-4 py-4 ring-1 ring-white/8">
                  <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-950">✓</span>
                  <p className="text-sm leading-7 text-slate-200">{point}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="cara-kerja" className="border-y border-slate-200/80 bg-white/70">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Cara Kerja</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Alur yang singkat, tapi tetap realistis untuk transaksi pedagang keliling</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              Kami menjaga pengalaman tetap sederhana: peta sebagai pintu masuk, toko sebagai tempat memilih menu, lalu order, chat,
              dan tracking berjalan sebagai satu rangkaian.
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-4">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-sm font-bold text-white">
                  {index + 1}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="overflow-hidden rounded-[36px] border border-slate-200/80 bg-[linear-gradient(135deg,#0f172a_0%,#172554_35%,#14532d_100%)] p-7 text-white shadow-xl shadow-slate-900/10 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Siap Mulai</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
                Masuk sebagai pelanggan untuk cari pedagang, atau daftar sebagai pedagang untuk mulai menerima order.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-200">
                Landing page ini sengaja dibuat ringkas. Fokus utamanya tetap mendorong pengguna menuju alur produk yang sebenarnya:
                peta, toko, pesanan, chat, dan tracking.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
              >
                Login / Daftar
              </Link>
              <a
                href="#cara-kerja"
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-white/15"
              >
                Pelajari Alur
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
