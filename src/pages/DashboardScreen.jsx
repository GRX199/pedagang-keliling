import React, { useEffect, useState } from 'react'
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
  getOperatingHoursText,
  getVendorLocationLabel,
  getVendorLocationUpdatedAtLabel,
  getVendorPromoText,
  isVendorPromoActive,
  normalizeVendorPaymentDetails,
} from '../lib/vendor'

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
  const [expandedOrderIds, setExpandedOrderIds] = useState([])
  const isVendor = role === 'vendor'
  const customerName = currentUser?.user_metadata?.full_name || currentUser?.email || 'Pelanggan'

  function isOrderExpanded(orderId) {
    return expandedOrderIds.includes(orderId)
  }

  function toggleOrderDetails(orderId) {
    setExpandedOrderIds((current) => (
      current.includes(orderId)
        ? current.filter((item) => item !== orderId)
        : [...current, orderId]
    ))
  }

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
      if (document.visibilityState === 'hidden') return
      void fetchOrders({ background: true, silent: true })
    }, 30000)

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
      <div className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-600">{order.items || '-'}</div>
    )
  }

  function renderOrderCard(order, variant = 'active') {
    const title = isVendor ? (order.buyer_name || 'Pelanggan') : (order.vendor_name || 'Pedagang')
    const isHighlighted = variant === 'active'
    const isHistoryCard = variant === 'history'
    const isExpanded = isOrderExpanded(order.id)
    const vendorPaymentActions = isVendor ? getVendorPaymentActions(order) : []
    const buyerPaymentActions = !isVendor ? getBuyerPaymentActions(order) : []
    const vendorStatusActions = isVendor ? getNextVendorStatusActions(order) : []
    const paymentGuidance = getPaymentGuidance(order, isVendor ? 'vendor' : 'customer')
    const operationalNotice = getOrderOperationalNotice(order, isVendor ? 'vendor' : 'customer')
    const historyLabel = isHistoryCard ? formatOrderHistoryLabel(order) : ''
    const primaryActionLabel = isHistoryCard ? 'Buka' : 'Lacak'
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
    const actionButtonBase = 'rounded-full px-4 py-2.5 text-center text-sm font-medium leading-tight transition'
    const detailActionButtonBase = 'w-full rounded-xl px-3 py-2 text-center text-sm font-medium leading-tight transition sm:w-auto'

    return (
      <div
        key={order.id}
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
              <div className="mt-1 truncate text-base font-semibold text-slate-900">{title}</div>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-center text-[11px] font-semibold uppercase leading-tight tracking-wide ${getOrderStatusTone(order.status)}`}>
              {formatOrderStatusLabel(order.status)}
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
                  onClick={() => navigate(`/chat/${isVendor ? order.buyer_id : order.vendor_id}?order=${order.id}`)}
                  className={`${detailActionButtonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-100`}
                >
                  Chat
                </button>

                {isVendor && vendorStatusActions.map((action) => (
                  <button
                    key={action.value}
                    disabled={action.disabled}
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
                    className={`${detailActionButtonBase} border border-red-200 bg-red-50 text-red-600 hover:bg-red-100`}
                  >
                    Batalkan
                  </button>
                )}

                {buyerPaymentActions.map((action) => (
                  <button
                    key={action.value}
                    onClick={() => updatePaymentStatus(order.id, action.value)}
                    className={`${detailActionButtonBase} bg-slate-900 text-white hover:bg-slate-800`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>

              {historyLabel && <div className="break-words font-medium text-slate-700">{historyLabel}</div>}
              {paymentGuidance && <div className="break-words">Pembayaran: {paymentGuidance}</div>}
              {operationalNotice && (
                <div className="break-words rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-amber-800">
                  {operationalNotice}
                </div>
              )}
              {order.requested_fulfillment_at && (
                <div className="break-words">Jadwal: sekitar {formatRequestedFulfillmentLabel(order.requested_fulfillment_at)}</div>
              )}
              {order.meeting_point_label && (
                <div className="break-words">{isPreorder ? 'Area titip: ' : 'Titik temu: '}{order.meeting_point_label}</div>
              )}
              {order.customer_note && <div className="break-words">Catatan: {order.customer_note}</div>}
              <div className="text-xs text-slate-400">
                Dibuat: {order.created_at ? new Date(order.created_at).toLocaleString('id-ID') : '-'}
              </div>

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
            </div>
          )}
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
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Pesanan</h3>
          <p className="text-sm leading-5 text-slate-500 sm:block">
            {isVendor ? 'Order masuk dan status transaksi.' : 'Order aktif dan riwayat transaksi.'}
          </p>
        </div>

        <div className="shrink-0 rounded-full bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
          {refreshing ? 'Update...' : 'Realtime'}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 text-sm">
        <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-900 px-3 py-2 font-medium text-white">
          Aktif <strong>{activeOrders.length}</strong>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-100 px-3 py-2 font-medium text-slate-700">
          {isVendor ? 'Baru' : 'Pending'} <strong>{pendingOrders.length}</strong>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 font-medium text-emerald-700">
          {isVendor ? 'Selesai' : 'Ulasan'} <strong>{isVendor ? completedOrders.length : completedReviewSummary.count}</strong>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          Belum ada pesanan.
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {isVendor ? 'Order Aktif' : 'Pesanan Aktif'}
                </h4>
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
              null
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-600">
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700 ring-1 ring-emerald-100">
                    {completedOrders.length} selesai
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-600">
                    {cancelledOrders.length} batal
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-600">
                    {isVendor ? `${rejectedOrders.length} ditolak` : `${pendingReviewCount} belum diulas`}
                  </span>
                </div>

                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-3">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div>
                      <label className="text-sm font-medium text-slate-700">Cari riwayat</label>
                      <input
                        value={historyQuery}
                        onChange={(event) => setHistoryQuery(event.target.value)}
                        placeholder="Cari riwayat..."
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
  const readyPaymentCount = vendorPaymentSummary.filter((entry) => entry.ready).length
  const readyPaymentLabel = readyPaymentCount > 0 ? `${readyPaymentCount} metode siap` : 'Belum diatur'

  return (
    <div className="min-w-0 rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 sm:h-16 sm:w-16">
            {profile.photo_url ? (
              <img src={profile.photo_url} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <div className="text-xl font-semibold text-slate-500">{(profile.name || 'U')[0]}</div>
            )}
          </div>

          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-900">{profile.name || profile.email}</div>
            <div className="text-sm text-slate-500">{role === 'vendor' ? 'Pedagang' : 'Pelanggan'}</div>
          </div>
        </div>

        {!editing ? (
          <button
            onClick={() => {
              setShowPaymentPreview(false)
              setShowVendorPromoEditor(false)
              setShowVendorPaymentEditor(false)
              setEditing(true)
            }}
            className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Edit
          </button>
        ) : null}
      </div>

      <div className="mt-4">
        {!editing ? (
          <>
            <div className="rounded-2xl bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-600 sm:px-4">
              <span className="line-clamp-3 block">
                {role === 'vendor'
                  ? profile.description || 'Tambahkan deskripsi singkat agar pelanggan lebih percaya.'
                  : 'Kelola nama dan foto akun Anda dari tombol edit.'}
              </span>
            </div>

            {role === 'vendor' && (
              <div className="mt-3 space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">Ringkasan toko</div>
                      <div className="mt-1 truncate text-sm text-slate-500">
                        {getVendorLocationLabel(profile.location)}
                      </div>
                    </div>
                    <button
                      onClick={saveCurrentLocation}
                      disabled={savingLocation}
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-70"
                    >
                      {savingLocation ? 'Memperbarui...' : 'Update Lokasi'}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {profile.is_verified ? 'Terverifikasi' : 'Belum diverifikasi'}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {formatVendorCategoryLabel(profile.category_primary)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {formatVendorServiceRadius(profile.service_radius_km)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {formatVendorServiceMode(profile.service_mode)}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-400">Jam</div>
                      <div className="mt-0.5 line-clamp-1 font-medium text-slate-800">{getOperatingHoursText(profile.operating_hours)}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-400">Pembayaran</div>
                      <div className="mt-0.5 font-medium text-slate-800">{readyPaymentLabel}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-400">Sinkron</div>
                      <div className="mt-0.5 line-clamp-1 font-medium text-slate-800">{getVendorLocationUpdatedAtLabel(profile.location)}</div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">Promo</div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${hasActivePromo ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {hasActivePromo ? 'Aktif' : 'Kosong'}
                      </span>
                    </div>
                    {hasActivePromo ? (
                      <>
                        <div className="mt-2 line-clamp-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                          {promoText}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Sampai {formatVendorPromoExpiry(profile)}
                        </div>
                      </>
                    ) : (
                      <div className="mt-2 text-sm text-slate-500">Belum ada promo aktif.</div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">Pembayaran</div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {readyPaymentLabel}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {vendorPaymentSummary.map((entry) => (
                        <span
                          key={entry.method}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            entry.ready
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {entry.label}
                        </span>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowPaymentPreview((current) => !current)}
                      className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      {showPaymentPreview ? 'Tutup detail' : 'Detail pembayaran'}
                    </button>

                    <div className={`${showPaymentPreview ? 'grid' : 'hidden'} mt-3 gap-3 md:col-span-2 lg:grid-cols-3`}>
                      <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">QRIS</div>
                        {qrisPaymentDetails.ready ? (
                          <div className="mt-3 space-y-3">
                            <img
                              src={qrisPaymentDetails.imageUrl}
                              alt="QRIS toko"
                              className="h-40 w-full rounded-2xl border border-slate-200 bg-white object-contain p-2"
                            />
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-slate-500">Belum ada foto QRIS.</div>
                        )}
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
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
                          <div className="mt-2 text-sm text-slate-500">Belum ada rekening bank.</div>
                        )}
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
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
                          <div className="mt-2 text-sm text-slate-500">Belum ada nomor e-wallet.</div>
                        )}
                      </div>
                    </div>

                    {vendorPaymentDetails.payment_notes && (
                      <div className={`${showPaymentPreview ? 'block' : 'hidden'} mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600`}>
                        Catatan pembayaran: {vendorPaymentDetails.payment_notes}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
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
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowVendorPromoEditor((current) => !current)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:hidden"
                    >
                      {showVendorPromoEditor ? 'Tutup' : 'Buka'}
                    </button>
                  </div>

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
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowVendorPaymentEditor((current) => !current)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:hidden"
                    >
                      {showVendorPaymentEditor ? 'Tutup' : 'Buka'}
                    </button>
                  </div>

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
              <label className="block text-sm font-medium text-slate-700">Foto profil</label>
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
  const location = useLocation()
  const [activeTab, setActiveTab] = useState('products')

  const isAdmin = role === 'admin'
  const isVendor = role === 'vendor'

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

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Memuat dashboard...</div>
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-5xl overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
          <main className="min-w-0 max-w-full space-y-4">
            {accountStatus !== 'active' ? (
              <div className={`rounded-[28px] p-4 text-sm shadow-sm ring-1 ${
                accountStatus === 'blocked'
                  ? 'bg-rose-50 text-rose-700 ring-rose-100'
                  : 'bg-amber-50 text-amber-700 ring-amber-100'
              }`}>
                {accountStatus === 'blocked'
                  ? 'Akun diblokir admin. Beberapa fitur dibatasi.'
                  : 'Akun ditangguhkan admin. Tunggu peninjauan selesai.'}
              </div>
            ) : null}

            {activeTab === 'admin' && isAdmin && <AdminPanel currentUser={user} />}
            {activeTab === 'products' && isVendor && <VendorProductsManager />}
            {activeTab === 'chats' && !isAdmin && <ChatWorkspace embedded />}
            {activeTab === 'orders' && !isAdmin && <OrdersPanel currentUser={user} role={role} />}
            {activeTab === 'profile' && (
              <ProfilePanel currentUser={user} role={role} />
            )}
          </main>
      </div>
    </div>
  )
}
