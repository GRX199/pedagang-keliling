import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import OrderReviewComposer from './components/OrderReviewComposer'
import OrderStatusTimeline from './components/PickupTimeline'
import { useToast } from '../../shared/components/ToastProvider'
import { useAuth } from '../auth/AuthProvider'
import {
  formatFulfillmentTypeLabel,
  formatOrderTimingLabel,
  getBuyerPaymentActions,
  getNextVendorStatusActions,
  getPaymentGuidance,
  getOrderPaymentDetails,
  formatOrderStatusLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatPriceLabel,
  formatRequestedFulfillmentLabel,
  getOrderOperationalNotice,
  getVendorPaymentActions,
} from '../../lib/orders'
import { canBuyerReviewOrder } from '../../lib/reviews'
import {
  getVendorCoordinates,
  getVendorPaymentMethodDetails,
  isVendorPresenceFresh,
  formatVendorPresenceAge,
} from '../../lib/vendor'

import type { Order } from '../../types/domain.types'
import type { OrderAction } from './api'
import { useOrderDetails, useUpdateOrderStatus } from './useOrders'
import { usePresenceClock } from '../../shared/hooks/usePresenceClock'
import { useLiveViewerLocation } from '../../shared/hooks/useLiveViewerLocation'
import { errorMessage } from '../../shared/lib/utils'
import { haversineDistance } from '../map/map-model'
import { useDrivingRoute } from '../map/useDrivingRoute'
import LegacyTrackingMap from '../map/components/LegacyTrackingMap'
import { isActiveOrderStatus } from '../../lib/orders'

function formatDistance(value: number | null) {
  return value === null
    ? 'Belum tersedia'
    : value < 1000
      ? Math.round(value) + ' m'
      : (value / 1000).toFixed(1) + ' km'
}

