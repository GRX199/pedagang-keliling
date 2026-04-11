import React, { Suspense, lazy } from 'react'
import { Routes, Route, Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { supabase } from './lib/supabase'

const DashboardPage = lazy(() => import('./pages/DashboardScreen'))
const MapPage = lazy(() => import('./pages/MapViewPage'))
const VendorProfile = lazy(() => import('./pages/VendorStorePage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const ChatsPage = lazy(() => import('./pages/ChatsPage'))

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-6">Memuat...</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function TopNav() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  async function handleLogout() {
    try {
      await supabase.auth.signOut()
      navigate('/login', { replace: true })
    } catch (e) {
      console.error('Logout error', e)
    }
  }

  const avatarUrl = user?.user_metadata?.avatar_url
  const navItems = [
    { to: '/map', label: 'Peta' },
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/chat', label: 'Chat' },
  ]

  function renderNavItem(item, compact = false) {
    const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={`rounded-full px-3 py-2 text-sm font-medium transition ${
          active
            ? 'bg-slate-900 text-white shadow-sm'
            : compact
              ? 'bg-white/70 text-slate-700 ring-1 ring-slate-200 hover:bg-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        {item.label}
      </NavLink>
    )
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link to="/" className="inline-flex items-center gap-3">
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
                  <div className="text-xs text-slate-500">Akun aktif</div>
                </div>
                <button
                  onClick={handleLogout}
                  className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-100"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link to="/login" className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                Login / Daftar
              </Link>
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
  const { user, loading } = useAuth()
  if (loading) return <div className="p-6">Memuat...</div>
  return user ? <Navigate to="/map" replace /> : <Navigate to="/login" replace />
}

function LoginGuard({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-6">Memuat...</div>
  if (user) return <Navigate to="/map" replace />
  return children
}

function RouteFallback() {
  return <div className="p-6 text-sm text-gray-500">Memuat halaman...</div>
}

export default function App() {
  return (
    <>
      <TopNav />
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

            <Route path="*" element={<div className="p-6">Halaman tidak ditemukan</div>} />
          </Routes>
        </Suspense>
      </main>
    </>
  )
}
