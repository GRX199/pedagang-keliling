import { useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Order, Role } from '../../types/domain.types'
import { useNavigate } from 'react-router-dom'
import { useOrders, type OrderListItem } from './useOrders'
import { useToast } from '../../shared/components/ToastProvider'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { errorMessage } from '../../shared/lib/utils'
import { useDebounce } from '../../shared/hooks/useDebounce'
import { SyncStatus } from '../../shared/components/SyncStatus'
import { reportError } from '../../shared/lib/error-reporting'
import OrderReviewComposer from './components/OrderReviewComposer'
import { isPickupOrder } from '../../lib/pickup'
import {
  formatOrderStatusLabel,
  formatFulfillmentTypeLabel,
  formatOrderTimingLabel,
  getBuyerPaymentActions,
  getPaymentGuidance,
  getVendorPaymentActions,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatPriceLabel,
  formatRequestedFulfillmentLabel,
  getNextVendorStatusActions,
  getOrderOperationalNotice,
  getOrderStatusTone,
  isActiveOrderStatus
} from '../../lib/orders'

function HistoryFilterButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? 'bg-slate-900 text-white'
          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

export default function OrdersPanel({
  currentUser,
  role
}: {
  currentUser: User
  role: Role
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const [historyFilter, setHistoryFilter] = useState('all')
  const [historyQuery, setHistoryQuery] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const search = useDebounce(historyQuery.trim(), 350)
  const orderQuery = useOrders(currentUser?.id, role)
  const history = useOrders(currentUser?.id, role, {
    scope: 'history',
    status: historyFilter,
    search,
    enabled: showHistory
  })
  const orders = [...orderQuery.orders, ...history.orders]
  const { setOrders } = orderQuery
  const loading = orderQuery.isPending
  const [expandedOrderIds, setExpandedOrderIds] = useState<string[]>([])
  const [busyOrderIds, setBusyOrderIds] = useState<string[]>([])
  const pendingOrdersRef = useRef(new Set<string>())

  const isVendor = role === 'vendor'
  const customerName =
    currentUser?.user_metadata?.full_name || currentUser?.email || 'Pelanggan'

  function isOrderExpanded(orderId: string) {
    return expandedOrderIds.includes(orderId)
  }

  function toggleOrderDetails(orderId: string) {
    setExpandedOrderIds((current) =>
      current.includes(orderId)
        ? current.filter((item) => item !== orderId)
        : [...current, orderId]
    )
  }

  function getOrderHistoryTimestamp(order: Order) {
    return (
      order?.completed_at ||
      order?.cancelled_at ||
      order?.rejected_at ||
      order?.updated_at ||
      order?.created_at ||
      null
    )
  }

  function formatOrderHistoryLabel(order: Order) {
    const timestamp = getOrderHistoryTimestamp(order)
    if (!timestamp) return 'Riwayat tersimpan'

    const formattedDate = new Date(timestamp).toLocaleString('id-ID')
    if (order.status === 'completed') return `Selesai pada ${formattedDate}`
    if (order.status === 'cancelled') return `Dibatalkan pada ${formattedDate}`
    if (order.status === 'rejected') return `Ditolak pada ${formattedDate}`
    return `Diperbarui pada ${formattedDate}`
  }

  async function fetchOrders() {
    await orderQuery.refetch()
  }

  async function mutateOrder(
    order: Order | undefined,
    field: 'status' | 'payment_status',
    value: string
  ) {
    if (!order?.id || pendingOrdersRef.current.has(order.id)) return
    pendingOrdersRef.current.add(order.id)
    setBusyOrderIds((current) => [...current, order.id])
    try {
      await orderQuery.updateOrder({ order, action: { kind: field, value } })
      toast.push(
        field === 'payment_status'
          ? 'Status pembayaran diperbarui'
          : 'Status pesanan diperbarui',
        { type: 'success' }
      )
    } catch (error) {
      void reportError(error, 'orders')
      toast.push(errorMessage(error) || 'Gagal memperbarui pesanan', {
        type: 'error'
      })
    } finally {
      await fetchOrders()
      pendingOrdersRef.current.delete(order.id)
      setBusyOrderIds((current) =>
        current.filter((orderId) => orderId !== order.id)
      )
    }
  }

  function updateStatus(order: Order, status: string) {
    return mutateOrder(order, 'status', status)
  }

  function updatePaymentStatus(orderId: string, paymentStatus: string) {
    return mutateOrder(
      orders.find((order) => order.id === orderId),
      'payment_status',
      paymentStatus
    )
  }

  function renderOrderItems(order: OrderListItem) {
    if (Array.isArray(order.order_items) && order.order_items.length > 0) {
      const visibleItems = order.order_items.slice(0, 2)
      const hiddenItemsCount = order.order_items.length - visibleItems.length

      return (
        <div className="min-w-0 space-y-1 text-sm text-slate-600">
          {visibleItems.map((item) => (
            <div key={item.id} className="truncate">
              {item.product_name_snapshot} x{item.quantity}
              {item.item_note ? ` • ${item.item_note}` : ''}
            </div>
          ))}
          {hiddenItemsCount > 0 && (
            <div className="text-xs font-medium text-slate-400">
              +{hiddenItemsCount} item lain
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-600">
        {order.items || '-'}
      </div>
    )
  }

  function renderOrderCard(
    order: OrderListItem,
    variant: 'active' | 'history' = 'active'
  ) {
    const title = isVendor
      ? order.buyer_name || 'Pelanggan'
      : order.vendor_name || 'Pedagang'
    const isHighlighted = variant === 'active'
    const isHistoryCard = variant === 'history'
    const isExpanded = isOrderExpanded(order.id)
    const vendorPaymentActions = isVendor ? getVendorPaymentActions(order) : []
    const buyerPaymentActions = !isVendor ? getBuyerPaymentActions(order) : []
    const vendorStatusActions = isVendor
      ? getNextVendorStatusActions(order)
      : []
    const paymentGuidance = getPaymentGuidance(
      order,
      isVendor ? 'vendor' : 'customer'
    )
    const operationalNotice = getOrderOperationalNotice(
      order,
      isVendor ? 'vendor' : 'customer'
    )
    const historyLabel = isHistoryCard ? formatOrderHistoryLabel(order) : ''
    const primaryActionLabel = isHistoryCard
      ? 'Buka'
      : isPickupOrder(order)
        ? order.status === 'ready'
          ? 'Serah terima'
          : 'Detail'
        : 'Lacak (lama)'
    const isPreorder = order.order_timing === 'preorder'
    const totalAmount = Number(order.total_amount || 0)
    const hasFollowUpActions = isVendor
      ? vendorStatusActions.length > 0 || vendorPaymentActions.length > 0
      : buyerPaymentActions.length > 0 || order.status === 'pending'
    const detailsButtonLabel = isExpanded
      ? 'Tutup'
      : !isVendor && order.status === 'completed' && !order.review
        ? 'Ulasan'
        : hasFollowUpActions
          ? 'Aksi'
          : 'Detail'
    const actionButtonBase =
      'rounded-full px-4 py-2.5 text-center text-sm font-medium leading-tight transition'
    const detailActionButtonBase =
      'w-full rounded-xl px-3 py-2 text-center text-sm font-medium leading-tight transition disabled:cursor-wait disabled:opacity-60 sm:w-auto'

    return (
      <div
        key={order.id}
        data-order-id={order.id}
        className={`min-w-0 max-w-full overflow-hidden rounded-[20px] border p-3 transition sm:rounded-[24px] sm:p-4 ${
          isHighlighted
            ? 'border-slate-900/10 bg-white shadow-sm'
            : 'border-slate-200 bg-white'
        }`}
      >
        <div className="space-y-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {isVendor ? 'Pelanggan' : 'Pedagang'}
              </div>
              <div className="mt-1 truncate text-base font-semibold text-slate-900">
                {title}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-center text-[11px] font-semibold uppercase leading-tight tracking-wide ${getOrderStatusTone(order.status)}`}
            >
              {formatOrderStatusLabel(order)}
            </span>
          </div>

          <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">{renderOrderItems(order)}</div>
              {totalAmount > 0 && (
                <div className="shrink-0 text-right text-sm font-semibold text-slate-900">
                  {formatPriceLabel(totalAmount)}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap gap-2 text-xs text-slate-500">
            <span className="max-w-full break-words rounded-full bg-slate-100 px-3 py-1 leading-tight">
              {formatPaymentMethodLabel(order.payment_method)}
            </span>
            <span className="max-w-full break-words rounded-full bg-slate-100 px-3 py-1 leading-tight">
              {formatPaymentStatusLabel(order.payment_status)}
            </span>
            {order.fulfillment_type && (
              <span className="max-w-full break-words rounded-full bg-slate-100 px-3 py-1 leading-tight">
                {formatFulfillmentTypeLabel(order.fulfillment_type)}
              </span>
            )}
            {order.order_timing && (
              <span
                className={`max-w-full break-words rounded-full px-3 py-1 leading-tight ${
                  isPreorder
                    ? 'bg-sky-50 text-sky-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {formatOrderTimingLabel(order.order_timing)}
              </span>
            )}
            {!isVendor && order.review && (
              <span className="max-w-full break-words rounded-full bg-amber-50 px-3 py-1 leading-tight text-amber-700">
                Sudah diulas
              </span>
            )}
          </div>

          {operationalNotice && !isExpanded && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {operationalNotice}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              onClick={() => navigate(`/orders/${order.id}`)}
              className={`${actionButtonBase} w-full sm:w-auto ${
                isHighlighted
                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {primaryActionLabel}
            </button>
            <button
              type="button"
              onClick={() => toggleOrderDetails(order.id)}
              className={`${actionButtonBase} w-full border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 sm:w-auto`}
            >
              {detailsButtonLabel}
            </button>
          </div>

          {isExpanded && (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button
                  onClick={() =>
                    navigate(
                      `/chat/${isVendor ? order.buyer_id : order.vendor_id}?order=${order.id}`
                    )
                  }
                  className={`${detailActionButtonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-100`}
                >
                  Chat
                </button>

                {isVendor &&
                  vendorStatusActions.map((action) => (
                    <button
                      key={action.value}
                      disabled={
                        action.disabled || busyOrderIds.includes(order.id)
                      }
                      onClick={() => updateStatus(order, action.value)}
                      title={action.disabledReason || action.label}
                      className={`${detailActionButtonBase} ${
                        action.disabled
                          ? 'cursor-not-allowed border border-amber-200 bg-amber-50 text-amber-700 opacity-80'
                          : action.tone === 'danger'
                            ? 'border border-red-200 bg-red-50 text-red-600'
                            : action.tone === 'success'
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                              : 'bg-slate-900 text-white hover:bg-slate-800'
                      }`}
                    >
                      {action.label}
                    </button>
                  ))}

                {vendorPaymentActions.map((action) => (
                  <button
                    key={action.value}
                    onClick={() => updatePaymentStatus(order.id, action.value)}
                    disabled={busyOrderIds.includes(order.id)}
                    className={`${detailActionButtonBase} ${
                      action.tone === 'danger'
                        ? 'border border-red-200 bg-red-50 text-red-600'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {action.label}
                  </button>
                ))}

                {!isVendor && order.status === 'pending' && (
                  <button
                    onClick={() => updateStatus(order, 'cancelled')}
                    disabled={busyOrderIds.includes(order.id)}
                    className={`${detailActionButtonBase} border border-red-200 bg-red-50 text-red-600 hover:bg-red-100`}
                  >
                    Batalkan
                  </button>
                )}

                {buyerPaymentActions.map((action) => (
                  <button
                    key={action.value}
                    onClick={() => updatePaymentStatus(order.id, action.value)}
                    disabled={busyOrderIds.includes(order.id)}
                    className={`${detailActionButtonBase} bg-slate-900 text-white hover:bg-slate-800`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>

              {historyLabel && (
                <div className="break-words font-medium text-slate-700">
                  {historyLabel}
                </div>
              )}
              {paymentGuidance && (
                <div className="break-words">Pembayaran: {paymentGuidance}</div>
              )}
              {operationalNotice && (
                <div className="break-words rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-amber-800">
                  {operationalNotice}
                </div>
              )}
              {order.requested_fulfillment_at && (
                <div className="break-words">
                  Jadwal: sekitar{' '}
                  {formatRequestedFulfillmentLabel(
                    order.requested_fulfillment_at
                  )}
                </div>
              )}
              {order.meeting_point_label && (
                <div className="break-words">
                  {isPreorder ? 'Area titip: ' : 'Titik temu: '}
                  {order.meeting_point_label}
                </div>
              )}
              {order.customer_note && (
                <div className="break-words">
                  Catatan: {order.customer_note}
                </div>
              )}
              <div className="text-xs text-slate-400">
                Dibuat:{' '}
                {order.created_at
                  ? new Date(order.created_at).toLocaleString('id-ID')
                  : '-'}
              </div>

              {!isVendor && order.status === 'completed' && (
                <OrderReviewComposer
                  order={order}
                  existingReview={order.review}
                  viewerId={currentUser?.id}
                  buyerName={customerName}
                  onSaved={(review) => {
                    setOrders((current) =>
                      current.map((item) =>
                        item.id === order.id ? { ...item, review } : item
                      )
                    )
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-[28px] bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/80">
        {orderQuery.fetchStatus === 'paused'
          ? 'Sambungkan koneksi untuk memuat pesanan.'
          : 'Memuat pesanan...'}
      </div>
    )
  }

  if (orderQuery.error && !orderQuery.data) {
    return (
      <Card>
        <p role="alert" className="mb-3 text-sm text-amber-800">
          Pesanan belum dapat dimuat.
        </p>
        <Button
          onClick={() => {
            void orderQuery.refetch()
          }}
        >
          Coba lagi
        </Button>
      </Card>
    )
  }

  const activeOrders = orderQuery.orders.filter((order) =>
    isActiveOrderStatus(order.status)
  )
  const historyOrders = history.orders.filter(
    (order) => !isActiveOrderStatus(order.status)
  )
  const historyFilterOptions = [
    { value: 'all', label: 'Semua' },
    { value: 'completed', label: 'Selesai' },
    { value: 'cancelled', label: 'Dibatalkan' },
    { value: 'rejected', label: 'Ditolak' }
  ]
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
      {orderQuery.error ? (
        <p role="alert" className="mb-3 text-sm text-amber-800">
          Pembaruan pesanan tertunda. Data terakhir tetap ditampilkan.
        </p>
      ) : null}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Pesanan</h3>
          <p className="text-sm leading-5 text-slate-500 sm:block">
            {isVendor
              ? 'Order masuk dan status transaksi.'
              : 'Order aktif dan riwayat transaksi.'}
          </p>
        </div>

        <div className="shrink-0 rounded-full bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
          <SyncStatus
            failed={orderQuery.isError}
            updatedAt={orderQuery.dataUpdatedAt}
            connection={orderQuery.connection}
          />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 text-sm">
        <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-900 px-3 py-2 font-medium text-white">
          Aktif{' '}
          <strong>
            {activeOrders.length}
            {orderQuery.hasNextPage ? '+' : ''}
          </strong>
        </div>
      </div>

      {
        <div className="mt-5 space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {isVendor ? 'Order Aktif' : 'Pesanan Aktif'}
                </h4>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {activeOrders.length}
                {orderQuery.hasNextPage ? '+' : ''} aktif
              </span>
            </div>

            {activeOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                {isVendor
                  ? 'Tidak ada order aktif saat ini.'
                  : 'Tidak ada pesanan aktif saat ini.'}
              </div>
            ) : (
              <div className="space-y-3">
                {activeOrders.map((order) => renderOrderCard(order, 'active'))}
                {orderQuery.hasNextPage && (
                  <Button
                    disabled={orderQuery.isFetching}
                    onClick={() => void orderQuery.fetchNextPage()}
                  >
                    {orderQuery.isFetchingNextPage
                      ? 'Memuat...'
                      : 'Pesanan aktif lainnya'}
                  </Button>
                )}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Riwayat
                </h4>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowHistory((current) => !current)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {showHistory ? 'Sembunyikan' : 'Buka'}
                </button>
              </div>
            </div>

            {!showHistory ? null : (
              <div className="space-y-4">
                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-3">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div>
                      <label
                        htmlFor="order-history-search"
                        className="text-sm font-medium text-slate-700"
                      >
                        Cari riwayat
                      </label>
                      <input
                        id="order-history-search"
                        value={historyQuery}
                        onChange={(event) =>
                          setHistoryQuery(event.target.value)
                        }
                        placeholder="Cari riwayat..."
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                      />
                    </div>

                    <div>
                      <div className="text-sm font-medium text-slate-700">
                        Filter hasil akhir
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {historyFilterOptions.map((option) => (
                          <HistoryFilterButton
                            key={option.value}
                            active={historyFilter === option.value}
                            onClick={() => setHistoryFilter(option.value)}
                          >
                            {option.label}
                          </HistoryFilterButton>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {history.error && (
                  <p role="alert" className="text-sm text-amber-800">
                    Riwayat belum diperbarui.{' '}
                    <button
                      className="min-h-11 underline"
                      onClick={() => void history.refetch()}
                    >
                      Coba lagi
                    </button>
                  </p>
                )}
                {history.isPending ? (
                  <p role="status" className="text-sm text-slate-500">
                    {history.fetchStatus === 'paused'
                      ? 'Sambungkan koneksi untuk memuat riwayat.'
                      : 'Memuat riwayat...'}
                  </p>
                ) : historyOrders.length === 0 && !history.error ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    Tidak ada riwayat yang cocok dengan pencarian atau filter
                    ini.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {historyOrders.map((order) =>
                      renderOrderCard(order, 'history')
                    )}
                    {history.hasNextPage && (
                      <Button
                        disabled={history.isFetching}
                        onClick={() => void history.fetchNextPage()}
                      >
                        {history.isFetchingNextPage
                          ? 'Memuat...'
                          : 'Riwayat lainnya'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      }
    </div>
  )
}
