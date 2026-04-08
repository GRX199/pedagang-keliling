import React, { Suspense, lazy } from 'react'
import { Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom'
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

  async function handleLogout() {
    try {
      await supabase.auth.signOut()
      navigate('/login', { replace: true })
    } catch (e) {
      console.error('Logout error', e)
    }
  }

  const avatarUrl = user?.user_metadata?.avatar_url

  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-lg font-bold">Kelilingku</Link>
          {user && (
            <nav className="hidden md:flex gap-2">
              <Link to="/map" className="px-3 py-1 rounded hover:bg-gray-100">Peta</Link>
              <Link to="/dashboard" className="px-3 py-1 rounded hover:bg-gray-100">Dashboard</Link>
              <Link to="/chat" className="px-3 py-1 rounded hover:bg-gray-100">Chat</Link>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm">
                  {(user.user_metadata?.full_name || user.email || 'U')[0]}
                </div>
              )}
              <div className="text-sm hidden sm:block">{user.user_metadata?.full_name || user.email}</div>
              <button onClick={handleLogout} className="px-3 py-1 border rounded text-sm bg-red-50 text-red-600">Logout</button>
            </>
          ) : (
            <Link to="/login" className="px-3 py-1 border rounded text-sm">Login / Daftar</Link>
          )}
        </div>
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
      <main className="min-h-[calc(100vh-64px)]">
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
