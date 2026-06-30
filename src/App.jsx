import React, { Suspense, lazy } from 'react'
import { Routes, Route, Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom'
import VendorLiveLocationSync from './components/VendorLiveLocationSync'
import PwaInstallPrompt from './components/PwaInstallPrompt'
import { useToast } from './components/ToastProvider'
import { useAuth } from './lib/auth'
import { getFriendlyFetchErrorMessage, requireServerOrigin } from './lib/network'
import { useRealtimeNotifications } from './lib/notifications'
import { supabase } from './lib/supabase'

const DashboardPage = lazy(() => import('./pages/DashboardScreen'))
const MapPage = lazy(() => import('./pages/MapViewPage'))
const VendorProfile = lazy(() => import('./pages/VendorStorePage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const ChatsPage = lazy(() => import('./pages/ChatsPage'))
const OrderTrackingPage = lazy(() => import('./pages/OrderTrackingPage'))
const LandingPage = lazy(() => import('./pages/LandingPage'))

function Protected({ children }) {
  const { user, role, accountStatus, authError, loading, refreshAuth } = useAuth()
  if (loading) return <div className="p-6">Memuat...</div>
  if (!user) return <Navigate to="/login" replace />
  if (!role && !authError) return <div className="p-6">Memverifikasi akun...</div>
  if (authError || !role) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
          <h1 className="text-lg font-semibold text-amber-950">Akses belum dapat diverifikasi</h1>
          <p className="mt-2 text-sm text-amber-800">{authError || 'Role akun belum tersedia.'}</p>
          <button
            type="button"
            onClick={() => void refreshAuth()}
            className="mt-4 rounded-full bg-amber-900 px-4 py-2 text-sm font-medium text-white"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    )
  }
  if (accountStatus !== 'active') {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
          <h1 className="text-lg font-semibold text-rose-950">
            {accountStatus === 'blocked' ? 'Akun diblokir' : 'Akun ditangguhkan'}
          </h1>
          <p className="mt-2 text-sm text-rose-800">
            Akses transaksi dinonaktifkan. Hubungi pengelola Kelilingku jika Anda memerlukan peninjauan.
          </p>
        </div>
      </div>
    )
  }
  return children
}

