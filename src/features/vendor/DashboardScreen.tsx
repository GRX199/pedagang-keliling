import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import AdminPanel from '../admin/AdminDashboard'
import ChatWorkspace from '../chat/ChatWorkspace'
import OrdersPanel from '../orders/OrdersPanel'
import VendorProductsManager from './components/VendorProductsManager'
import ProfilePanel from './ProfilePanel'

export default function DashboardScreen() {
  const { user, role, loading, accountStatus } = useAuth()
  const location = useLocation()
  const isAdmin = role === 'admin'
  const isVendor = role === 'vendor'
  const allowedTabs = isAdmin
    ? ['admin', 'profile']
    : isVendor
      ? ['products', 'chats', 'orders', 'profile']
      : ['chats', 'orders', 'profile']
  const requestedTab = new URLSearchParams(location.search).get('tab')
  const activeTab =
    requestedTab && allowedTabs.includes(requestedTab)
      ? requestedTab
      : isAdmin
        ? 'admin'
        : isVendor
          ? 'products'
          : 'orders'

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Memuat dashboard...</div>
  }

  if (!user || !role) return null

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-5xl overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
        <main className="min-w-0 max-w-full space-y-4">
          {accountStatus !== 'active' ? (
            <div
              className={`rounded-[28px] p-4 text-sm shadow-sm ring-1 ${
                accountStatus === 'blocked'
                  ? 'bg-rose-50 text-rose-700 ring-rose-100'
                  : 'bg-amber-50 text-amber-700 ring-amber-100'
              }`}
            >
              {accountStatus === 'blocked'
                ? 'Akun diblokir admin. Beberapa fitur dibatasi.'
                : 'Akun ditangguhkan admin. Tunggu peninjauan selesai.'}
            </div>
          ) : null}

          {activeTab === 'admin' && isAdmin && <AdminPanel currentUser={user} />}
          {activeTab === 'products' && isVendor && <VendorProductsManager />}
          {activeTab === 'chats' && !isAdmin && <ChatWorkspace embedded />}
          {activeTab === 'orders' && !isAdmin && <OrdersPanel currentUser={user} role={role} />}
          {activeTab === 'profile' && (
            <ProfilePanel key={`${user.id}:${role}`} currentUser={user} role={role} />
          )}
        </main>
      </div>
    </div>
  )
}
