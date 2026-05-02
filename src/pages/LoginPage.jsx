import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ToastProvider'

const REMEMBER_EMAIL_KEY = 'kelilingku:remember-email'

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
  const location = useLocation()
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(REMEMBER_EMAIL_KEY) || ''
  })
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window === 'undefined') return false
    return Boolean(window.localStorage.getItem(REMEMBER_EMAIL_KEY))
  })
  const [role, setRole] = useState('customer')
  const [loading, setLoading] = useState(false)
  const [inlineMsg, setInlineMsg] = useState(null)
  const toast = useToast()
  const navigate = useNavigate()
  const emailRedirectTo = typeof window !== 'undefined' ? window.location.origin : undefined
  const resetRedirectTo = typeof window !== 'undefined' ? `${window.location.origin}/login?reset=password` : undefined

  const isLoginMode = mode === 'login'
  const isRegisterMode = mode === 'register'
  const isForgotMode = mode === 'forgot'
  const isUpdatePasswordMode = mode === 'update_password'

  const modeLabel = isLoginMode
    ? 'Login'
    : isRegisterMode
      ? 'Register'
      : isForgotMode
        ? 'Reset Password'
        : 'Password Baru'

  const modeTitle = isLoginMode
    ? 'Masuk ke akun Anda'
    : isRegisterMode
      ? 'Buat akun Kelilingku'
      : isForgotMode
        ? 'Lupa password?'
        : 'Buat password baru'

  const modeDescription = isLoginMode
    ? 'Gunakan email dan password yang sudah terdaftar.'
    : isRegisterMode
      ? 'Pilih peran yang sesuai agar tampilan aplikasi langsung menyesuaikan alur Anda.'
      : isForgotMode
        ? 'Masukkan email akun Anda. Kami kirim link reset dari Supabase.'
        : 'Masukkan password baru untuk akun Anda.'

  const primaryActionLabel = loading
    ? 'Memproses...'
    : isLoginMode
      ? 'Masuk Sekarang'
      : isRegisterMode
        ? 'Buat Akun'
        : isForgotMode
          ? 'Kirim Link Reset'
          : 'Simpan Password'

  const roleSummary = useMemo(
    () => ROLE_OPTIONS.find((item) => item.value === role) || ROLE_OPTIONS[0],
    [role]
  )

  function switchMode(nextMode) {
    setMode(nextMode)
    setInlineMsg(null)
    setConfirmPassword('')
    if (nextMode === 'forgot') {
      setPassword('')
      setShowPassword(false)
    }
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search)
    const hashParams = new URLSearchParams(String(location.hash || '').replace(/^#/, ''))
    const isRecoveryFlow = searchParams.get('reset') === 'password' || hashParams.get('type') === 'recovery'

    if (isRecoveryFlow) {
      setMode('update_password')
      setInlineMsg('Silakan buat password baru untuk akun Anda.')
    }
  }, [location.hash, location.search])

  function validatePasswordConfirmation() {
    if (password.length < 6) {
      const message = 'Password minimal 6 karakter.'
      toast.push(message, { type: 'error' })
      setInlineMsg(message)
      return false
    }

    if (password !== confirmPassword) {
      const message = 'Konfirmasi password belum sama.'
      toast.push(message, { type: 'error' })
      setInlineMsg(message)
      return false
    }

    return true
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setInlineMsg(null)
    setLoading(true)

    try {
      if (isForgotMode) {
        if (!email.trim()) {
          const message = 'Masukkan email akun Anda terlebih dahulu.'
          toast.push(message, { type: 'error' })
          setInlineMsg(message)
          return
        }

        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: resetRedirectTo,
        })

        if (error) throw error

        const message = 'Link reset password sudah dikirim. Cek email Anda.'
        toast.push(message, { type: 'success' })
        setInlineMsg(message)
        return
      }

      if (isUpdatePasswordMode) {
        if (!validatePasswordConfirmation()) return

        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error

        toast.push('Password berhasil diperbarui', { type: 'success' })
        setInlineMsg('Password berhasil diperbarui. Anda akan diarahkan ke aplikasi.')
        setPassword('')
        setConfirmPassword('')
        navigate('/', { replace: true })
        return
      }

      if (isRegisterMode) {
        if (!validatePasswordConfirmation()) return

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
      if (rememberMe && typeof window !== 'undefined') {
        window.localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim())
      } else if (typeof window !== 'undefined') {
        window.localStorage.removeItem(REMEMBER_EMAIL_KEY)
      }
      navigate('/')
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
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eff6ff_24%,#f8fafc_52%,#e2e8f0_100%)] px-3 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_460px]">
        <section className="hidden overflow-hidden rounded-[34px] border border-slate-200/80 bg-slate-950 text-white shadow-2xl shadow-slate-900/15 lg:block">
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
                {isLoginMode ? 'Masuk ke aplikasi' : isRegisterMode ? 'Buat akun baru' : 'Bantuan akun'}
              </div>
            </div>

            <div className="mt-10 max-w-2xl">
              <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
                {isLoginMode
                  ? 'Masuk untuk lanjut ke peta, pesanan, dan chat yang sudah berjalan.'
                  : isRegisterMode
                    ? 'Mulai sebagai pelanggan atau pedagang dengan alur yang dibedakan sejak awal.'
                    : 'Pulihkan akses akun dengan alur reset password yang aman.'}
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

            {isRegisterMode ? (
              <div className="mt-8 rounded-[28px] border border-white/10 bg-white/8 p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Peran yang dipilih</div>
                <div className="mt-3 text-2xl font-bold">{roleSummary.label}</div>
                <p className="mt-2 text-sm leading-7 text-slate-200">{roleSummary.description}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mx-auto w-full max-w-xl rounded-[24px] border border-slate-200/80 bg-white/92 p-4 shadow-xl shadow-slate-200/60 backdrop-blur sm:rounded-[34px] sm:p-8">
          <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-950 text-sm font-bold text-white">
                K
              </span>
              Kelilingku
            </Link>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 sm:tracking-[0.22em]">
                {modeLabel}
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                {modeTitle}
              </h2>
              <p className="mt-2 hidden text-sm leading-7 text-slate-600 sm:block">
                {modeDescription}
              </p>
            </div>

            <div className="grid grid-cols-2 rounded-full bg-slate-100 p-1 sm:inline-flex">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  isLoginMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Masuk
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  isRegisterMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Daftar
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3 sm:mt-8 sm:space-y-4">
            {isRegisterMode ? (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Nama lengkap</span>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white sm:text-base"
                  placeholder="Nama Anda atau nama toko"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
            ) : null}

            {!isUpdatePasswordMode ? (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white sm:text-base"
                  placeholder="nama@email.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                />
              </label>
            ) : null}

            {!isForgotMode ? (
              <>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {isUpdatePasswordMode ? 'Password baru' : 'Password'}
                  </span>
                  <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition focus-within:border-slate-400 focus-within:bg-white">
                    <input
                      className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-slate-900 outline-none sm:text-base"
                      placeholder="Minimal 6 karakter"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="shrink-0 px-4 text-sm font-medium text-slate-500 transition hover:text-slate-900"
                    >
                      {showPassword ? 'Sembunyi' : 'Lihat'}
                    </button>
                  </div>
                </label>

                {(isRegisterMode || isUpdatePasswordMode) ? (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Konfirmasi password</span>
                    <input
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white sm:text-base"
                      placeholder="Ulangi password"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            {isLoginMode ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Ingat saya
                </label>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-sm font-medium text-slate-500 underline-offset-4 transition hover:text-slate-900 hover:underline"
                >
                  Lupa password?
                </button>
              </div>
            ) : null}

            {isRegisterMode ? (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Pilih peran akun</div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  {ROLE_OPTIONS.map((option) => {
                    const active = role === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setRole(option.value)}
                        className={`min-w-0 rounded-2xl border p-3 text-left transition sm:rounded-[24px] sm:p-4 ${
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
                        <div className={`mt-2 line-clamp-2 text-xs leading-5 sm:line-clamp-none sm:text-sm sm:leading-6 ${active ? 'text-slate-200' : 'text-slate-600'}`}>
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
                ['berhasil', 'dikirim', 'diperbarui'].some((word) => inlineMsg.toLowerCase().includes(word))
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}>
                <span className="break-words">{inlineMsg}</span>
              </div>
            ) : null}

            <div className="grid gap-3 sm:flex sm:items-center">
              <button
                disabled={loading}
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {primaryActionLabel}
              </button>

              <button
                type="button"
                onClick={() => switchMode(isLoginMode ? 'register' : 'login')}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-5 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                {isLoginMode ? 'Daftar akun' : 'Masuk akun'}
              </button>

              {isLoginMode ? (
                <button
                  type="button"
                  onClick={handleResendVerification}
                  className="text-center text-sm font-medium text-slate-500 underline-offset-4 transition hover:text-slate-900 hover:underline sm:ml-auto"
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
