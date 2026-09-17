import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from '../../src/components/ToastProvider'
import PickupTrackingPage from '../../src/pages/PickupTrackingPage'
import VendorStorePage from '../../src/pages/VendorStorePage'
import { fixtureOrder } from './pickup-mock'
import '../../src/styles/index.css'

const storeMode = new URLSearchParams(location.search).get('view') === 'store'
createRoot(document.getElementById('root')).render(<React.StrictMode>{storeMode ? <MemoryRouter initialEntries={['/vendors/vendor']}><ToastProvider><Routes>
  <Route path="/vendors/:id" element={<VendorStorePage />} />
  <Route path="/orders/:id" element={<h1>Permintaan tersimpan</h1>} />
</Routes></ToastProvider></MemoryRouter> : <BrowserRouter><ToastProvider>
  <p className="bg-amber-50 px-3 py-2 text-xs">Simulasi pengembang. Bukan transaksi nyata.</p>
  <PickupTrackingPage initialOrder={fixtureOrder} />
</ToastProvider></BrowserRouter>}</React.StrictMode>)
