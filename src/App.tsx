import { Suspense, lazy, type PropsWithChildren } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import VendorLiveLocationSync from './features/vendor/VendorLiveLocationSync'
import PwaInstallPrompt from './shared/components/PwaInstallPrompt'
import { useAuth } from './features/auth/AuthProvider'

import AppNavigation from './shared/components/AppNavigation'
import ProtectedRoute from './features/auth/ProtectedRoute'
import { ConnectionNotice } from './shared/components/SyncStatus'

const DashboardPage = lazy(() => import('./features/vendor/DashboardScreen'))
const MapPage = lazy(() => import('./features/map/MapViewPage'))
const VendorProfile = lazy(() => import('./features/vendor/VendorStorePage'))
const LoginPage = lazy(() => import('./features/auth/LoginPage'))
const ChatsPage = lazy(() => import('./features/chat/ChatsPage'))
const OrderTrackingPage = lazy(
  () => import('./features/orders/OrderTrackingPage')
)
const LandingPage = lazy(() => import('./pages/LandingPage'))

function RootRedirect() {
  const { user, role, loading } = useAuth()
  if (loading) return <div className="p-6">Memuat...</div>
  if (!user) return <LandingPage />
  return role === 'admin' ? (
    <Navigate to="/dashboard?tab=admin" replace />
  ) : (
    <Navigate to="/map" replace />
  )
}

function LoginGuard({ children }: PropsWithChildren) {
  const { user, role, loading } = useAuth()
  const location = useLocation()
  const hashParams = new URLSearchParams(
    String(location.hash || '').replace(/^#/, '')
  )
  const isPasswordReset =
    new URLSearchParams(location.search).get('reset') === 'password' ||
    hashParams.get('type') === 'recovery'

  if (loading) return <div className="p-6">Memuat...</div>
  if (user && !isPasswordReset) {
    return role === 'admin' ? (
      <Navigate to="/dashboard?tab=admin" replace />
    ) : (
      <Navigate to="/map" replace />
    )
  }
  return children
}

function RouteFallback() {
  return <div className="p-6 text-sm text-gray-500">Memuat halaman...</div>
}

export default function App() {
  const { user, role } = useAuth()

  return (
    <div className={user ? 'app-shell app-shell--authenticated' : 'app-shell'}>
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[2000] focus:rounded-xl focus:bg-teal-800 focus:p-3 focus:text-white"
      >
        Lewati ke konten utama
      </a>
      <AppNavigation />
      {user ? <ConnectionNotice /> : null}
      {user && role === 'vendor' ? <VendorLiveLocationSync /> : null}
      <PwaInstallPrompt role={role} />
      <main id="konten-utama" tabIndex={-1} className="app-main outline-none">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route
              path="/login"
              element={
                <LoginGuard>
                  <LoginPage />
                </LoginGuard>
              }
            />

            <Route
              path="/map"
              element={
                <ProtectedRoute>
                  <MapPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/vendor/:id"
              element={
                <ProtectedRoute>
                  <VendorProfile />
                </ProtectedRoute>
              }
            />

            <Route
              path="/chat"
              element={
                <ProtectedRoute>
                  <ChatsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/chat/:id"
              element={
                <ProtectedRoute>
                  <ChatsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/orders/:id"
              element={
                <ProtectedRoute>
                  <OrderTrackingPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="*"
              element={<div className="p-6">Halaman tidak ditemukan</div>}
            />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
