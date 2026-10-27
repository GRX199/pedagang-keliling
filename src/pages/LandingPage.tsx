import { ArrowRight, MapPin, ShoppingBag, Store, Check } from 'lucide-react'
import { Link } from 'react-router-dom'

const steps = [
  {
    icon: MapPin,
    title: 'Temukan di peta',
    text: 'Lihat pedagang yang sedang online di sekitar Anda.'
  },
  {
    icon: ShoppingBag,
    title: 'Pilih barang',
    text: 'Pesan dari katalog dan koordinasikan lewat chat.'
  },
  {
    icon: Check,
    title: 'Ambil saat siap',
    text: 'Ambil sendiri atau gunakan kurir pilihan Anda.'
  }
]

export default function LandingPage() {
  return (
    <div className="overflow-x-clip">
      <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-24">
        <div className="relative z-10 min-w-0">
          <p className="mb-5 flex items-center gap-2 text-sm font-semibold text-teal-800">
            <span
              className="h-2 w-2 rounded-full bg-teal-600"
              aria-hidden="true"
            />
            Pedagang sekitar, lebih dekat
          </p>
          <h1 className="max-w-xl text-[clamp(2.5rem,7vw,4.25rem)] font-bold leading-[1.08] tracking-[-0.045em] text-slate-900">
            Belanja dekat.
            <br />
            <span className="text-teal-700">Terhubung langsung.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Temukan pedagang keliling di peta, pilih barang, lalu ambil saat
            pesanan siap.
          </p>
          <Link
            to="/login"
            className="ui-primary mt-7 w-full gap-3 py-3.5 sm:w-auto sm:px-6"
          >
            Mulai Sekarang <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <p className="mt-4 text-sm text-slate-500">
            Untuk pelanggan dan pedagang keliling.
          </p>
          {import.meta.env.DEV && (
            <a
              href="/wireframe/index.html"
              className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-teal-800 underline underline-offset-4"
            >
              Coba rancangan alur pengambilan langsung atau melalui kurir
            </a>
          )}
        </div>

        <div
          className="relative hidden aspect-[1.1] overflow-hidden rounded-[36px] border border-teal-900/10 bg-[#e7efe5] sm:block"
          aria-label="Ilustrasi peta pedagang, bukan data lokasi langsung"
          role="img"
        >
          <div className="absolute inset-0 bg-[linear-gradient(35deg,transparent_46%,#fff_46%,#fff_52%,transparent_52%),linear-gradient(110deg,transparent_38%,#fff_38%,#fff_45%,transparent_45%)]" />
          <div className="absolute -left-12 top-12 h-24 w-[140%] -rotate-[24deg] rounded-full border-[10px] border-white bg-[#c9e4dc]" />
          <div className="absolute -bottom-12 right-4 h-60 w-32 rotate-[22deg] rounded-full bg-[#b9d9d4] ring-8 ring-white/70" />
          <div className="absolute left-6 top-6 rounded-full bg-white/95 px-3 py-2 text-xs font-semibold text-teal-900">
            Ilustrasi peta
          </div>
          <div className="absolute right-[18%] top-[24%] flex h-16 w-16 -rotate-6 items-center justify-center rounded-[22px] bg-teal-700 text-white shadow-lg shadow-teal-900/15">
            <Store aria-hidden="true" className="h-8 w-8" strokeWidth={1.6} />
          </div>
          <div className="absolute bottom-[34%] left-[20%] flex h-12 w-12 rotate-6 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 shadow-md">
            <ShoppingBag aria-hidden="true" className="h-6 w-6" />
          </div>
          <div className="absolute left-[48%] top-[47%] flex h-8 w-8 items-center justify-center rounded-full border-[6px] border-white bg-sky-600 shadow-md" />
          <div className="absolute inset-x-5 bottom-5 flex items-center gap-3 rounded-2xl border border-white bg-white/95 p-4 shadow-sm">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <MapPin aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-slate-900">
                Mulai dari sekitar Anda
              </span>
              <span className="text-sm text-slate-500">
                Sayur, makanan, kopi, dan lainnya.
              </span>
            </span>
          </div>
        </div>
      </section>

      <section
        id="cara-kerja"
        className="border-y border-teal-900/10 bg-white/75"
      >
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Sesederhana belanja di sekitar rumah.
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3 sm:gap-8">
            {steps.map(({ icon: Icon, title, text }, index) => (
              <div key={title} className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
                  <Icon
                    aria-hidden="true"
                    className="h-5 w-5"
                    strokeWidth={1.8}
                  />
                </span>
                <div>
                  <h3 className="font-semibold text-slate-900">
                    <span className="mr-1 text-teal-700">{index + 1}.</span>{' '}
                    {title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <footer className="px-5 py-5 text-center text-xs text-slate-500">
        Kelilingku · Belanja sekitar, langsung terhubung.
      </footer>
    </div>
  )
}
