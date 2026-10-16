import { lazy, Suspense } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isPickupOrder } from '../../lib/pickup'
import { errorMessage } from '../../shared/lib/utils'
import { Spinner } from '../../shared/components/Spinner'
import PickupTrackingPage from './PickupTrackingPage'
import { useOrder } from './useOrders'

const LegacyOrderTrackingPage = lazy(() => import('./LegacyOrderTrackingPage'))
export default function OrderTrackingPage() {
  const { id } = useParams()
  const query = useOrder(id)
  if (query.isPending) return <Spinner label="Memuat pesanan..." />
  if (query.isError || !query.data)
    return (
      <div className="p-6">
        <p role="alert">
          {query.isError
            ? errorMessage(query.error, 'Pesanan belum dapat dimuat.')
            : 'Pesanan tidak ditemukan.'}
        </p>
        <button onClick={() => void query.refetch()} className="my-3 rounded-xl border p-3">
          Coba lagi
        </button>
        <Link to="/dashboard?tab=orders" className="ml-3 underline">
          Kembali ke pesanan
        </Link>
      </div>
    )
  if (isPickupOrder(query.data)) return <PickupTrackingPage key={id} initialOrder={query.data} />
  return (
    <>
      <p className="mx-auto max-w-6xl rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        Pesanan alur lama: selesaikan sesuai kesepakatan awal.
      </p>
      <Suspense fallback={<Spinner />}>
        <LegacyOrderTrackingPage key={id} initialOrder={query.data} />
      </Suspense>
    </>
  )
}
