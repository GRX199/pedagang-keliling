import React, { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AdminPanel from '../components/AdminPanel'
import ChatWorkspace from '../components/ChatWorkspace'
import OrderReviewComposer from '../components/OrderReviewComposer'
import VendorProductsManager from '../components/VendorProductsManager'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import { uploadImageFile } from '../lib/media'
import { getGeolocationErrorMessage } from '../lib/network'
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
  isActiveOrderStatus,
  isHistoryOrderStatus,
  isSchemaCompatibilityError,
} from '../lib/orders'
import { getReviewSummary } from '../lib/reviews'
import { syncCurrentProfile } from '../lib/profiles'
import { supabase } from '../lib/supabase'
import {
  buildVendorPaymentDetailsPayload,
  buildOperatingHoursPayload,
  formatVendorCategoryLabel,
  formatVendorPromoExpiry,
  getVendorPaymentMethodDetails,
  getVendorPaymentSetupSummary,
  formatVendorServiceMode,
  formatVendorServiceRadius,
  createVendorLocationPayload,
  getDisplayName,
  getOperatingHoursText,
  getVendorLocationLabel,
  getVendorLocationUpdatedAtLabel,
  getVendorPromoText,
  isVendorPromoActive,
  normalizeVendorPaymentDetails,
} from '../lib/vendor'

