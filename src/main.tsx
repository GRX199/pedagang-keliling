import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './shared/lib/queryClient'
import './styles/index.css'
import { AuthProvider } from './features/auth/AuthProvider'
import { registerServiceWorker } from './lib/pwa'
import { ToastProvider } from './shared/components/ToastProvider'
import AppErrorBoundary from './shared/components/AppErrorBoundary'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root aplikasi tidak ditemukan.')
createRoot(root).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </ToastProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)

registerServiceWorker()
