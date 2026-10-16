import type { PropsWithChildren } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export default function ProtectedRoute({ children }: PropsWithChildren) {
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
            Akses transaksi dinonaktifkan. Hubungi pengelola Kelilingku jika Anda memerlukan
            peninjauan.
          </p>
        </div>
      </div>
    )
  }
  return children
}
