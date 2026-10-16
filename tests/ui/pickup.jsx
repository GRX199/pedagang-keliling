import React, { useCallback, useState } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient, onlineManager } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { ToastProvider } from '../../src/shared/components/ToastProvider'
import PickupTrackingPage from '../../src/features/orders/PickupTrackingPage'
import LegacyOrderTrackingPage from '../../src/features/orders/LegacyOrderTrackingPage'
import PwaInstallPrompt from '../../src/shared/components/PwaInstallPrompt'
import VendorStorePage from '../../src/features/vendor/VendorStorePage'
import OrdersPanel from '../../src/features/orders/OrdersPanel'
import VendorProductsManager from '../../src/features/vendor/components/VendorProductsManager'
import VendorLiveLocationSync from '../../src/features/vendor/VendorLiveLocationSync'
import MapViewPage from '../../src/features/map/MapViewPage'
import AdminDashboard from '../../src/features/admin/AdminDashboard'
import ProfilePanel from '../../src/features/vendor/ProfilePanel'
import DashboardScreen from '../../src/features/vendor/DashboardScreen'
import { fixtureOrder } from './pickup-mock'
import { ChatThread } from '../../src/features/chat/ChatWorkspace'
import { user } from './pickup-mock'
import { useRealtimeNotifications } from '../../src/features/notifications/useNotifications'
import { useToast } from '../../src/shared/components/ToastProvider'
import { ConnectionNotice } from '../../src/shared/components/SyncStatus'
import '../../src/styles/index.css'

const storeMode = ['store', 'shop-flow'].includes(new URLSearchParams(location.search).get('view'))
const view = new URLSearchParams(location.search).get('view')
const role = new URLSearchParams(location.search).get('role') === 'vendor' ? 'vendor' : 'customer'
const isolated = view === 'dashboard' ? <DashboardScreen /> : view === 'orders' ? <OrdersPanel currentUser={user} role={role} />
  : view === 'legacy' ? <LegacyOrderTrackingPage initialOrder={fixtureOrder} />
  : view === 'products' ? <VendorProductsManager vendorId={user.id} />
  : view === 'presence' ? <><h1>Presence fixture</h1><VendorLiveLocationSync /></>
  : view === 'map' ? <MapViewPage />
  : view === 'admin' ? <AdminDashboard currentUser={user} /> : null
function ProfileFixture() {
  const [revision, setRevision] = useState(0)
  const [visible, setVisible] = useState(true)
  return <><button onClick={() => setRevision(value => value + 1)}>Simulasikan refresh sesi</button><button onClick={() => setVisible(false)}>Sembunyikan profil</button><p>Revisi sesi: {revision}</p>{visible && <ProfilePanel currentUser={{ ...user, user_metadata: { ...user.user_metadata } }} role={role} />}</>
}
function FixtureNavigation() {
  const navigate = useNavigate()
  if (view !== 'shop-flow') return null
  return <><button onClick={() => navigate('/vendors/other')}>Toko lain fixture</button><button onClick={() => navigate('/vendors/vendor')}>Kembali ke toko fixture</button><button onClick={() => navigate('/map')}>Buka peta fixture</button></>
}
function ChatFixture() {
  const [chatId, setChatId] = useState('first')
  const [activity, setActivity] = useState(0)
  const onActivity = useCallback(() => setActivity(value => value + 1), [])
  return <ToastProvider><ConnectionNotice /><main style={{ height: 600, maxWidth: 512, display: 'flex', flexDirection: 'column' }} className="mx-auto p-3">
    <button onClick={() => setChatId(value => value === 'first' ? 'second' : 'first')}>Ganti percakapan</button>
    <p>Aktivitas: {activity}</p>
    <ChatThread key={`${user.id}:${chatId}`} chatId={chatId} currentUser={user} onMessageActivity={onActivity} />
  </main></ToastProvider>
}
function NotificationCenter({ owner, route }) {
  const toast = useToast()
  const client = useQueryClient()
  React.useEffect(() => { client.setQueryData(['visible-chat', owner], route.activeChatId || null) }, [client, owner, route])
  const counts = useRealtimeNotifications({ user: { ...user, id: owner }, role: 'vendor', pathname: route.pathname, search: route.search, toast })
  return <><p>Pesan belum dibaca: {counts.messages}</p><p>Pesanan belum dibaca: {counts.orders}</p></>
}
function NotificationFixture() {
  const [owner, setOwner] = useState(user.id)
  const [visible, setVisible] = useState(true)
  const [route, setRoute] = useState({ pathname: '/map', search: '' })
  return <><h1>Notifikasi fixture</h1>
    <button onClick={() => setRoute({ pathname: '/dashboard', search: '?tab=chats', activeChatId: 'chat' })}>Buka chat dashboard</button>
    <button onClick={() => setRoute({ pathname: '/orders/order', search: '' })}>Lacak satu pesanan</button>
    <button onClick={() => setRoute({ pathname: '/map', search: '' })}>Kembali ke peta</button>
    <button onClick={() => setOwner('other')}>Ganti akun notifikasi</button>
    <button onClick={() => setVisible(false)}>Tutup notifikasi</button>
    <button onClick={() => queryClient.invalidateQueries({ queryKey: ['notifications'] })}>Muat notifikasi</button>
    {visible && <NotificationCenter owner={owner} route={route} />}
  </>
}
function PwaFixture() {
  const [role, setRole] = useState('customer')
  return <><h1>PWA fixture</h1><button onClick={() => setRole('vendor')}>Masuk sebagai pedagang</button><PwaInstallPrompt role={role} /></>
}
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, networkMode: 'always' } } })
window.performanceFixture = {
  refreshChat() { return queryClient.invalidateQueries({ queryKey: ['chat-messages', user.id, 'first', 'v2', 'updates'] }) },
  setOnline(value) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
    onlineManager.setOnline(value)
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  },
}
if (new URLSearchParams(location.search).get('offline') === '1') window.performanceFixture.setOnline(false)
createRoot(document.getElementById('root')).render(<React.StrictMode><QueryClientProvider client={queryClient}>{view === 'pwa' ? <PwaFixture /> : view === 'notifications' ? <ToastProvider><NotificationFixture /></ToastProvider> : view === 'profile' ? <ToastProvider><ProfileFixture /></ToastProvider> : isolated ? <BrowserRouter><ToastProvider>{isolated}</ToastProvider></BrowserRouter> : new URLSearchParams(location.search).get('view') === 'chat' ? <ChatFixture /> : storeMode ? <MemoryRouter initialEntries={['/vendors/vendor']}><ToastProvider><FixtureNavigation /><Routes>
  <Route path="/vendors/:id" element={<VendorStorePage />} />
  <Route path="/map" element={<MapViewPage />} />
  <Route path="/orders/:id" element={<h1>Permintaan tersimpan</h1>} />
</Routes></ToastProvider></MemoryRouter> : <BrowserRouter><ToastProvider>
  <p className="bg-amber-50 px-3 py-2 text-xs">Simulasi pengembang. Bukan transaksi nyata.</p>
  <PickupTrackingPage initialOrder={fixtureOrder} />
</ToastProvider></BrowserRouter>}</QueryClientProvider></React.StrictMode>)