function TopNav() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  async function setVendorOfflineBeforeLogout() {
    if (role !== 'vendor' || !user?.id) return

    try {
      const { data } = await supabase.auth.getSession()
      const accessToken = data?.session?.access_token
      if (!accessToken) throw new Error('Sesi login tidak ditemukan')

      const serverOrigin = requireServerOrigin()
      const response = await fetch(`${serverOrigin}/api/vendor/${user.id}/online`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ online: false }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
    } catch (error) {
      console.warn('setVendorOfflineBeforeLogout.backend', error)
      try {
        const { error: updateError } = await supabase
          .from('vendors')
          .update({ online: false, location: null, last_seen_at: null })
          .eq('id', user.id)

        if (updateError) throw updateError
      } catch (fallbackError) {
        console.warn('setVendorOfflineBeforeLogout.fallback', fallbackError)
        toast.push(
          getFriendlyFetchErrorMessage(
            error,
            'Anda berhasil logout, tetapi status toko mungkin belum sempat diubah ke offline.'
          ),
          { type: 'warning' }
        )
      }
    }
  }

  async function handleLogout() {
    try {
      await setVendorOfflineBeforeLogout()
      await supabase.auth.signOut()
      navigate('/login', { replace: true })
    } catch (e) {
      console.error('Logout error', e)
    }
  }

  const avatarUrl = user?.user_metadata?.avatar_url
  const notificationCounts = useRealtimeNotifications({
    user,
    role,
    pathname: location.pathname,
    search: location.search,
    toast,
  })

  const isAdmin = role === 'admin'
  const isVendor = !isAdmin && role === 'vendor'
  const accountLabel = isAdmin ? 'Admin aktif' : isVendor ? 'Pedagang aktif' : 'Pelanggan aktif'
  const currentTab = new URLSearchParams(location.search).get('tab')
  const effectiveTab = currentTab || (isAdmin ? 'admin' : isVendor ? 'products' : 'orders')

  const navItems = user
    ? (
      isAdmin
        ? [
          {
            to: '/dashboard?tab=admin',
            label: 'Admin',
            count: 0,
            active: location.pathname === '/dashboard' && effectiveTab === 'admin',
          },
          { to: '/map', label: 'Peta', count: 0, active: location.pathname === '/map' },
          {
            to: '/dashboard?tab=profile',
            label: 'Profil',
            count: 0,
            active: location.pathname === '/dashboard' && effectiveTab === 'profile',
          },
        ]
        : isVendor
        ? [
          { to: '/map', label: 'Peta', count: 0, active: location.pathname === '/map' },
          {
            to: '/dashboard?tab=orders',
            label: 'Pesanan',
            count: notificationCounts.orders,
            active: location.pathname === '/dashboard' && effectiveTab === 'orders',
          },
          { to: '/chat', label: 'Chat', count: notificationCounts.messages, active: location.pathname.startsWith('/chat') },
          {
            to: '/dashboard?tab=products',
            label: 'Produk',
            count: 0,
            active: location.pathname === '/dashboard' && effectiveTab === 'products',
          },
          {
            to: '/dashboard?tab=profile',
            label: 'Profil',
            count: 0,
            active: location.pathname === '/dashboard' && effectiveTab === 'profile',
          },
        ]
        : [
          { to: '/map', label: 'Peta', count: 0, active: location.pathname === '/map' },
          {
            to: '/dashboard?tab=orders',
            label: 'Pesanan',
            count: notificationCounts.orders,
            active: location.pathname === '/dashboard' && effectiveTab === 'orders',
          },
          { to: '/chat', label: 'Chat', count: notificationCounts.messages, active: location.pathname.startsWith('/chat') },
          {
            to: '/dashboard?tab=profile',
            label: 'Profil',
            count: 0,
            active: location.pathname === '/dashboard' && effectiveTab === 'profile',
          },
        ]
    )
    : []

  const mobileNavItems = isVendor
    ? navItems.filter((item) => item.label !== 'Profil')
    : navItems

  function NavIcon({ label }) {
    const paths = {
      Peta: <><path d="M12 21s6-4.35 6-11a6 6 0 1 0-12 0c0 6.65 6 11 6 11Z" /><circle cx="12" cy="10" r="2.2" /></>,
      Pesanan: <><path d="M7 4h10a2 2 0 0 1 2 2v14H5V6a2 2 0 0 1 2-2Z" /><path d="M9 2h6v4H9zM8 11h8M8 15h5" /></>,
      Chat: <><path d="M21 12a8 8 0 0 1-9 7.94A8.8 8.8 0 0 1 8 21l1.05-3.15A8 8 0 1 1 21 12Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>,
      Produk: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="m4 7 8 4 8-4v10l-8 4-8-4V7ZM12 11v10" /></>,
      Profil: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
      Admin: <><path d="M12 3 4 7v5c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V7l-8-4Z" /><path d="m9 12 2 2 4-4" /></>,
    }

    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[label] || paths.Profil}
      </svg>
    )
  }

  function renderDesktopNavItem(item) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={`rounded-full px-3 py-2 text-sm font-medium transition ${
          item.active
            ? 'bg-slate-900 text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <span>{item.label}</span>
          {item.count > 0 && (
            <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
              item.active ? 'bg-white/15 text-white' : 'bg-rose-500 text-white'
            }`}>
              {item.count}
            </span>
          )}
        </span>
      </NavLink>
    )
  }

  return (
    <>
      <header className="sticky top-0 z-[1300] border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex items-center gap-4">
              <Link to={user ? (isAdmin ? '/dashboard?tab=admin' : '/map') : '/'} className="inline-flex min-w-0 items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
                  K
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-bold tracking-tight text-slate-900 sm:text-lg">Kelilingku</span>
                  <span className="hidden text-xs text-slate-500 lg:block">Belanja sekitar, langsung terhubung</span>
                </span>
              </Link>

              {user && (
                <nav className="hidden gap-2 lg:flex">
                  {navItems.map((item) => renderDesktopNavItem(item))}
                </nav>
              )}
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {user ? (
                <details className="account-menu relative">
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-slate-200 bg-white p-1 pr-1 transition hover:bg-slate-50 sm:pr-3">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="avatar" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                        {(user.user_metadata?.full_name || user.email || 'U')[0]}
                      </span>
                    )}
                    <span className="hidden min-w-0 text-left sm:block">
                      <span className="block max-w-36 truncate text-sm font-medium text-slate-800">
                        {user.user_metadata?.full_name || user.email}
                      </span>
                    </span>
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="hidden h-4 w-4 text-slate-400 sm:block" fill="currentColor">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.1 1.02l-4.25 4.5a.75.75 0 0 1-1.1 0l-4.25-4.5a.75.75 0 0 1 .02-1.04Z" clipRule="evenodd" />
                    </svg>
                  </summary>
                  <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
                    <div className="border-b border-slate-100 px-3 py-2">
                      <div className="truncate text-sm font-medium text-slate-900">{user.user_metadata?.full_name || user.email}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{accountLabel}</div>
                    </div>
                    <Link
                      to="/dashboard?tab=profile"
                      className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <NavIcon label="Profil" />
                      Profil & pengaturan
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-50"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
                      </svg>
                      Keluar
                    </button>
                  </div>
                </details>
              ) : (
                <div className="flex items-center gap-2">
                  <a
                    href="/#cara-kerja"
                    className="hidden rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 sm:inline-flex"
                  >
                    Cara Kerja
                  </a>
                  <Link to="/login" className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                    <span className="sm:hidden">Masuk</span>
                    <span className="hidden sm:inline">Login / Daftar</span>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {user && (
        <nav className="fixed inset-x-3 bottom-3 z-[1200] lg:hidden">
          <div
            className="grid rounded-[22px] border border-slate-200/80 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur"
            style={{ gridTemplateColumns: `repeat(${mobileNavItems.length || 1}, minmax(0, 1fr))` }}
          >
            {mobileNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label}
                className={`relative min-w-0 rounded-[16px] px-1 py-2 text-center text-[11px] font-medium transition ${
                  item.active
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex flex-col items-center gap-1">
                  <NavIcon label={item.label} />
                  <span className="max-w-full truncate">{item.label}</span>
                  {item.count > 0 ? (
                    <span className={`absolute right-[22%] top-1 inline-flex min-w-4 items-center justify-center rounded-full px-1 py-0.5 text-[9px] font-semibold ${
                      item.active ? 'bg-white/15 text-white' : 'bg-rose-500 text-white'
                    }`}>
                      {item.count}
                    </span>
                  ) : null}
                </span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </>
  )
}

function RootRedirect() {
  const { user, role, loading } = useAuth()
  if (loading) return <div className="p-6">Memuat...</div>
  if (!user) return <LandingPage />
  return role === 'admin'
    ? <Navigate to="/dashboard?tab=admin" replace />
    : <Navigate to="/map" replace />
}

function LoginGuard({ children }) {
  const { user, role, loading } = useAuth()
  const location = useLocation()
  const hashParams = new URLSearchParams(String(location.hash || '').replace(/^#/, ''))
  const isPasswordReset = new URLSearchParams(location.search).get('reset') === 'password' || hashParams.get('type') === 'recovery'

  if (loading) return <div className="p-6">Memuat...</div>
  if (user && !isPasswordReset) {
    return role === 'admin'
      ? <Navigate to="/dashboard?tab=admin" replace />
      : <Navigate to="/map" replace />
  }
  return children
}

function RouteFallback() {
  return <div className="p-6 text-sm text-gray-500">Memuat halaman...</div>
}

export default function App() {
  const { user, role } = useAuth()

  return (
    <>
      <TopNav />
      {user && role === 'vendor' ? <VendorLiveLocationSync /> : null}
      <PwaInstallPrompt role={role} />
      <main className={`min-h-[calc(100vh-73px)] ${user ? 'pb-28 lg:pb-0' : ''}`}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<LoginGuard><LoginPage /></LoginGuard>} />

            <Route path="/map" element={
              <Protected><MapPage /></Protected>
            } />

            <Route path="/dashboard" element={
              <Protected><DashboardPage /></Protected>
            } />

            <Route path="/vendor/:id" element={<Protected><VendorProfile /></Protected>} />

            <Route path="/chat" element={<Protected><ChatsPage /></Protected>} />
            <Route path="/chat/:id" element={<Protected><ChatsPage /></Protected>} />
            <Route path="/orders/:id" element={<Protected><OrderTrackingPage /></Protected>} />

            <Route path="*" element={<div className="p-6">Halaman tidak ditemukan</div>} />
          </Routes>
        </Suspense>
      </main>
    </>
  )
}
