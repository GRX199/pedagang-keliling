import React, { useEffect, useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage } from '../../shared/lib/utils'
import { reportError } from '../../shared/lib/error-reporting'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  setRememberSessionPreference,
  supabase
} from '../../shared/lib/supabase'
import { useToast } from '../../shared/components/ToastProvider'
import { MapPin, Store, ArrowRight } from 'lucide-react'

const REMEMBER_EMAIL_KEY = 'kelilingku:remember-email'

const ROLE_OPTIONS = [
  {
    value: 'customer',
    label: 'Pelanggan',
    description:
      'Cari pedagang aktif, pilih menu, lalu lacak pesanan langsung dari peta.'
  },
  {
    value: 'vendor',
    label: 'Pedagang',
    description:
      'Tampilkan toko di peta, terima order lebih awal, dan kelola transaksi sambil bergerak.'
  }
]

export default function LoginPage() {
  const location = useLocation()
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(REMEMBER_EMAIL_KEY) || ''
  })
  const passwordId = useId()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window === 'undefined') return false
    return Boolean(window.localStorage.getItem(REMEMBER_EMAIL_KEY))
  })
  const [role, setRole] = useState('customer')
  const [loading, setLoading] = useState(false)
  const [inlineMsg, setInlineMsg] = useState<string | null>(null)
  const toast = useToast()
  const navigate = useNavigate()
  const emailRedirectTo =
    typeof window !== 'undefined' ? window.location.origin : undefined
  const resetRedirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}/login?reset=password`
      : undefined

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
        ? 'Masukkan email akun Anda untuk menerima tautan reset password.'
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

  function switchMode(nextMode: string) {
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
    const hashParams = new URLSearchParams(
      String(location.hash || '').replace(/^#/, '')
    )
    const isRecoveryFlow =
      searchParams.get('reset') === 'password' ||
      hashParams.get('type') === 'recovery'

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: resetRedirectTo
          }
        )

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
        setInlineMsg(
          'Password berhasil diperbarui. Anda akan diarahkan ke aplikasi.'
        )
        setPassword('')
        setConfirmPassword('')
        navigate('/', { replace: true })
        return
      }

      if (isRegisterMode) {
        if (!validatePasswordConfirmation()) return

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: name,
              role,
              is_vendor: role === 'vendor'
            },
            emailRedirectTo
          }
        })

        if (error) {
          void reportError(error, 'auth')
          toast.push(error.message || 'Gagal daftar', { type: 'error' })
          setInlineMsg(error.message || 'Gagal membuat akun baru')
          return
        }

        toast.push(
          'Daftar berhasil. Cek email untuk verifikasi jika aktif pada project Anda.',
          {
            type: 'success'
          }
        )
        setMode('login')
        setInlineMsg(
          'Akun berhasil dibuat. Silakan login setelah verifikasi email jika fitur itu aktif.'
        )
        return
      }

      setRememberSessionPreference(rememberMe)
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      if (error) {
        toast.push(error.message || 'Gagal login', { type: 'error' })
        setInlineMsg(error.message || 'Gagal login')
        return
      }

      if (!data?.session) {
        const warning =
          'Login berhasil tetapi sesi belum dibuat. Coba verifikasi email Anda lalu login kembali.'
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
      void reportError(error, 'auth')
      toast.push(errorMessage(error), { type: 'error' })
      setInlineMsg(errorMessage(error))
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
          emailRedirectTo
        }
      })

      if (error) throw error
      toast.push('Email verifikasi berhasil dikirim ulang', { type: 'success' })
    } catch (error) {
      void reportError(error, 'auth')
      toast.push(errorMessage(error, 'Gagal mengirim ulang email verifikasi'), {
        type: 'error'
      })
    }
  }

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-10 lg:py-16">
      <div className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="hidden max-w-md lg:block">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-100 text-teal-800">
            <MapPin aria-hidden="true" className="h-7 w-7" />
          </div>
          <p className="text-4xl font-bold leading-tight tracking-tight text-slate-900">
            Yang dekat,
            <br />
            <span className="text-teal-700">jadi lebih mudah.</span>
          </p>
          <p className="mt-5 text-base leading-7 text-slate-500">
            Temukan pedagang sekitar. Pesan barang, lalu koordinasikan
            pengambilan di satu tempat.
          </p>
          {isRegisterMode && (
            <p className="mt-6 flex items-start gap-3 rounded-2xl bg-white p-4 text-sm text-slate-600">
              <Store
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-teal-700"
              />
              <span>
                <strong className="block text-slate-900">
                  {roleSummary.label}
                </strong>
                {roleSummary.description}
              </span>
            </p>
          )}
        </section>

        <section className="ui-surface mx-auto w-full max-w-lg p-5 sm:p-8">
          <div className="flex flex-col gap-5">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
                {modeLabel}
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {modeTitle}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {modeDescription}
              </p>
            </div>

            {(isLoginMode || isRegisterMode) && (
              <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  aria-pressed={isLoginMode}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    isLoginMode
                      ? 'bg-white text-teal-800 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Masuk
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  aria-pressed={isRegisterMode}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    isRegisterMode
                      ? 'bg-white text-teal-800 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Daftar
                </button>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="mt-5 space-y-3 sm:mt-8 sm:space-y-4"
          >
            {isRegisterMode ? (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Nama lengkap
                </span>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white sm:text-base"
                  placeholder="Nama Anda atau nama toko"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
            ) : null}

            {!isUpdatePasswordMode ? (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Email
                </span>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white sm:text-base"
                  placeholder="nama@email.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  type="email"
                />
              </label>
            ) : null}

            {!isForgotMode ? (
              <>
                <div className="block">
                  <label
                    htmlFor={passwordId}
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    {isUpdatePasswordMode ? 'Password baru' : 'Password'}
                  </label>
                  <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition focus-within:border-slate-400 focus-within:bg-white">
                    <input
                      id={passwordId}
                      className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-slate-900 outline-none sm:text-base"
                      placeholder="Minimal 6 karakter"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={
                        isLoginMode ? 'current-password' : 'new-password'
                      }
                      required
                    />
                    <button
                      type="button"
                      aria-controls={passwordId}
                      aria-pressed={showPassword}
                      aria-label={
                        showPassword
                          ? 'Sembunyikan password'
                          : 'Tampilkan password'
                      }
                      onClick={() => setShowPassword((current) => !current)}
                      className="shrink-0 px-4 text-sm font-medium text-slate-500 transition hover:text-slate-900"
                    >
                      {showPassword ? 'Sembunyi' : 'Lihat'}
                    </button>
                  </div>
                </div>

                {isRegisterMode || isUpdatePasswordMode ? (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Konfirmasi password
                    </span>
                    <input
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white sm:text-base"
                      placeholder="Ulangi password"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      autoComplete="new-password"
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
                <div className="mb-2 text-sm font-medium text-slate-700">
                  Pilih peran akun
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  {ROLE_OPTIONS.map((option) => {
                    const active = role === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setRole(option.value)}
                        aria-pressed={active}
                        className={`min-w-0 rounded-xl border p-3 text-left transition ${
                          active
                            ? 'border-teal-700 bg-teal-50 text-teal-900'
                            : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-base font-semibold">
                            {option.label}
                          </div>
                          <span
                            className={`inline-flex h-5 w-5 rounded-full border ${
                              active
                                ? 'border-teal-700 bg-teal-700'
                                : 'border-slate-300 bg-white'
                            }`}
                          />
                        </div>
                        <div
                          className={`mt-2 text-xs leading-5 ${active ? 'text-teal-800' : 'text-slate-600'}`}
                        >
                          {option.description}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {inlineMsg ? (
              <div
                role="status"
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  ['berhasil', 'dikirim', 'diperbarui'].some((word) =>
                    inlineMsg.toLowerCase().includes(word)
                  )
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                <span className="break-words">{inlineMsg}</span>
              </div>
            ) : null}

            <div className="space-y-3 pt-1">
              <button disabled={loading} className="ui-primary w-full py-3.5">
                {primaryActionLabel}
                {!loading && (
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                )}
              </button>

              {!isLoginMode && !isRegisterMode && (
                <button
                  type="button"
                  onClick={() => switchMode(isLoginMode ? 'register' : 'login')}
                  className="ui-secondary w-full"
                >
                  {isLoginMode ? 'Daftar akun' : 'Masuk akun'}
                </button>
              )}

              {isLoginMode ? (
                <details className="pt-1 text-center text-sm text-slate-500">
                  <summary className="flex cursor-pointer items-center justify-center">
                    Belum menerima verifikasi?
                  </summary>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    className="min-h-11 text-sm font-semibold text-teal-800 underline underline-offset-4"
                  >
                    Kirim ulang verifikasi
                  </button>
                </details>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
