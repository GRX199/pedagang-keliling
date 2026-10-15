import React, { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from '../../src/components/ToastProvider'
import PickupTrackingPage from '../../src/pages/PickupTrackingPage'
import VendorStorePage from '../../src/pages/VendorStorePage'
import { fixtureOrder } from './pickup-mock'
import { ChatThread } from '../../src/components/ChatWorkspace'
import { user } from './pickup-mock'
import '../../src/styles/index.css'

const storeMode = new URLSearchParams(location.search).get('view') === 'store'
function ChatFixture() {
  const [chatId, setChatId] = useState('first')
  const [activity, setActivity] = useState(0)
  const onActivity = useCallback(() => setActivity(value => value + 1), [])
  return <ToastProvider><main className="mx-auto h-[600px] max-w-lg p-3">
    <button onClick={() => setChatId(value => value === 'first' ? 'second' : 'first')}>Ganti percakapan</button>
    <p>Aktivitas: {activity}</p>
    <ChatThread key={`${user.id}:${chatId}`} chatId={chatId} currentUser={user} onMessageActivity={onActivity} />
  </main></ToastProvider>
}
createRoot(document.getElementById('root')).render(<React.StrictMode>{new URLSearchParams(location.search).get('view') === 'chat' ? <ChatFixture /> : storeMode ? <MemoryRouter initialEntries={['/vendors/vendor']}><ToastProvider><Routes>
  <Route path="/vendors/:id" element={<VendorStorePage />} />
  <Route path="/orders/:id" element={<h1>Permintaan tersimpan</h1>} />
</Routes></ToastProvider></MemoryRouter> : <BrowserRouter><ToastProvider>
  <p className="bg-amber-50 px-3 py-2 text-xs">Simulasi pengembang. Bukan transaksi nyata.</p>
  <PickupTrackingPage initialOrder={fixtureOrder} />
</ToastProvider></BrowserRouter>}</React.StrictMode>)
