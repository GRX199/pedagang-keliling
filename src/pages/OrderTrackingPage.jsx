import React, { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isPickupOrder } from '../lib/pickup'
import PickupTrackingPage from './PickupTrackingPage'

const LegacyOrderTrackingPage = lazy(() => import('./LegacyOrderTrackingPage'))

export default function OrderTrackingPage() {
  const { id } = useParams()
  const [result, setResult] = useState(null)
  useEffect(() => {
    let active = true
    supabase.from('orders').select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
      if (active) setResult({ id, data, error: error?.message || (!data ? 'Pesanan tidak ditemukan.' : '') })
    }).catch(() => { if (active) setResult({ id, error: 'Pesanan tidak dapat dimuat. Periksa koneksi lalu coba lagi.' }) })
    return () => { active = false }
  }, [id])
  if (result?.id !== id) return <p className="p-6" role="status">Memuat pesanan...</p>
  if (result.error) return <div className="p-6"><p role="alert">{result.error}</p><Link to="/dashboard?tab=orders" className="underline">Kembali ke pesanan</Link></div>
  if (isPickupOrder(result.data)) return <PickupTrackingPage key={id} initialOrder={result.data} />
  return <>
    <p className="mx-auto max-w-6xl rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Pesanan alur lama: selesaikan sesuai kesepakatan awal. Pilihan kurir pelanggan hanya berlaku untuk pesanan baru.</p>
    <Suspense fallback={<p className="p-6">Memuat detail...</p>}><LegacyOrderTrackingPage key={id} /></Suspense>
  </>
}
