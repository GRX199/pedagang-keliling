import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Order } from '../../types/domain.types'
import { errorMessage } from '../../shared/lib/utils'
import { useOrderDetails, useUpdateOrderStatus } from './useOrders'
import type { OrderAction, OrderBundle } from './api'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useToast } from '../../shared/components/ToastProvider'
import {
  formatFulfillmentTypeLabel,
  formatOrderStatusLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatPriceLabel,
  formatRequestedFulfillmentLabel,
  getBuyerPaymentActions,
  getNextVendorStatusActions,
  getOrderOperationalNotice,
  getOrderPaymentDetails,
  getPaymentGuidance,
  getVendorPaymentActions,
} from '../../lib/orders'
import { getVendorPaymentMethodDetails } from '../../lib/vendor'
import OrderStatusTimeline from './components/PickupTimeline'
import OrderReviewComposer from './components/OrderReviewComposer'
import PickupLocationMap from '../map/components/PickupLocationMap'
import HandoverModal from './HandoverModal'

const panel =
  'min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4'
const button =
  'min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium disabled:opacity-50'

export default function PickupTrackingPage({
  initialOrder,
}: {
  initialOrder: Order
}) {
  const { user } = useAuth()
  const toast = useToast()
  const client = useQueryClient()
  const details = useOrderDetails(initialOrder)
  const { order, vendor, items, review, detailError } = details.data
  const mutation = useUpdateOrderStatus(order)
  const [confirmingHandover, setConfirmingHandover] = useState(false)
  const [pointDraft, setPointDraft] = useState<string | null>(null)
  const [collectorDraft, setCollectorDraft] = useState<string | null>(null)
  const busy = mutation.isPending
  const loadError = details.isError
  const buyer = order.buyer_id === user?.id
  const merchant = order.vendor_id === user?.id
  const active = ['pending', 'accepted', 'ready'].includes(order.status)
  const automaticPickupLocation =
    order.meeting_point_label?.startsWith('Lokasi pelanggan saat memesan;') ||
    order.meeting_point_label?.startsWith('Pelanggan mengambil ke pedagang;')
  const courierPickup = order.fulfillment_type === 'customer_courier'
  const payment = getVendorPaymentMethodDetails(
    getOrderPaymentDetails(order, vendor),
    order.payment_method,
  )

  async function run(action: OrderAction) {
    try {
      const updated = await mutation.execute(action)
      if (!updated) return
      setPointDraft(null)
      setCollectorDraft(null)
      setConfirmingHandover(false)
      toast.push('Pesanan diperbarui', { type: 'success' })
    } catch (error) {
      toast.push(errorMessage(error, 'Perubahan belum tersimpan.'), {
        type: 'error',
      })
    }
  }
  function change(field: 'status' | 'payment_status', value: string) {
    return run({ kind: field, value })
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-5">
      <HandoverModal
        open={confirmingHandover && merchant && order.status === 'ready'}
        cash={order.payment_method === 'cod'}
        disabled={
          busy ||
          !!loadError ||
          (order.payment_method !== 'cod' && order.payment_status !== 'paid')
        }
        onConfirm={() => void run({ kind: 'complete' })}
        onClose={() => setConfirmingHandover(false)}
      />
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            Pengambilan #{order.id.slice(0, 8)}
          </p>
          <h1 className="break-words text-xl font-semibold">
            {formatOrderStatusLabel(order)}
          </h1>
          <p className="break-words text-sm text-slate-600">
            {buyer ? order.vendor_name : order.buyer_name}
          </p>
        </div>
        <Link className={button} to="/dashboard?tab=orders">
          Pesanan
        </Link>
      </header>
      {loadError && (
        <p
          className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
        >
          Pembaruan tertunda. Periksa koneksi sebelum melakukan aksi.
        </p>
      )}
      {!loadError && detailError && (
        <p className="text-sm text-slate-500" role="status">
          Sebagian detail belum diperbarui. Mencoba lagi otomatis.
        </p>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <section className={panel}>
            <OrderStatusTimeline
              status={order.status}
              serviceFlow={order.service_flow}
            />
            {active && (
              <p className="text-sm text-slate-600">
                {getOrderOperationalNotice(
                  order,
                  merchant ? 'vendor' : 'customer',
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {merchant &&
                getNextVendorStatusActions(order).map((action) => (
                  <button
                    key={action.value}
                    className={`${button} ${action.value === 'rejected' ? 'text-rose-700' : 'bg-teal-700 text-white'}`}
                    disabled={busy || !!loadError}
                    onClick={() => change('status', action.value)}
                  >
                    {action.label}
                  </button>
                ))}
              {buyer && order.status === 'pending' && (
                <button
                  className={`${button} text-rose-700`}
                  disabled={busy || !!loadError}
                  onClick={() => change('status', 'cancelled')}
                >
                  Batalkan permintaan
                </button>
              )}
              {active && (
                <Link
                  className={button}
                  to={`/chat/${buyer ? order.vendor_id : order.buyer_id}?order=${order.id}`}
                >
                  Chat {buyer ? 'pedagang' : 'pelanggan'}
                </Link>
              )}
            </div>
            {merchant && order.status === 'ready' && (
              <div className="space-y-2">
                <p className="break-words text-sm text-slate-600">
                  Pengambil:{' '}
                  {order.collector_name ||
                    (order.fulfillment_type === 'self_pickup'
                      ? order.pickup_contact_name || order.buyer_name
                      : 'Kurir pelanggan')}
                </p>
                {order.payment_method !== 'cod' &&
                  order.payment_status !== 'paid' && (
                    <p className="text-sm text-slate-600">
                      Konfirmasi pembayaran lunas sebelum menyelesaikan pesanan.
                    </p>
                  )}
                <button
                  className={`${button} bg-teal-700 text-white`}
                  disabled={
                    busy ||
                    !!loadError ||
                    (order.payment_method !== 'cod' &&
                      order.payment_status !== 'paid')
                  }
                  onClick={() => setConfirmingHandover(true)}
                >
                  Selesaikan pesanan
                </button>
              </div>
            )}
          </section>
          <section className={panel}>
            <h2 className="font-semibold">
              {automaticPickupLocation || courierPickup
                ? 'Pengambilan'
                : order.status === 'pending'
                  ? 'Usulan titik pengambilan'
                  : 'Titik pengambilan'}
            </h2>
            <p className="break-words">{order.meeting_point_label}</p>
            <p className="text-sm text-slate-600">
              {formatFulfillmentTypeLabel(order.fulfillment_type)}
              {order.point_confirmed_at ? ' · Disetujui pedagang' : ''}
            </p>
            {order.requested_fulfillment_at && (
              <p className="text-sm">
                Waktu usulan:{' '}
                {formatRequestedFulfillmentLabel(
                  order.requested_fulfillment_at,
                )}
              </p>
            )}
            {buyer &&
              order.status === 'pending' &&
              !automaticPickupLocation &&
              !courierPickup && (
                <details>
                  <summary className="cursor-pointer py-2 text-sm text-teal-800">
                    Ubah usulan titik
                  </summary>
                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void run({
                        kind: 'details',
                        point: pointDraft ?? order.meeting_point_label ?? '',
                        expectedPoint: order.meeting_point_label,
                      })
                    }}
                  >
                    <label className="block text-sm">
                      Patokan titik
                      <input
                        required
                        maxLength={240}
                        value={pointDraft ?? order.meeting_point_label ?? ''}
                        onChange={(event) => setPointDraft(event.target.value)}
                        className="mt-1 w-full rounded-xl border p-3"
                      />
                    </label>
                    <p className="text-xs text-slate-500">
                      Mengubah patokan menghapus pin lama. Pilih titik yang
                      sesuai rute pedagang.
                    </p>
                    <button className={button} disabled={busy || !!loadError}>
                      Simpan usulan
                    </button>
                  </form>
                </details>
              )}
            {['accepted', 'ready'].includes(order.status) && (
              <p className="text-xs text-slate-500">
                Koordinasikan pengambilan dengan pedagang melalui chat.
              </p>
            )}
          </section>
          {buyer && order.status === 'ready' && (
            <section className={panel}>
              <h2 className="font-semibold">Serah terima barang</h2>
              <p className="break-words text-sm">
                Pengambil:{' '}
                {order.collector_name ||
                  (order.fulfillment_type === 'self_pickup'
                    ? order.pickup_contact_name || order.buyer_name
                    : 'Kurir pelanggan')}
              </p>
              {buyer && order.fulfillment_type === 'customer_courier' && (
                <details>
                  <summary className="cursor-pointer py-2 text-sm text-teal-800">
                    Tambah nama kurir (opsional)
                  </summary>
                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void run({
                        kind: 'details',
                        collector: collectorDraft ?? order.collector_name ?? '',
                      })
                    }}
                  >
                    <label className="block text-sm">
                      Nama pengambil
                      <input
                        required
                        maxLength={100}
                        value={collectorDraft ?? order.collector_name ?? ''}
                        onChange={(event) =>
                          setCollectorDraft(event.target.value)
                        }
                        className="mt-1 w-full rounded-xl border p-3"
                      />
                    </label>
                    <button className={button} disabled={busy || !!loadError}>
                      Simpan nama
                    </button>
                  </form>
                </details>
              )}
            </section>
          )}
          {order.status === 'completed' && (
            <section className={panel}>
              <OrderReviewComposer
                order={order}
                existingReview={review}
                viewerId={user?.id}
                buyerName={order.buyer_name}
                compact
                onSaved={(saved) =>
                  client.setQueryData<OrderBundle>(
                    ['order-details', user?.id, order.id],
                    (previous) =>
                      previous ? { ...previous, review: saved } : undefined,
                  )
                }
              />
            </section>
          )}
        </div>
        <aside className="min-w-0 space-y-4">
          <section className={panel}>
            <h2 className="font-semibold">Pembayaran barang</h2>
            <p className="text-xl font-semibold">
              {formatPriceLabel(order.total_amount)}
            </p>
            <p className="text-sm">
              {formatPaymentMethodLabel(order.payment_method)} ·{' '}
              {formatPaymentStatusLabel(order.payment_status)}
            </p>
            <p className="text-sm text-slate-600">
              {getPaymentGuidance(order, merchant ? 'vendor' : 'customer')}
            </p>
            {order.payment_method !== 'cod' &&
              ['accepted', 'ready'].includes(order.status) &&
              payment.ready && (
                <details>
                  <summary className="cursor-pointer py-2 text-sm text-teal-800">
                    Detail pembayaran
                  </summary>
                  {payment.imageUrl && (
                    <img
                      src={payment.imageUrl}
                      alt="QRIS pedagang"
                      className="my-3 max-h-64 w-full object-contain"
                    />
                  )}
                  {payment.rows.map((row) => (
                    <p key={row.label} className="my-2 break-all text-sm">
                      <span className="text-slate-500">{row.label}: </span>
                      {row.value}
                    </p>
                  ))}
                  {payment.note && (
                    <p className="break-words text-sm">{payment.note}</p>
                  )}
                </details>
              )}
            <div className="flex flex-wrap gap-2">
              {(merchant
                ? getVendorPaymentActions(order)
                : getBuyerPaymentActions(order)
              ).map((action) => (
                <button
                  className={button}
                  key={action.value}
                  disabled={busy || !!loadError}
                  onClick={() => change('payment_status', action.value)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </section>
          <details className={panel}>
            <summary className="cursor-pointer font-semibold">
              Rincian barang ({items.length})
            </summary>
            {items.map((item) => (
              <div key={item.id} className="break-words border-t py-2 text-sm">
                <p>
                  {item.product_name_snapshot} x {item.quantity}
                </p>
                <p>{formatPriceLabel(item.line_total)}</p>
                {item.item_note && (
                  <p className="text-slate-600">{item.item_note}</p>
                )}
              </div>
            ))}
            {order.customer_note && (
              <p className="break-words text-sm">
                Catatan: {order.customer_note}
              </p>
            )}
          </details>
        </aside>
        {active && (
          <div className="min-w-0 lg:col-span-2">
            <PickupLocationMap
              vendor={vendor}
              point={courierPickup ? null : order.meeting_point_location}
              pointLabel={
                automaticPickupLocation
                  ? 'Lokasi pelanggan saat memesan'
                  : 'Titik pengambilan'
              }
              vendorOnly={courierPickup}
            />
          </div>
        )}
      </div>
    </main>
  )
}