function TabButton({ id, active, onClick, children }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-medium transition ${
        active ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function OrdersSummaryCard({ label, value, hint, tone = 'default' }) {
  const toneClass = tone === 'primary'
    ? 'bg-slate-900 text-white'
    : tone === 'success'
      ? 'bg-emerald-50 text-slate-900 ring-1 ring-emerald-100'
      : 'bg-slate-50 text-slate-900 ring-1 ring-slate-200'

  const hintClass = tone === 'primary' ? 'text-slate-300' : 'text-slate-500'

  return (
    <div className={`min-w-0 rounded-[20px] p-3 sm:rounded-[24px] sm:p-4 ${toneClass}`}>
      <div className="break-words text-xs font-medium uppercase tracking-[0.16em] opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className={`mt-1 text-sm leading-5 ${hintClass}`}>{hint}</div>
    </div>
  )
}

function HistoryFilterButton({ active, onClick, children }) {
  return (
    <button
      type="button"
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

function OrdersPanel({ currentUser, role }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('all')
  const [historyQuery, setHistoryQuery] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const isVendor = role === 'vendor'
  const customerName = currentUser?.user_metadata?.full_name || currentUser?.email || 'Pelanggan'

  function getOrderHistoryTimestamp(order) {
    return order?.completed_at || order?.cancelled_at || order?.rejected_at || order?.updated_at || order?.created_at || null
  }

  function formatOrderHistoryLabel(order) {
    const timestamp = getOrderHistoryTimestamp(order)
    if (!timestamp) return 'Riwayat tersimpan'

    const formattedDate = new Date(timestamp).toLocaleString('id-ID')
    if (order.status === 'completed') return `Selesai pada ${formattedDate}`
    if (order.status === 'cancelled') return `Dibatalkan pada ${formattedDate}`
    if (order.status === 'rejected') return `Ditolak pada ${formattedDate}`
    return `Diperbarui pada ${formattedDate}`
  }

  function getOrderSearchText(order) {
    const itemText = Array.isArray(order.order_items) && order.order_items.length > 0
      ? order.order_items.map((item) => `${item.product_name_snapshot || ''} ${item.item_note || ''}`).join(' ')
      : String(order.items || '')

    return [
      order.vendor_name,
      order.buyer_name,
      order.order_timing,
      order.requested_fulfillment_at,
      order.meeting_point_label,
      order.customer_note,
      itemText,
    ].join(' ').toLowerCase()
  }

  async function fetchOrders({ background = false, silent = false } = {}) {
    if (!currentUser || !role) return

    if (background) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    try {
      let query = supabase.from('orders').select('*').order('created_at', { ascending: false })
      query = role === 'vendor'
        ? query.eq('vendor_id', currentUser.id)
        : query.eq('buyer_id', currentUser.id)

      const { data, error } = await query
      if (error) throw error

      let nextOrders = data || []
      const orderIds = nextOrders.map((order) => order.id).filter(Boolean)

      try {
        if (orderIds.length > 0) {
          const { data: orderItems, error: orderItemsError } = await supabase
            .from('order_items')
            .select('*')
            .in('order_id', orderIds)
            .order('created_at', { ascending: true })

          if (orderItemsError) throw orderItemsError

          const itemsMap = (orderItems || []).reduce((accumulator, item) => {
            if (!accumulator[item.order_id]) accumulator[item.order_id] = []
            accumulator[item.order_id].push(item)
            return accumulator
          }, {})

          nextOrders = nextOrders.map((order) => ({
            ...order,
            order_items: itemsMap[order.id] || [],
          }))
        }
      } catch (orderItemsError) {
        if (!isSchemaCompatibilityError(orderItemsError)) {
          console.error('fetchOrders.orderItems', orderItemsError)
        }
      }

      try {
        if (orderIds.length > 0) {
          const { data: reviews, error: reviewsError } = await supabase
            .from('reviews')
            .select('*')
            .in('order_id', orderIds)

          if (reviewsError) throw reviewsError

          const reviewsMap = (reviews || []).reduce((accumulator, review) => {
            accumulator[review.order_id] = review
            return accumulator
          }, {})

          nextOrders = nextOrders.map((order) => ({
            ...order,
            review: reviewsMap[order.id] || null,
          }))
        }
      } catch (reviewsError) {
        if (!isSchemaCompatibilityError(reviewsError)) {
          console.error('fetchOrders.reviews', reviewsError)
        }
      }

      setOrders(nextOrders)
    } catch (error) {
      console.error('fetchOrders', error)
      if (!silent) {
        toast.push(error.message || 'Gagal memuat pesanan', { type: 'error' })
      }
    } finally {
      if (background) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!currentUser || !role) return undefined

    void fetchOrders()

    const filter = role === 'vendor'
      ? `vendor_id=eq.${currentUser.id}`
      : `buyer_id=eq.${currentUser.id}`

    const channel = supabase
      .channel(`orders-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter }, () => {
        void fetchOrders({ background: true, silent: true })
      })
      .subscribe()

    const intervalId = window.setInterval(() => {
      void fetchOrders({ background: true, silent: true })
    }, 8000)

    return () => {
      window.clearInterval(intervalId)
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeOrdersChannel', error)
      }
    }
  }, [currentUser, isVendor, role])

  async function decrementProductStockForOrder(order) {
    const itemRows = Array.isArray(order?.order_items) ? order.order_items : []
    const quantityByProductId = itemRows.reduce((accumulator, item) => {
      if (!item?.product_id) return accumulator
      const quantity = Number(item.quantity) || 0
      if (quantity <= 0) return accumulator
      accumulator[item.product_id] = (accumulator[item.product_id] || 0) + quantity
      return accumulator
    }, {})
    const productIds = Object.keys(quantityByProductId)
    if (productIds.length === 0) return false

    const { data: productsData, error: productsError } = await supabase
      .from('products')
      .select('id, vendor_id, stock, is_available')
      .eq('vendor_id', order.vendor_id)
      .in('id', productIds)

    if (productsError) throw productsError

    const stockUpdates = (productsData || [])
      .map((product) => {
        if (product.stock === null || typeof product.stock === 'undefined' || product.stock === '') return null
        const currentStock = Number(product.stock)
        if (!Number.isFinite(currentStock)) return null

        const nextStock = Math.max(0, currentStock - (quantityByProductId[product.id] || 0))
        return {
          productId: product.id,
          payload: {
            stock: nextStock,
            is_available: nextStock > 0 ? product.is_available !== false : false,
          },
        }
      })
      .filter(Boolean)

    for (const update of stockUpdates) {
      const { error } = await supabase
        .from('products')
        .update(update.payload)
        .eq('id', update.productId)
        .eq('vendor_id', order.vendor_id)

      if (error) throw error
    }

    return stockUpdates.length > 0
  }

  async function completeOrderWithStockSync(order) {
    if (!order?.id) return false

    try {
      const { error } = await supabase.rpc('complete_order_and_decrement_stock', {
        target_order_id: order.id,
      })

      if (error) throw error
      return true
    } catch (rpcError) {
      if (!isSchemaCompatibilityError(rpcError)) throw rpcError
      console.info('complete_order_and_decrement_stock belum tersedia, memakai fallback client.', rpcError)
    }

    const { error } = await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', order.id)
      .neq('status', 'completed')

    if (error) throw error

    return decrementProductStockForOrder(order)
  }

  async function updateStatus(orderOrId, status) {
    const order = orderOrId && typeof orderOrId === 'object' ? orderOrId : null
    const orderId = order?.id || orderOrId

    try {
      let stockSynced = false

      if (status === 'completed' && order && order.status !== 'completed') {
        stockSynced = await completeOrderWithStockSync(order)
      } else {
        const { error } = await supabase.from('orders').update({ status }).eq('id', orderId)
        if (error) throw error
      }

      toast.push(
        status === 'completed' && stockSynced
          ? 'Pesanan selesai dan stok produk disesuaikan'
          : 'Status pesanan diperbarui',
        { type: 'success' }
      )
      void fetchOrders({ background: true, silent: true })
    } catch (error) {
      console.error('updateStatus', error)
      if (isSchemaCompatibilityError(error)) {
        toast.push('Database belum memakai workflow status terbaru. Jalankan migration foundation terlebih dahulu.', { type: 'error' })
        return
      }
      toast.push(error.message || 'Gagal mengubah status pesanan', { type: 'error' })
    }
  }

  async function updatePaymentStatus(orderId, paymentStatus) {
    try {
      const { error } = await supabase.from('orders').update({ payment_status: paymentStatus }).eq('id', orderId)
      if (error) throw error
      toast.push('Status pembayaran diperbarui', { type: 'success' })
      void fetchOrders({ background: true, silent: true })
    } catch (error) {
      console.error('updatePaymentStatus', error)
      if (isSchemaCompatibilityError(error)) {
        toast.push('Database belum memuat flow pembayaran terbaru. Jalankan migration foundation lalu coba lagi.', { type: 'error' })
        return
      }
      toast.push(error.message || 'Gagal memperbarui status pembayaran', { type: 'error' })
    }
  }

  function renderOrderItems(order) {
    if (Array.isArray(order.order_items) && order.order_items.length > 0) {
      const visibleItems = order.order_items.slice(0, 2)
      const hiddenItemsCount = order.order_items.length - visibleItems.length

      return (
        <div className="mt-2 min-w-0 space-y-1 text-sm text-slate-600">
          {visibleItems.map((item) => (
            <div key={item.id} className="break-words">
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
      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{order.items || '-'}</div>
    )
  }

  function renderOrderCard(order, variant = 'active') {
    const title = isVendor ? (order.buyer_name || 'Pelanggan') : (order.vendor_name || 'Pedagang')
    const isHighlighted = variant === 'active'
    const isHistoryCard = variant === 'history'
    const vendorPaymentActions = isVendor ? getVendorPaymentActions(order) : []
    const buyerPaymentActions = !isVendor ? getBuyerPaymentActions(order) : []
    const vendorStatusActions = isVendor ? getNextVendorStatusActions(order) : []
    const paymentGuidance = getPaymentGuidance(order, isVendor ? 'vendor' : 'customer')
    const operationalNotice = getOrderOperationalNotice(order, isVendor ? 'vendor' : 'customer')
    const historyLabel = isHistoryCard ? formatOrderHistoryLabel(order) : ''
    const primaryActionLabel = isHistoryCard ? 'Lihat Detail' : 'Lacak'
    const isPreorder = order.order_timing === 'preorder'

    return (
      <div
        key={order.id}
        className={`min-w-0 max-w-full overflow-hidden rounded-[20px] border p-3 transition sm:rounded-[24px] sm:p-4 ${
          isHighlighted
            ? 'border-slate-900/10 bg-white shadow-sm'
            : 'border-slate-200 bg-slate-50/70'
        }`}
      >
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 break-words font-medium text-slate-900">{title}</div>
              <span className={`max-w-full rounded-full px-3 py-1 text-center text-xs font-medium uppercase leading-tight tracking-wide ${getOrderStatusTone(order.status)}`}>
                {formatOrderStatusLabel(order.status)}
              </span>
            </div>

            {renderOrderItems(order)}

            <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-xs text-slate-500">
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
                <span className={`max-w-full break-words rounded-full px-3 py-1 leading-tight ${
                  isPreorder
                    ? 'bg-sky-50 text-sky-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {formatOrderTimingLabel(order.order_timing)}
                </span>
              )}
              {!isVendor && order.review && (
                <span className="max-w-full break-words rounded-full bg-amber-50 px-3 py-1 leading-tight text-amber-700">
                  Ulasan sudah dikirim
                </span>
              )}
            </div>

            {(paymentGuidance || operationalNotice || order.meeting_point_label || order.customer_note || order.requested_fulfillment_at || Number(order.total_amount || 0) > 0 || historyLabel) && (
              <div className="mt-3 min-w-0 space-y-1 text-sm text-slate-500">
                {historyLabel && <div className="break-words">{historyLabel}</div>}
                {paymentGuidance && <div className="break-words">Pembayaran: {paymentGuidance}</div>}
                {operationalNotice && (
                  <div className="break-words rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {operationalNotice}
                  </div>
                )}
                {order.requested_fulfillment_at && (
                  <div className="break-words">Jadwal: sekitar {formatRequestedFulfillmentLabel(order.requested_fulfillment_at)}</div>
                )}
                {order.meeting_point_label && (
                  <div className="break-words">{isPreorder ? 'Area titip: ' : 'Titik temu: '}{order.meeting_point_label}</div>
                )}
                {order.customer_note && <div className="hidden break-words sm:block">Catatan: {order.customer_note}</div>}
                {Number(order.total_amount || 0) > 0 && (
                  <div className="font-medium text-slate-700">
                    Total: {formatPriceLabel(order.total_amount)}
                  </div>
                )}
              </div>
            )}

            {!isVendor && order.status === 'completed' && (
              <OrderReviewComposer
                order={order}
                existingReview={order.review}
                viewerId={currentUser?.id}
                buyerName={customerName}
                onSaved={(review) => {
                  setOrders((current) => current.map((item) => (
                    item.id === order.id
                      ? { ...item, review }
                      : item
                  )))
                }}
              />
            )}

            <div className="mt-2 text-xs text-slate-400">
              {order.created_at ? new Date(order.created_at).toLocaleString('id-ID') : '-'}
            </div>
          </div>

          <div className="grid min-w-0 w-full grid-cols-2 gap-2 md:w-auto md:flex md:flex-wrap md:items-center">
            <button
              onClick={() => navigate(`/orders/${order.id}`)}
              className={`w-full min-w-0 whitespace-normal rounded-2xl px-3 py-2 text-center text-sm font-medium leading-tight md:w-auto ${
                isHighlighted
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              {primaryActionLabel}
            </button>
            <button
              onClick={() => navigate(`/chat/${isVendor ? order.buyer_id : order.vendor_id}?order=${order.id}`)}
              className="w-full min-w-0 whitespace-normal rounded-2xl border border-slate-200 px-3 py-2 text-center text-sm font-medium leading-tight text-slate-700 md:w-auto"
            >
              Buka Chat
            </button>

            {isVendor && vendorStatusActions.map((action) => (
              <button
                key={action.value}
                disabled={action.disabled}
                onClick={() => updateStatus(order, action.value)}
                title={action.disabledReason || action.label}
                className={`w-full min-w-0 whitespace-normal rounded-2xl px-3 py-2 text-center text-sm font-medium leading-tight md:w-auto ${
                  action.disabled
                    ? 'cursor-not-allowed border border-amber-200 bg-amber-50 text-amber-700 opacity-80'
                    : action.tone === 'danger'
                      ? 'border border-red-200 bg-red-50 text-red-600'
                      : action.tone === 'success'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-900 text-white'
                }`}
              >
                {action.label}
              </button>
            ))}

            {vendorPaymentActions.map((action) => (
              <button
                key={action.value}
                onClick={() => updatePaymentStatus(order.id, action.value)}
                className={`w-full min-w-0 whitespace-normal rounded-2xl px-3 py-2 text-center text-sm font-medium leading-tight md:w-auto ${
                  action.tone === 'danger'
                    ? 'border border-red-200 bg-red-50 text-red-600'
                    : 'bg-emerald-600 text-white'
                }`}
              >
                {action.label}
              </button>
            ))}

            {!isVendor && order.status === 'pending' && (
              <button
                onClick={() => updateStatus(order, 'cancelled')}
                className="w-full min-w-0 whitespace-normal rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-center text-sm font-medium leading-tight text-red-600 md:w-auto"
              >
                Batalkan
              </button>
            )}

            {buyerPaymentActions.map((action) => (
              <button
                key={action.value}
                onClick={() => updatePaymentStatus(order.id, action.value)}
                className="w-full min-w-0 whitespace-normal rounded-2xl bg-slate-900 px-3 py-2 text-center text-sm font-medium leading-tight text-white md:w-auto"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="rounded-[28px] bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/80">Memuat pesanan...</div>
  }

  const activeOrders = orders.filter((order) => isActiveOrderStatus(order.status))
  const historyOrders = orders.filter((order) => isHistoryOrderStatus(order.status))
  const pendingOrders = orders.filter((order) => order.status === 'pending')
  const completedOrders = orders.filter((order) => order.status === 'completed')
  const completedReviewSummary = getReviewSummary(completedOrders.map((order) => order.review).filter(Boolean))
  const cancelledOrders = historyOrders.filter((order) => order.status === 'cancelled')
  const rejectedOrders = historyOrders.filter((order) => order.status === 'rejected')
  const completedValueTotal = completedOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0)
  const pendingReviewCount = completedOrders.filter((order) => !order.review).length
  const historyFilterOptions = [
    { value: 'all', label: 'Semua' },
    { value: 'completed', label: 'Selesai' },
    { value: 'cancelled', label: 'Dibatalkan' },
    { value: 'rejected', label: 'Ditolak' },
  ]
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase()
  const filteredHistoryOrders = historyOrders
    .filter((order) => {
      if (historyFilter !== 'all' && order.status !== historyFilter) return false
      if (!normalizedHistoryQuery) return true
      return getOrderSearchText(order).includes(normalizedHistoryQuery)
    })
    .sort((left, right) => {
      const leftValue = new Date(getOrderHistoryTimestamp(left) || 0).getTime()
      const rightValue = new Date(getOrderHistoryTimestamp(right) || 0).getTime()
      return rightValue - leftValue
    })
  const spotlightOrder = activeOrders[0] || orders[0] || null

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
      {!isVendor && (
        <section className="mb-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Pesanan Anda</div>
              <p className="mt-1 text-sm text-slate-500">
                {spotlightOrder
                  ? 'Order aktif dan chat terkait diprioritaskan di bawah agar lebih cepat dibuka dari HP.'
                  : 'Mulai dari peta saat Anda ingin mencari pedagang dan membuat transaksi baru.'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigate('/map')}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Buka Peta
              </button>
              {spotlightOrder ? (
                <>
                  <button
                    onClick={() => navigate(`/orders/${spotlightOrder.id}`)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Lacak
                  </button>
                  <button
                    onClick={() => navigate(`/chat/${spotlightOrder.vendor_id}?order=${spotlightOrder.id}`)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Chat
                  </button>
                </>
              ) : (
                <button
                  onClick={() => navigate('/chat')}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Buka Chat
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="mb-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Pesanan</h3>
            <p className="text-sm text-slate-500">
              {isVendor
                ? 'Pantau order masuk, lanjutkan status, dan buka chat dari satu tempat.'
                : 'Pantau pesanan aktif lebih cepat, lalu buka tracking atau chat saat dibutuhkan.'}
            </p>
          </div>
          <div className="text-xs text-slate-400">
            {refreshing ? 'Menyegarkan data...' : 'Update berjalan di background'}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <OrdersSummaryCard
          label={isVendor ? 'Aktif Sekarang' : 'Pesanan Aktif'}
          value={activeOrders.length}
          hint={isVendor ? 'Perlu dipantau atau dilanjutkan statusnya.' : 'Masih berjalan dan siap dilacak.'}
          tone="primary"
        />
        <OrdersSummaryCard
          label={isVendor ? 'Menunggu Respon' : 'Menunggu Konfirmasi'}
          value={pendingOrders.length}
          hint={isVendor ? 'Segera cek agar pelanggan tidak menunggu lama.' : 'Pedagang belum memberi keputusan akhir.'}
          tone="default"
        />
        <OrdersSummaryCard
          label={isVendor ? 'Riwayat Selesai' : 'Ulasan Dikirim'}
          value={isVendor ? completedOrders.length : completedReviewSummary.count}
          hint={isVendor
            ? 'Order yang sudah selesai ditutup.'
            : completedReviewSummary.count > 0
              ? `Rata-rata ulasan Anda ${completedReviewSummary.averageLabel}.`
              : 'Beri ulasan setelah pesanan selesai.'}
          tone="success"
        />
      </div>

      {orders.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
          <div>Belum ada pesanan.</div>
          <button
            onClick={() => navigate('/map')}
            className="mt-4 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
          >
            Buka Peta Pedagang
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {isVendor ? 'Order Aktif' : 'Pesanan Aktif'}
                </h4>
                <p className="text-sm text-slate-500">
                  {isVendor
                    ? 'Bagian ini diprioritaskan untuk order yang sedang berjalan.'
                    : 'Fokus ke order yang masih butuh tracking, chat, atau keputusan lanjutan.'}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {activeOrders.length} aktif
              </span>
            </div>

            {activeOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                {isVendor ? 'Tidak ada order aktif saat ini.' : 'Tidak ada pesanan aktif saat ini.'}
              </div>
            ) : (
              <div className="space-y-3">
                {activeOrders.map((order) => renderOrderCard(order, 'active'))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Riwayat</h4>
                <p className="text-sm text-slate-500">
                  {isVendor
                    ? 'Order yang selesai, dibatalkan, atau ditolak tetap bisa dibuka kembali saat diperlukan.'
                    : 'Riwayat membantu Anda melihat transaksi yang sudah selesai atau tidak lanjut.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {historyOrders.length} riwayat
                </span>
                <button
                  type="button"
                  onClick={() => setShowHistory((current) => !current)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {showHistory ? 'Sembunyikan' : 'Buka'}
                </button>
              </div>
            </div>

            {historyOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                Belum ada riwayat pesanan.
              </div>
            ) : !showHistory ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Riwayat disembunyikan agar layar tetap fokus ke pesanan aktif. Buka saat Anda perlu melihat transaksi lama.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      {isVendor ? 'Omzet Selesai' : 'Total Belanja'}
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {formatPriceLabel(completedValueTotal)}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {isVendor
                        ? 'Akumulasi transaksi yang sudah selesai.'
                        : 'Total transaksi selesai yang sudah Anda bayar.'}
                    </div>
                  </div>
                  <div className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Dibatalkan</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">{cancelledOrders.length}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {isVendor
                        ? 'Order yang tidak berlanjut karena dibatalkan.'
                        : 'Pesanan yang batal sebelum selesai diproses.'}
                    </div>
                  </div>
                  <div className="rounded-[22px] bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      {isVendor ? 'Ditolak' : 'Belum Diulas'}
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {isVendor ? rejectedOrders.length : pendingReviewCount}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {isVendor
                        ? 'Order yang Anda tolak atau tidak lanjut diproses.'
                        : 'Pesanan selesai yang masih bisa Anda beri ulasan.'}
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div>
                      <label className="text-sm font-medium text-slate-700">Cari riwayat</label>
                      <input
                        value={historyQuery}
                        onChange={(event) => setHistoryQuery(event.target.value)}
                        placeholder={isVendor ? 'Cari nama pelanggan, produk, atau titik temu...' : 'Cari nama pedagang, produk, atau titik temu...'}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                      />
                    </div>

                    <div>
                      <div className="text-sm font-medium text-slate-700">Filter hasil akhir</div>
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

                {filteredHistoryOrders.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    Tidak ada riwayat yang cocok dengan pencarian atau filter ini.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredHistoryOrders.map((order) => renderOrderCard(order, 'history'))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function ProfilePanel({ currentUser, role, onVendorProfileSaved }) {
  const { refreshAuth } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingLocation, setSavingLocation] = useState(false)
  const [showPaymentPreview, setShowPaymentPreview] = useState(false)
  const [showVendorPromoEditor, setShowVendorPromoEditor] = useState(false)
  const [showVendorPaymentEditor, setShowVendorPaymentEditor] = useState(false)
  const [photoFile, setPhotoFile] = useState(null)
  const [paymentQrFile, setPaymentQrFile] = useState(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    photo_url: '',
    category_primary: '',
    service_radius_km: '',
    operating_hours_text: '',
    service_mode: 'meetup',
    promo_text: '',
    promo_expires_at: '',
    payment_qris_image_url: '',
    payment_bank_name: '',
    payment_bank_account_name: '',
    payment_bank_account_number: '',
    payment_ewallet_name: '',
    payment_ewallet_number: '',
    payment_notes: '',
  })

  function buildVendorFormState(nextProfile) {
    const paymentDetails = normalizeVendorPaymentDetails(nextProfile?.payment_details)

    return {
      name: nextProfile?.name || '',
      description: nextProfile?.description || '',
      photo_url: nextProfile?.photo_url || '',
      category_primary: nextProfile?.category_primary || '',
      service_radius_km: nextProfile?.service_radius_km ?? '',
      operating_hours_text: getOperatingHoursText(nextProfile?.operating_hours) === 'Belum diatur'
        ? ''
        : getOperatingHoursText(nextProfile?.operating_hours),
      service_mode: nextProfile?.service_mode || 'meetup',
      promo_text: nextProfile?.promo_text || '',
      promo_expires_at: nextProfile?.promo_expires_at
        ? new Date(nextProfile.promo_expires_at).toISOString().slice(0, 16)
        : '',
      payment_qris_image_url: paymentDetails.qris_image_url,
      payment_bank_name: paymentDetails.bank_name,
      payment_bank_account_name: paymentDetails.bank_account_name,
      payment_bank_account_number: paymentDetails.bank_account_number,
      payment_ewallet_name: paymentDetails.ewallet_name,
      payment_ewallet_number: paymentDetails.ewallet_number,
      payment_notes: paymentDetails.payment_notes,
    }
  }

  useEffect(() => {
    if (!currentUser) return undefined

    let active = true

    async function loadProfile() {
      try {
        if (role === 'vendor') {
          const { data, error } = await supabase.from('vendors').select('*').eq('id', currentUser.id).maybeSingle()
          if (error) throw error
          if (!active) return

          const nextProfile = data || null
          setProfile(nextProfile)
          setForm(buildVendorFormState(nextProfile))
          onVendorProfileSaved?.(nextProfile)
          return
        }

        if (!active) return

        const nextProfile = {
          id: currentUser.id,
          name: currentUser.user_metadata?.full_name || '',
          email: currentUser.email,
          photo_url: currentUser.user_metadata?.avatar_url || '',
          description: '',
        }

        setProfile(nextProfile)
        setForm({
          name: nextProfile.name,
          description: '',
          photo_url: nextProfile.photo_url,
          category_primary: '',
          service_radius_km: '',
          operating_hours_text: '',
          service_mode: 'meetup',
          promo_text: '',
          promo_expires_at: '',
          payment_qris_image_url: '',
          payment_bank_name: '',
          payment_bank_account_name: '',
          payment_bank_account_number: '',
          payment_ewallet_name: '',
          payment_ewallet_number: '',
          payment_notes: '',
        })
      } catch (error) {
        console.error('loadProfile', error)
        toast.push(error.message || 'Gagal memuat profil', { type: 'error' })
      }
    }

    loadProfile()

    return () => {
      active = false
    }
  }, [currentUser, onVendorProfileSaved, role, toast])

  async function saveProfile() {
    if (!currentUser) return

    setSaving(true)
    try {
      let photoUrl = form.photo_url
      let paymentQrImageUrl = form.payment_qris_image_url
      if (photoFile) {
        photoUrl = await uploadImageFile({
          file: photoFile,
          vendorId: currentUser.id,
          folder: 'profiles',
        })
      }

      if (paymentQrFile) {
        paymentQrImageUrl = await uploadImageFile({
          file: paymentQrFile,
          vendorId: currentUser.id,
          folder: 'payments',
        })
      }

      if (role === 'vendor') {
        const payload = {
          name: form.name.trim() || 'Pedagang',
          description: form.description.trim() || null,
          photo_url: photoUrl,
          category_primary: form.category_primary.trim() || null,
          service_radius_km: form.service_radius_km === '' ? null : Number(form.service_radius_km),
          operating_hours: buildOperatingHoursPayload(form.operating_hours_text),
          service_mode: form.service_mode || 'meetup',
          promo_text: form.promo_text.trim() || null,
          promo_expires_at: form.promo_expires_at ? new Date(form.promo_expires_at).toISOString() : null,
          payment_details: buildVendorPaymentDetailsPayload({
            qris_image_url: paymentQrImageUrl,
            bank_name: form.payment_bank_name,
            bank_account_name: form.payment_bank_account_name,
            bank_account_number: form.payment_bank_account_number,
            ewallet_name: form.payment_ewallet_name,
            ewallet_number: form.payment_ewallet_number,
            payment_notes: form.payment_notes,
          }),
        }

        const { data, error } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', currentUser.id)
          .select()
          .maybeSingle()

        if (error) throw error
        setProfile(data || null)
        onVendorProfileSaved?.(data || null)
      } else {
        const { error } = await supabase.auth.updateUser({
          data: {
            full_name: form.name.trim(),
            avatar_url: photoUrl,
          },
        })

        if (error) throw error
        await syncCurrentProfile({
          ...currentUser,
          user_metadata: {
            ...currentUser.user_metadata,
            full_name: form.name.trim(),
            avatar_url: photoUrl,
          },
        }, role)
        await refreshAuth()
        setProfile((current) => ({ ...current, name: form.name.trim(), photo_url: photoUrl }))
      }

      toast.push('Profil berhasil diperbarui', { type: 'success' })
      setEditing(false)
      setShowVendorPromoEditor(false)
      setShowVendorPaymentEditor(false)
      setPhotoFile(null)
      setPaymentQrFile(null)
      setForm((current) => ({
        ...current,
        photo_url: photoUrl,
        payment_qris_image_url: paymentQrImageUrl,
      }))
    } catch (error) {
      console.error('saveProfile', error)
      if (role === 'vendor' && isSchemaCompatibilityError(error)) {
        toast.push('Database belum memuat field profil toko terbaru. Jalankan migration pembayaran dan promo toko, lalu coba lagi.', { type: 'error' })
        return
      }
      toast.push(error.message || 'Gagal menyimpan profil', { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function saveCurrentLocation() {
    if (!currentUser || role !== 'vendor') return
    if (!navigator.geolocation) {
      toast.push('Browser ini tidak mendukung akses lokasi', { type: 'error' })
      return
    }

    setSavingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const payload = createVendorLocationPayload({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          })

          const { data, error } = await supabase
            .from('vendors')
            .update({ location: payload })
            .eq('id', currentUser.id)
            .select('*')
            .maybeSingle()

          if (error) throw error

          setProfile(data || null)
          onVendorProfileSaved?.(data || null)
          toast.push('Lokasi toko berhasil diperbarui', { type: 'success' })
        } catch (error) {
          console.error('saveCurrentLocation', error)
          toast.push(error.message || 'Gagal menyimpan lokasi toko', { type: 'error' })
        } finally {
          setSavingLocation(false)
        }
      },
      (error) => {
        setSavingLocation(false)
        toast.push(getGeolocationErrorMessage(error), { type: 'error' })
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
      }
    )
  }

  if (!profile) {
    return <div className="rounded-2xl bg-white p-4 text-sm text-gray-500 shadow-sm ring-1 ring-gray-100">Memuat profil...</div>
  }

  const vendorPaymentDetails = normalizeVendorPaymentDetails(profile.payment_details)
  const vendorPaymentSummary = getVendorPaymentSetupSummary(profile.payment_details)
  const qrisPaymentDetails = getVendorPaymentMethodDetails(profile.payment_details, 'qris')
  const bankPaymentDetails = getVendorPaymentMethodDetails(profile.payment_details, 'bank_transfer')
  const ewalletPaymentDetails = getVendorPaymentMethodDetails(profile.payment_details, 'ewallet')
  const hasActivePromo = isVendorPromoActive(profile)
  const promoText = getVendorPromoText(profile)

  return (
    <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-slate-100">
          {profile.photo_url ? (
            <img src={profile.photo_url} alt="avatar" className="h-full w-full object-cover" />
          ) : (
            <div className="text-xl font-semibold text-slate-500">{(profile.name || 'U')[0]}</div>
          )}
        </div>

        <div>
          <div className="font-semibold text-slate-900">{profile.name || profile.email}</div>
          <div className="text-sm text-slate-500">{role === 'vendor' ? 'Pedagang' : 'Pelanggan'}</div>
        </div>
      </div>

      <div className="mt-4">
        {!editing ? (
          <>
            <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              {profile.description || 'Belum ada deskripsi profil.'}
            </div>

            {role === 'vendor' && (
              <div className="mt-4 rounded-2xl bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-4 ring-1 ring-emerald-100">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Lokasi Toko</div>
                    <div className="mt-1 text-sm text-slate-600">{getVendorLocationLabel(profile.location)}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Sinkron terakhir: {getVendorLocationUpdatedAtLabel(profile.location)}
                    </div>
                  </div>
                  <button
                    onClick={saveCurrentLocation}
                    disabled={savingLocation}
                    className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-70"
                  >
                    {savingLocation ? 'Memperbarui...' : 'Gunakan Lokasi Saat Ini'}
                  </button>
                </div>

                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={() => navigate('/map')}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Buka Peta
                  </button>
                  <button
                    onClick={() => navigate('/dashboard?tab=products')}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Lihat Produk
                  </button>
                </div>

                <div className="mt-4 grid gap-2 sm:hidden">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-white">
                      {profile.is_verified ? 'Terverifikasi' : 'Belum diverifikasi'}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-white">
                      {formatVendorCategoryLabel(profile.category_primary)}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-white">
                      {formatVendorServiceRadius(profile.service_radius_km)}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-white">
                      {formatVendorServiceMode(profile.service_mode)}
                    </span>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-3 text-sm text-slate-700 ring-1 ring-white">
                    Jam operasional: {getOperatingHoursText(profile.operating_hours)}
                  </div>
                </div>

                <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-2">
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Verifikasi</div>
                    <div className="mt-1 font-medium text-slate-900">{profile.is_verified ? 'Terverifikasi' : 'Belum diverifikasi'}</div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Kategori Utama</div>
                    <div className="mt-1 font-medium text-slate-900">{formatVendorCategoryLabel(profile.category_primary)}</div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Area Layanan</div>
                    <div className="mt-1 font-medium text-slate-900">{formatVendorServiceRadius(profile.service_radius_km)}</div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Metode Layanan</div>
                    <div className="mt-1 font-medium text-slate-900">{formatVendorServiceMode(profile.service_mode)}</div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Jam Operasional</div>
                    <div className="mt-1 text-sm leading-6 text-slate-700">{getOperatingHoursText(profile.operating_hours)}</div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                  <div className="text-sm font-semibold text-slate-900">Promo Ringan</div>
                  {hasActivePromo ? (
                    <>
                      <div className="mt-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                        {promoText}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        Aktif sampai {formatVendorPromoExpiry(profile)}
                      </div>
                    </>
                  ) : (
                    <div className="mt-2 text-sm text-slate-500">
                      Belum ada promo aktif yang tampil ke pelanggan.
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                  <div className="text-sm font-semibold text-slate-900">Pembayaran Non-Tunai</div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Informasi ini akan ditampilkan ke pelanggan saat mereka memilih metode pembayaran.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {vendorPaymentSummary.map((entry) => (
                      <span
                        key={entry.method}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          entry.ready
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {entry.label} {entry.ready ? 'siap' : 'belum diatur'}
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowPaymentPreview((current) => !current)}
                    className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:hidden"
                  >
                    {showPaymentPreview ? 'Sembunyikan Detail Pembayaran' : 'Lihat Detail Pembayaran'}
                  </button>

                  <div className={`mt-4 ${showPaymentPreview ? 'grid' : 'hidden'} gap-3 sm:grid md:grid-cols-3`}>
                    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">QRIS</div>
                      {qrisPaymentDetails.ready ? (
                        <div className="mt-3 space-y-3">
                          <img
                            src={qrisPaymentDetails.imageUrl}
                            alt="QRIS toko"
                            className="h-40 w-full rounded-2xl border border-slate-200 bg-white object-contain p-2"
                          />
                          <div className="text-sm text-slate-600">Pelanggan bisa scan langsung dari halaman checkout.</div>
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">Belum ada foto QRIS.</div>
                      )}
                    </div>

                    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Transfer Bank</div>
                      {bankPaymentDetails.ready ? (
                        <div className="mt-3 space-y-2 text-sm text-slate-600">
                          {bankPaymentDetails.rows.map((row) => (
                            <div key={row.label}>
                              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">{row.label}</div>
                              <div className="mt-1 font-medium text-slate-900">{row.value}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">Belum ada rekening bank yang ditampilkan.</div>
                      )}
                    </div>

                    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">E-Wallet</div>
                      {ewalletPaymentDetails.ready ? (
                        <div className="mt-3 space-y-2 text-sm text-slate-600">
                          {ewalletPaymentDetails.rows.map((row) => (
                            <div key={row.label}>
                              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">{row.label}</div>
                              <div className="mt-1 font-medium text-slate-900">{row.value}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">Belum ada nomor e-wallet yang ditampilkan.</div>
                      )}
                    </div>
                  </div>

                  {vendorPaymentDetails.payment_notes && (
                    <div className={`${showPaymentPreview ? 'block' : 'hidden'} mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 sm:block`}>
                      Catatan pembayaran: {vendorPaymentDetails.payment_notes}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4">
              <button
                onClick={() => {
                  setShowPaymentPreview(false)
                  setShowVendorPromoEditor(false)
                  setShowVendorPaymentEditor(false)
                  setEditing(true)
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Edit Profil
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nama toko atau nama pengguna"
            />

            {role === 'vendor' && (
              <>
                <textarea
                  className="min-h-[120px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Deskripsi singkat toko"
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    value={form.category_primary}
                    onChange={(event) => setForm((current) => ({ ...current, category_primary: event.target.value }))}
                    placeholder="Kategori utama, misalnya bakso atau sayur"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    value={form.service_radius_km}
                    onChange={(event) => setForm((current) => ({ ...current, service_radius_km: event.target.value }))}
                    placeholder="Radius layanan (km)"
                  />
                </div>

                <select
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={form.service_mode}
                  onChange={(event) => setForm((current) => ({ ...current, service_mode: event.target.value }))}
                >
                  <option value="meetup">Titik temu</option>
                  <option value="delivery">Antar ke pelanggan</option>
                  <option value="both">Antar dan titik temu</option>
                </select>

                <textarea
                  className="min-h-[96px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={form.operating_hours_text}
                  onChange={(event) => setForm((current) => ({ ...current, operating_hours_text: event.target.value }))}
                  placeholder="Contoh: Senin-Sabtu 07.00-12.00, Minggu libur"
                />

                <div className="rounded-[24px] border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Promo Ringan</div>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        Tampilkan penawaran singkat yang akan muncul di peta dan profil toko pelanggan.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowVendorPromoEditor((current) => !current)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:hidden"
                    >
                      {showVendorPromoEditor ? 'Tutup' : 'Buka'}
                    </button>
                  </div>

                  {!showVendorPromoEditor && (
                    <div className="mt-3 text-sm text-slate-500 sm:hidden">
                      Buka bagian ini saat Anda ingin menambah atau mengubah promo toko.
                    </div>
                  )}

                  <div className={`${showVendorPromoEditor ? 'mt-4 block' : 'hidden'} space-y-3 sm:mt-4 sm:block`}>
                    <textarea
                      className="min-h-[96px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                      value={form.promo_text}
                      onChange={(event) => setForm((current) => ({ ...current, promo_text: event.target.value }))}
                      placeholder="Contoh: Gratis sambal dan bawang goreng untuk pembelian hari ini"
                    />
                    <input
                      type="datetime-local"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                      value={form.promo_expires_at}
                      onChange={(event) => setForm((current) => ({ ...current, promo_expires_at: event.target.value }))}
                    />
                    <div className="text-xs text-slate-500">
                      Kosongkan tanggal berakhir jika promo ingin tetap aktif sampai Anda menghapus teks promosinya.
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Pembayaran Non-Tunai</div>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        Isi QRIS, rekening bank, atau e-wallet yang ingin langsung terlihat oleh pelanggan saat checkout.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowVendorPaymentEditor((current) => !current)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:hidden"
                    >
                      {showVendorPaymentEditor ? 'Tutup' : 'Buka'}
                    </button>
                  </div>

                  {!showVendorPaymentEditor && (
                    <div className="mt-3 text-sm text-slate-500 sm:hidden">
                      Buka bagian ini saat Anda ingin memperbarui QRIS, rekening, atau e-wallet.
                    </div>
                  )}

                  <div className={`${showVendorPaymentEditor ? 'mt-4 block' : 'hidden'} space-y-4 sm:mt-4 sm:block`}>
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Foto QRIS</label>
                      {form.payment_qris_image_url && (
                        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
                          <img
                            src={form.payment_qris_image_url}
                            alt="QRIS toko"
                            className="h-52 w-full rounded-xl object-contain"
                          />
                        </div>
                      )}
                      {paymentQrFile && (
                        <div className="mt-2 text-xs text-slate-500">File dipilih: {paymentQrFile.name}</div>
                      )}
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(event) => setPaymentQrFile(event.target.files?.[0] || null)}
                        />
                        {form.payment_qris_image_url && (
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentQrFile(null)
                              setForm((current) => ({ ...current, payment_qris_image_url: '' }))
                            }}
                            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                          >
                            Hapus QRIS
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        value={form.payment_bank_name}
                        onChange={(event) => setForm((current) => ({ ...current, payment_bank_name: event.target.value }))}
                        placeholder="Nama bank, misalnya BCA atau BRI"
                      />
                      <input
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        value={form.payment_bank_account_name}
                        onChange={(event) => setForm((current) => ({ ...current, payment_bank_account_name: event.target.value }))}
                        placeholder="Nama pemilik rekening"
                      />
                    </div>

                    <input
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                      value={form.payment_bank_account_number}
                      onChange={(event) => setForm((current) => ({ ...current, payment_bank_account_number: event.target.value }))}
                      placeholder="Nomor rekening transfer"
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        value={form.payment_ewallet_name}
                        onChange={(event) => setForm((current) => ({ ...current, payment_ewallet_name: event.target.value }))}
                        placeholder="Nama e-wallet, misalnya DANA, OVO, GoPay"
                      />
                      <input
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        value={form.payment_ewallet_number}
                        onChange={(event) => setForm((current) => ({ ...current, payment_ewallet_number: event.target.value }))}
                        placeholder="Nomor e-wallet"
                      />
                    </div>

                    <textarea
                      className="min-h-[96px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                      value={form.payment_notes}
                      onChange={(event) => setForm((current) => ({ ...current, payment_notes: event.target.value }))}
                      placeholder="Catatan opsional, misalnya: kirim bukti bayar lewat chat setelah transfer"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700">Ganti Foto</label>
              <input
                type="file"
                accept="image/*"
                className="mt-2"
                onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                disabled={saving}
                onClick={saveProfile}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-400"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button
                onClick={() => {
                  setShowPaymentPreview(false)
                  setShowVendorPromoEditor(false)
                  setShowVendorPaymentEditor(false)
                  setEditing(false)
                  setPhotoFile(null)
                  setPaymentQrFile(null)
                  setForm(role === 'vendor'
                    ? buildVendorFormState(profile)
                    : {
                      name: profile.name || '',
                      description: profile.description || '',
                      photo_url: profile.photo_url || '',
                      category_primary: '',
                      service_radius_km: '',
                      operating_hours_text: '',
                      service_mode: 'meetup',
                      promo_text: '',
                      promo_expires_at: '',
                      payment_qris_image_url: '',
                      payment_bank_name: '',
                      payment_bank_account_name: '',
                      payment_bank_account_number: '',
                      payment_ewallet_name: '',
                      payment_ewallet_number: '',
                      payment_notes: '',
                    })
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DashboardScreen() {
  const { user, role, loading, accountStatus } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState('products')
  const [vendorProfile, setVendorProfile] = useState(null)

  const isAdmin = role === 'admin'
  const isVendor = role === 'vendor' || user?.user_metadata?.is_vendor === true
  const handleVendorProfileSaved = useCallback((profile) => {
    setVendorProfile(profile)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const requestedTab = params.get('tab')
    const allowedTabs = isAdmin
      ? ['admin', 'profile']
      : isVendor
      ? ['products', 'chats', 'orders', 'profile']
      : ['chats', 'orders', 'profile']

    if (requestedTab && allowedTabs.includes(requestedTab)) {
      setActiveTab(requestedTab)
      return
    }

    if (!requestedTab) {
      setActiveTab(isAdmin ? 'admin' : isVendor ? 'products' : 'orders')
    }
  }, [isAdmin, isVendor, location.search])

  useEffect(() => {
    if (!user || !isVendor) {
      setVendorProfile(null)
      return undefined
    }

    let active = true

    async function loadVendorProfile() {
      try {
        const { data, error } = await supabase.from('vendors').select('*').eq('id', user.id).maybeSingle()
        if (error) throw error
        if (active) setVendorProfile(data || null)
      } catch (error) {
        console.error('loadVendorProfile', error)
        if (active) toast.push(error.message || 'Gagal memuat profil toko', { type: 'error' })
      }
    }

    loadVendorProfile()

    return () => {
      active = false
    }
  }, [isVendor, toast, user])

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Memuat dashboard...</div>
  }

  const displayName = isAdmin
    ? getDisplayName(user?.user_metadata?.full_name || user?.email, 'Admin')
    : isVendor
    ? getDisplayName(vendorProfile?.name || user?.user_metadata?.full_name || user?.email, 'Pedagang')
    : getDisplayName(user?.user_metadata?.full_name || user?.email, 'Pelanggan')

  const avatarUrl = isVendor
    ? (vendorProfile?.photo_url || user?.user_metadata?.avatar_url)
    : user?.user_metadata?.avatar_url

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl overflow-x-hidden px-3 py-5 sm:px-4 sm:py-6">
        <div className="grid min-w-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="hidden space-y-4 lg:block lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xl">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
                  ) : (
                    <div className="font-semibold text-slate-500">{displayName[0]}</div>
                  )}
                </div>

                <div>
                  <div className="font-semibold text-slate-900">{displayName}</div>
                  <div className="text-xs text-slate-500">{user?.email}</div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  isAdmin
                    ? 'bg-sky-50 text-sky-700'
                    : isVendor
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-700'
                }`}>
                  {isAdmin ? 'Mode Admin' : isVendor ? 'Mode Pedagang' : 'Mode Pelanggan'}
                </span>
                {accountStatus !== 'active' && !isAdmin ? (
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                    accountStatus === 'blocked'
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                    {accountStatus === 'blocked' ? 'Akun diblokir' : 'Akun ditangguhkan'}
                  </span>
                ) : null}
              </div>
            </div>

            <nav className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {isAdmin && <TabButton id="admin" active={activeTab === 'admin'} onClick={setActiveTab}>Admin</TabButton>}
                {isVendor && <TabButton id="products" active={activeTab === 'products'} onClick={setActiveTab}>Produk</TabButton>}
                {!isAdmin && <TabButton id="chats" active={activeTab === 'chats'} onClick={setActiveTab}>Chat</TabButton>}
                {!isAdmin && <TabButton id="orders" active={activeTab === 'orders'} onClick={setActiveTab}>Pesanan</TabButton>}
                <TabButton id="profile" active={activeTab === 'profile'} onClick={setActiveTab}>Profil</TabButton>
              </div>

              <p className="mt-3 text-sm leading-6 text-slate-500">
                {isAdmin
                  ? 'Gunakan menu ini untuk memverifikasi pedagang dan melakukan moderasi dasar.'
                  : 'Gunakan menu ini untuk berpindah antar fitur dengan cepat.'}
              </p>
            </nav>
          </aside>

          <main className="min-w-0 max-w-full space-y-4">
            {accountStatus !== 'active' && !isAdmin ? (
              <div className={`rounded-[28px] p-4 text-sm shadow-sm ring-1 ${
                accountStatus === 'blocked'
                  ? 'bg-rose-50 text-rose-700 ring-rose-100'
                  : 'bg-amber-50 text-amber-700 ring-amber-100'
              }`}>
                {accountStatus === 'blocked'
                  ? 'Akun ini sedang diblokir oleh admin. Beberapa fitur operasional bisa dibatasi sampai status akun dipulihkan.'
                  : 'Akun ini sedang ditangguhkan oleh admin. Silakan selesaikan peninjauan sebelum kembali beroperasi penuh.'}
              </div>
            ) : null}

            <div className="min-w-0 rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold text-slate-900">
                    {activeTab === 'admin' && 'Panel Admin'}
                    {activeTab === 'products' && 'Produk Saya'}
                    {activeTab === 'chats' && 'Percakapan'}
                    {activeTab === 'orders' && 'Pesanan'}
                    {activeTab === 'profile' && 'Profil Saya'}
                  </h1>
                  <p className="text-sm leading-6 text-slate-500">
                    {activeTab === 'admin' && 'Verifikasi pedagang, tangguhkan akun bermasalah, dan pantau moderasi dasar.'}
                    {activeTab === 'products' && 'Kelola katalog produk dan foto dagangan Anda.'}
                    {activeTab === 'chats' && 'Balas pesan dari pelanggan atau pedagang lain.'}
                    {activeTab === 'orders' && 'Pantau transaksi terbaru dan ubah statusnya.'}
                    {activeTab === 'profile' && 'Perbarui identitas akun dan tampilan profil.'}
                  </p>
                </div>
              </div>
            </div>

            {activeTab === 'admin' && isAdmin && <AdminPanel currentUser={user} />}
            {activeTab === 'products' && isVendor && <VendorProductsManager />}
            {activeTab === 'chats' && !isAdmin && <ChatWorkspace embedded />}
            {activeTab === 'orders' && !isAdmin && <OrdersPanel currentUser={user} role={role} />}
            {activeTab === 'profile' && (
              <ProfilePanel currentUser={user} role={role} onVendorProfileSaved={handleVendorProfileSaved} />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
