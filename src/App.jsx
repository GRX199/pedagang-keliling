import React, { Suspense, lazy } from 'react'
import { Routes, Route, Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom'
import VendorLiveLocationSync from './components/VendorLiveLocationSync'
import { useToast } from './components/ToastProvider'
import { useAuth } from './lib/auth'
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
  const { user, loading } = useAuth()
  if (loading) return <div className="p-6">Memuat...</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function TopNav() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  async function handleLogout() {
    try {
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
  const isVendor = !isAdmin && (role === 'vendor' || user?.user_metadata?.is_vendor === true)
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

  function renderNavItem(item, compact = false) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={`rounded-full px-3 py-2 text-sm font-medium transition ${
          item.active
            ? 'bg-slate-900 text-white shadow-sm'
            : compact
              ? 'bg-white/70 text-slate-700 ring-1 ring-slate-200 hover:bg-white'
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
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link to={user ? (isAdmin ? '/dashboard?tab=admin' : '/map') : '/'} className="inline-flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
                K
              </span>
              <span>
                <span className="block text-lg font-bold tracking-tight text-slate-900">Kelilingku</span>
                <span className="hidden text-xs text-slate-500 sm:block">Belanja sekitar, langsung terhubung</span>
              </span>
            </Link>

            {user && (
              <nav className="hidden md:flex gap-2">
                {navItems.map((item) => renderNavItem(item))}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                {avatarUrl ? (
                  <img src={avatarUrl} alt="avatar" className="h-9 w-9 rounded-full object-cover ring-2 ring-slate-100" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                    {(user.user_metadata?.full_name || user.email || 'U')[0]}
                  </div>
                )}
                <div className="hidden text-sm sm:block">
                  <div className="max-w-[220px] truncate font-medium text-slate-900">
                    {user.user_metadata?.full_name || user.email}
                  </div>
                  <div className="text-xs text-slate-500">{accountLabel}</div>
                </div>
                <button
                  onClick={handleLogout}
                  className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-100"
                >
                  Logout
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <a
                  href="/#cara-kerja"
                  className="hidden rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 sm:inline-flex"
                >
                  Cara Kerja
                </a>
                <Link to="/login" className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                  Login / Daftar
                </Link>
              </div>
            )}
          </div>
        </div>

        {user && (
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 md:hidden">
            {navItems.map((item) => renderNavItem(item, true))}
          </nav>
        )}
      </div>
    </header>
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
  if (loading) return <div className="p-6">Memuat...</div>
  if (user) {
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
  return (
    <>
      <TopNav />
      <VendorLiveLocationSync />
      <main className="min-h-[calc(100vh-73px)]">
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

            <Route path="/vendor/:id" element={<VendorProfile />} />

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