export default function LegacyOrderTrackingPage({
  initialOrder,
}: {
  initialOrder: Order
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const details = useOrderDetails(initialOrder)
  const { order, vendor, items: orderItems, review, detailError } = details.data
  const mutation = useUpdateOrderStatus(order)
  const [showOrderItems, setShowOrderItems] = useState(false)
  const [showPaymentDetail, setShowPaymentDetail] = useState(false)
  const presenceClock = usePresenceClock([vendor])
  const vendorCoordinates = isVendorPresenceFresh(vendor, presenceClock)
    ? getVendorCoordinates(vendor?.location)
    : null
  const savedCustomerCoordinates =
    getVendorCoordinates(order.meeting_point_location) ||
    getVendorCoordinates(order.customer_location)
  const userLocation = useLiveViewerLocation(
    order.buyer_id === user?.id &&
      !savedCustomerCoordinates &&
      isActiveOrderStatus(order.status),
  )
  const customerCoordinates = savedCustomerCoordinates || userLocation
  const customerLocationLabel = order.meeting_point_label
    ? 'Titik temu: ' + order.meeting_point_label
    : userLocation
      ? 'Lokasi Anda saat ini'
      : 'Titik pelanggan'
  const vendorHasLiveLocation = !!vendorCoordinates
  const routeQuery = useDrivingRoute(vendorCoordinates, customerCoordinates)
  const road =
    !!vendorCoordinates &&
    !!customerCoordinates &&
    !!routeQuery.data &&
    !routeQuery.isError
  const routeData =
    road && routeQuery.data ? { ...routeQuery.data, mode: 'road' } : null
  const routeDistance =
    vendorCoordinates && customerCoordinates
      ? (routeData?.distanceMeters ??
        haversineDistance(
          vendorCoordinates.lat,
          vendorCoordinates.lng,
          customerCoordinates.lat,
          customerCoordinates.lng,
        ))
      : null
  const routeNotice =
    !vendorCoordinates || !customerCoordinates
      ? ''
      : routeQuery.isFetching
        ? 'Memperbarui rute jalan...'
        : routeQuery.isError
          ? 'Rute jalan belum tersedia. Garis putus-putus hanya menunjukkan jarak lurus.'
          : ''
  const busyAction =
    mutation.isPending &&
    mutation.variables &&
    (mutation.variables.kind === 'status' ||
      mutation.variables.kind === 'payment_status')
      ? (mutation.variables.kind === 'status' ? 'status:' : 'payment:') +
        mutation.variables.value
      : ''

  async function run(action: OrderAction) {
    if (details.isError) return
    try {
      const updated = await mutation.execute(action)
      if (updated) toast.push('Pesanan diperbarui', { type: 'success' })
    } catch (error) {
      toast.push(errorMessage(error, 'Perubahan belum tersimpan.'), {
        type: 'error',
      })
    }
  }
  const updatePaymentStatus = (value: string) =>
    run({ kind: 'payment_status', value })
  const updateOrderStatus = (value: string) => run({ kind: 'status', value })

  const partnerId =
    order.buyer_id === user?.id ? order.vendor_id : order.buyer_id
  const isVendorViewer = user?.id === order.vendor_id
  const isBuyerViewer = user?.id === order.buyer_id
  const paymentGuidance = getPaymentGuidance(
    order,
    isVendorViewer ? 'vendor' : 'customer',
  )
  const paymentActions = isVendorViewer
    ? getVendorPaymentActions(order)
    : isBuyerViewer
      ? getBuyerPaymentActions(order)
      : []
  const vendorStatusActions = isVendorViewer
    ? getNextVendorStatusActions(order)
    : []
  const headerPaymentActions = isVendorViewer ? [] : paymentActions
  const hasVendorTrackingActions =
    isVendorViewer &&
    (vendorStatusActions.length > 0 || paymentActions.length > 0)
  const operationalNotice = getOrderOperationalNotice(
    order,
    isVendorViewer ? 'vendor' : 'customer',
  )
  const paymentReferenceDetails = getVendorPaymentMethodDetails(
    getOrderPaymentDetails(order, vendor),
    order.payment_method,
  )
  const canShowReviewComposer = canBuyerReviewOrder(order, user?.id)
  const routeReady = Boolean(vendorCoordinates && customerCoordinates)
  const isPreorder = order.order_timing === 'preorder'
  const visibleOrderItems = showOrderItems ? orderItems : orderItems.slice(0, 2)

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl space-y-4 overflow-x-hidden px-3 py-5 sm:px-4 sm:py-6">
        <section className="min-w-0 rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 sm:text-xs sm:tracking-[0.22em]">
                Tracking Pesanan
              </div>
              <h1 className="mt-1 text-xl font-semibold text-slate-900 sm:mt-2 sm:text-2xl">
                Pesanan #{String(order.id).slice(0, 8)}
              </h1>
              <p className="mt-2 hidden text-sm leading-6 text-slate-500 sm:block">
                Pantau status, peta, dan transaksi dari satu layar.
              </p>
            </div>

            <div className="flex w-full gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible">
              {headerPaymentActions.map((action) => (
                <button
                  key={action.value}
                  onClick={() => updatePaymentStatus(action.value)}
                  disabled={mutation.isPending || details.isError}
                  className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium leading-tight ${
                    action.tone === 'danger'
                      ? 'border border-red-200 bg-red-50 text-red-600'
                      : action.tone === 'success'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-900 text-white'
                  } disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  {busyAction === `payment:${action.value}`
                    ? 'Menyimpan...'
                    : action.label}
                </button>
              ))}
              {(isVendorViewer || isBuyerViewer) && (
                <button
                  onClick={() =>
                    navigate(`/chat/${partnerId}?order=${order.id}`)
                  }
                  className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 px-4 py-2.5 text-sm font-medium leading-tight text-slate-700"
                >
                  Chat
                </button>
              )}
            </div>
          </div>
          {details.isError ? (
            <p role="alert" className="mt-2 text-sm text-rose-700">
              Pembaruan tertunda. Periksa koneksi sebelum melakukan aksi.
            </p>
          ) : detailError ? (
            <p role="status" className="mt-2 text-xs text-amber-700">
              Sebagian detail belum diperbarui. Mencoba lagi otomatis.
            </p>
          ) : null}
        </section>

        {hasVendorTrackingActions ? (
          <section className="min-w-0 rounded-[22px] bg-slate-950 p-3 text-white shadow-sm ring-1 ring-slate-800 sm:rounded-[28px] sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Aksi pedagang</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Ubah progres pesanan dari halaman tracking ini.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
                {formatOrderStatusLabel(order.status)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {vendorStatusActions.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  disabled={
                    action.disabled || mutation.isPending || details.isError
                  }
                  onClick={() => updateOrderStatus(action.value)}
                  title={action.disabledReason || action.label}
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${
                    action.disabled
                      ? 'border border-amber-300/30 bg-amber-300/10 text-amber-100'
                      : action.tone === 'danger'
                        ? 'border border-red-300/30 bg-red-400/10 text-red-100 hover:bg-red-400/20'
                        : action.tone === 'success'
                          ? 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300'
                          : 'bg-white text-slate-950 hover:bg-slate-100'
                  }`}
                >
                  {busyAction === `status:${action.value}`
                    ? 'Menyimpan...'
                    : action.label}
                </button>
              ))}

              {paymentActions.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  onClick={() => updatePaymentStatus(action.value)}
                  disabled={mutation.isPending || details.isError}
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${
                    action.tone === 'danger'
                      ? 'border border-red-300/30 bg-red-400/10 text-red-100 hover:bg-red-400/20'
                      : 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300'
                  }`}
                >
                  {busyAction === `payment:${action.value}`
                    ? 'Menyimpan...'
                    : action.label}
                </button>
              ))}
            </div>

            {vendorStatusActions.some(
              (action) => action.disabled && action.disabledReason,
            ) ? (
              <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                {
                  vendorStatusActions.find(
                    (action) => action.disabled && action.disabledReason,
                  )?.disabledReason
                }
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="grid min-w-0 grid-cols-3 gap-2 sm:gap-4">
          <div className="min-w-0 rounded-[18px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[24px] sm:p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.16em]">
              Status
            </div>
            <div className="mt-2 break-words text-base font-semibold leading-tight text-slate-900 sm:text-lg">
              {formatOrderStatusLabel(order.status)}
            </div>
            <div className="mt-1 hidden text-xs text-slate-500 sm:block">
              {routeReady
                ? routeData?.mode === 'road'
                  ? 'Peta dan rute jalan aktif diperbarui di background'
                  : 'Tracking aktif dengan fallback garis lurus'
                : 'Tracking akan lengkap setelah kedua posisi tersedia'}
            </div>
          </div>
          <div className="min-w-0 rounded-[18px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[24px] sm:p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.16em]">
              Jarak
            </div>
            <div className="mt-2 break-words text-base font-semibold leading-tight text-slate-900 sm:text-lg">
              {formatDistance(routeDistance)}
            </div>
            <div className="mt-1 hidden text-xs text-slate-500 sm:block">
              {routeReady
                ? 'Dihitung dari dua titik aktif di peta'
                : 'Menunggu data lokasi lengkap'}
            </div>
          </div>
          <div className="min-w-0 rounded-[18px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[24px] sm:p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.16em]">
              Lokasi
            </div>
            <div className="mt-2 break-words text-base font-semibold leading-tight text-slate-900 sm:text-lg">
              {vendorHasLiveLocation
                ? formatVendorPresenceAge(vendor, presenceClock)
                : 'Tidak aktif'}
            </div>
            <div className="mt-1 hidden text-xs text-slate-500 sm:block">
              Tidak ada estimasi waktu tiba otomatis.
            </div>
          </div>
        </section>

        <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_360px]">
          <div className="min-w-0 space-y-4">
            <div className="overflow-hidden rounded-[22px] bg-white p-2 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px]">
              <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-1 text-xs text-slate-500">
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-emerald-500" />
                    Pedagang
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-sky-500" />
                    Pelanggan
                  </span>
                </div>
                <span className="hidden text-right sm:inline">
                  {routeReady
                    ? routeData?.mode === 'road'
                      ? 'Rute mengikuti jalan yang tersedia saat ini'
                      : 'Menampilkan garis lurus cadangan'
                    : 'Menunggu dua titik lengkap'}
                </span>
              </div>
              <div className="relative">
                <LegacyTrackingMap
                  vendorPoint={vendorCoordinates}
                  customerPoint={customerCoordinates}
                  vendorName={vendor?.name || order.vendor_name || 'Pedagang'}
                  customerLabel={customerLocationLabel}
                  route={routeData?.latLngs || null}
                  road={road}
                />
              </div>
              {routeNotice && (
                <div className="px-3 pb-2 text-xs text-slate-500">
                  {routeNotice}
                </div>
              )}
            </div>

            <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
              <OrderStatusTimeline status={order.status} />
            </div>

            <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
              <h2 className="text-lg font-semibold text-slate-900">
                Item Pesanan
              </h2>
              <div className="mt-4 space-y-3">
                {orderItems.length > 0 ? (
                  visibleOrderItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 py-3 last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="break-words font-medium text-slate-900">
                          {item.product_name_snapshot}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {item.quantity} item
                        </div>
                        {item.item_note && (
                          <div className="mt-1 break-words text-sm text-slate-600">
                            {item.item_note}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-sm font-medium text-slate-700">
                        {formatPriceLabel(
                          item.line_total || item.price_snapshot,
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                    {order.items || 'Belum ada detail item.'}
                  </div>
                )}
              </div>
              {orderItems.length > 2 && (
                <button
                  type="button"
                  onClick={() => setShowOrderItems((current) => !current)}
                  className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {showOrderItems
                    ? 'Tampilkan lebih sedikit'
                    : `Lihat ${orderItems.length - 2} item lainnya`}
                </button>
              )}
            </div>

            {(canShowReviewComposer || review) && (
              <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
                <OrderReviewComposer
                  order={order}
                  existingReview={review}
                  viewerId={user?.id}
                  buyerName={
                    user?.user_metadata?.full_name || user?.email || 'Pelanggan'
                  }
                  compact
                />
              </div>
            )}
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
              <h2 className="text-lg font-semibold text-slate-900">
                Ringkasan
              </h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    Pedagang
                  </div>
                  <div className="mt-1 break-words font-medium text-slate-900">
                    {order.vendor_name || vendor?.name || 'Pedagang'}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    Pembayaran
                  </div>
                  <div className="mt-1 break-words font-medium text-slate-900">
                    {formatPaymentMethodLabel(order.payment_method)} •{' '}
                    {formatPaymentStatusLabel(order.payment_status)}
                  </div>
                  {paymentGuidance && (
                    <div className="mt-2 break-words text-sm leading-6 text-slate-500">
                      {paymentGuidance}
                    </div>
                  )}
                  {operationalNotice && (
                    <div className="mt-3 break-words rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {operationalNotice}
                    </div>
                  )}
                  {order.payment_method !== 'cod' && (
                    <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          Detail bayar
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setShowPaymentDetail((current) => !current)
                          }
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 sm:hidden"
                        >
                          {showPaymentDetail ? 'Tutup' : 'Buka'}
                        </button>
                      </div>
                      {paymentReferenceDetails.ready ? (
                        <div
                          className={`${showPaymentDetail ? 'mt-2 block' : 'hidden'} space-y-3 sm:mt-2 sm:block`}
                        >
                          <div className="break-words text-sm text-slate-600">
                            {paymentReferenceDetails.description}
                          </div>
                          {paymentReferenceDetails.imageUrl && (
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
                              <img
                                src={paymentReferenceDetails.imageUrl}
                                alt={paymentReferenceDetails.title}
                                className="h-44 w-full rounded-xl object-contain sm:h-56"
                              />
                            </div>
                          )}
                          {paymentReferenceDetails.rows.map((row) => (
                            <div key={row.label}>
                              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">
                                {row.label}
                              </div>
                              <div className="mt-1 break-words font-medium text-slate-900">
                                {row.value}
                              </div>
                            </div>
                          ))}
                          {paymentReferenceDetails.note && (
                            <div className="break-words rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                              Catatan pedagang: {paymentReferenceDetails.note}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 break-words text-sm text-slate-500">
                          Pedagang belum menyiapkan detail pembayaran untuk
                          metode ini. Lanjutkan koordinasi lewat chat.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    Serah terima
                  </div>
                  <div className="mt-1 break-words font-medium text-slate-900">
                    {formatFulfillmentTypeLabel(order.fulfillment_type)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    Mode pesanan
                  </div>
                  <div className="mt-1 break-words font-medium text-slate-900">
                    {formatOrderTimingLabel(order.order_timing)}
                  </div>
                </div>
                {order.requested_fulfillment_at && (
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                      Jadwal
                    </div>
                    <div className="mt-1 break-words font-medium text-slate-900">
                      {formatRequestedFulfillmentLabel(
                        order.requested_fulfillment_at,
                      )}
                    </div>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    {isPreorder ? 'Area titip' : 'Titik temu'}
                  </div>
                  <div className="mt-1 break-words font-medium text-slate-900">
                    {order.meeting_point_label || 'Belum diisi'}
                  </div>
                </div>
                {order.customer_note && (
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                      Catatan
                    </div>
                    <div className="mt-1 break-words text-slate-700">
                      {order.customer_note}
                    </div>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    Total
                  </div>
                  <div className="mt-1 break-words font-medium text-slate-900">
                    {Number(order.total_amount || 0) > 0
                      ? formatPriceLabel(order.total_amount)
                      : 'Menyesuaikan harga produk'}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}
