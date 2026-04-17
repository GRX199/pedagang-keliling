import React, { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ToastProvider'

const ROLE_OPTIONS = [
  {
    value: 'customer',
    label: 'Pelanggan',
    description: 'Cari pedagang aktif, pilih menu, lalu lacak pesanan langsung dari peta.',
  },
  {
    value: 'vendor',
    label: 'Pedagang',
    description: 'Tampilkan toko di peta, terima order lebih awal, dan kelola transaksi sambil bergerak.',
  },
]

const LOGIN_POINTS = [
  'Peta menjadi halaman utama setelah login.',
  'Chat, pesanan, dan tracking tetap tersambung real-time.',
  'Tampilan pelanggan dan pedagang dibedakan agar alurnya tetap fokus.',
]

export default function LoginPage() {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('customer')
  const [loading, setLoading] = useState(false)
  const [inlineMsg, setInlineMsg] = useState(null)
  const toast = useToast()
  const navigate = useNavigate()
  const emailRedirectTo = typeof window !== 'undefined' ? window.location.origin : undefined

  const roleSummary = useMemo(
    () => ROLE_OPTIONS.find((item) => item.value === role) || ROLE_OPTIONS[0],
    [role]
  )

  async function handleSubmit(event) {
    event.preventDefault()
    setInlineMsg(null)
    setLoading(true)

    try {
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: name,
              role,
              is_vendor: role === 'vendor',
            },
            emailRedirectTo,
          },
        })

        if (error) {
          console.error('signUp error', error)
          toast.push(error.message || 'Gagal daftar', { type: 'error' })
          setInlineMsg(error.message || 'Gagal membuat akun baru')
          return
        }

        const uid = data?.user?.id
        if (role === 'vendor' && uid) {
          try {
            await supabase.from('vendors').insert([{ id: uid, user_id: uid, name: name || 'Pedagang' }])
          } catch (insertError) {
            console.warn('create vendor row failed', insertError)
          }
        }

        toast.push('Daftar berhasil. Cek email untuk verifikasi jika aktif pada project Anda.', { type: 'success' })
        setMode('login')
        setInlineMsg('Akun berhasil dibuat. Silakan login setelah verifikasi email jika fitur itu aktif.')
        return
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        toast.push(error.message || 'Gagal login', { type: 'error' })
        setInlineMsg(error.message || 'Gagal login')
        return
      }

      if (!data?.session) {
        const warning = 'Login berhasil tetapi sesi belum dibuat. Coba verifikasi email Anda lalu login kembali.'
        toast.push(warning, { type: 'error' })
        setInlineMsg(warning)
        return
      }

      toast.push('Login berhasil', { type: 'success' })
      navigate('/map')
    } catch (error) {
      console.error('auth unexpected error', error)
      toast.push(String(error.message || error), { type: 'error' })
      setInlineMsg(String(error.message || error))
    } finally {
      setLoading(false)
    }
  }

  async function handleResendVerification() {
    if (!email.trim()) {
      toast.push('Masukkan email Anda terlebih dahulu', { type: 'error' })
      return
    }

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: {
          emailRedirectTo,
        },
      })

      if (error) throw error
      toast.push('Email verifikasi berhasil dikirim ulang', { type: 'success' })
    } catch (error) {
      console.error('handleResendVerification', error)
      toast.push(error.message || 'Gagal mengirim ulang email verifikasi', { type: 'error' })
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eff6ff_24%,#f8fafc_52%,#e2e8f0_100%)] px-4 py-8 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_460px]">
        <section className="overflow-hidden rounded-[34px] border border-slate-200/80 bg-slate-950 text-white shadow-2xl shadow-slate-900/15">
          <div className="bg-[linear-gradient(135deg,#0f172a_0%,#172554_42%,#14532d_100%)] p-7 sm:p-9">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                to="/"
                className="inline-flex items-center gap-3 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/12"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-sm font-bold text-slate-950">
                  K
                </span>
                <span>Kembali ke Kelilingku</span>
              </Link>

              <div className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">
                {mode === 'login' ? 'Masuk ke aplikasi' : 'Buat akun baru'}
              </div>
            </div>

            <div className="mt-10 max-w-2xl">
              <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
                {mode === 'login'
                  ? 'Masuk untuk lanjut ke peta, pesanan, dan chat yang sudah berjalan.'
                  : 'Mulai sebagai pelanggan atau pedagang dengan alur yang dibedakan sejak awal.'}
              </h1>
              <p className="mt-5 text-base leading-8 text-slate-200">
                Kelilingku dirancang sebagai platform map-first untuk pedagang keliling. Karena itu halaman masuk ini
                sengaja dibuat sederhana, sementara peran pelanggan dan pedagang tetap dibedakan dengan lebih jelas.
              </p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {LOGIN_POINTS.map((point) => (
                <div key={point} className="rounded-[24px] bg-white/8 p-4 ring-1 ring-white/10">
                  <div className="text-sm leading-7 text-slate-100">{point}</div>
                </div>
              ))}
            </div>

            {mode === 'register' ? (
              <div className="mt-8 rounded-[28px] border border-white/10 bg-white/8 p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Peran yang dipilih</div>
                <div className="mt-3 text-2xl font-bold">{roleSummary.label}</div>
                <p className="mt-2 text-sm leading-7 text-slate-200">{roleSummary.description}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-[34px] border border-slate-200/80 bg-white/92 p-6 shadow-xl shadow-slate-200/60 backdrop-blur sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                {mode === 'login' ? 'Login' : 'Register'}
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
                {mode === 'login' ? 'Masuk ke akun Anda' : 'Buat akun Kelilingku'}
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                {mode === 'login'
                  ? 'Gunakan email dan password yang sudah terdaftar.'
                  : 'Pilih peran yang sesuai agar tampilan aplikasi langsung menyesuaikan alur Anda.'}
              </p>
            </div>

            <div className="inline-flex rounded-full bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Masuk
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Daftar
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {mode === 'register' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Nama lengkap</span>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                  placeholder="Nama Anda atau nama toko"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                placeholder="nama@email.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                placeholder="Minimal 6 karakter"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {mode === 'register' ? (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Pilih peran akun</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ROLE_OPTIONS.map((option) => {
                    const active = role === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setRole(option.value)}
                        className={`rounded-[24px] border p-4 text-left transition ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                            : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-base font-semibold">{option.label}</div>
                          <span className={`inline-flex h-5 w-5 rounded-full border ${
                            active ? 'border-white bg-white/20' : 'border-slate-300 bg-white'
                          }`} />
                        </div>
                        <div className={`mt-2 text-sm leading-6 ${active ? 'text-slate-200' : 'text-slate-600'}`}>
                          {option.description}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {inlineMsg ? (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${
                inlineMsg.toLowerCase().includes('berhasil')
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}>
                {inlineMsg}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                disabled={loading}
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {loading ? 'Memproses...' : mode === 'login' ? 'Masuk Sekarang' : 'Buat Akun'}
              </button>

              <button
                type="button"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-5 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                {mode === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?'}
              </button>

              {mode === 'login' ? (
                <button
                  type="button"
                  onClick={handleResendVerification}
                  className="text-sm font-medium text-slate-500 underline-offset-4 transition hover:text-slate-900 hover:underline sm:ml-auto"
                >
                  Kirim ulang verifikasi
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
