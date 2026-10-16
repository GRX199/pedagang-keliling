import type { Order, OrderProgressAction, Vendor } from '../types/domain.types'
import type { CartEntry } from '../features/orders/cart'
import { errorDetails } from '../shared/lib/utils'
type OrderLike = Partial<Order> | null | undefined

import {
  isPickupOrder,
  pickupActions,
  PICKUP_LABELS,
  PICKUP_STATUSES,
} from './pickup'

export function formatPriceLabel(price: number | string | null | undefined) {
  if (price === null || typeof price === 'undefined')
    return 'Harga belum diatur'
  return `Rp ${Number(price).toLocaleString('id-ID')}`
}

export const ORDER_STATUS_SEQUENCE = [
  'pending',
  'accepted',
  'preparing',
  'on_the_way',
  'arrived',
  'completed',
]

export const ORDER_STATUS_LABELS: Record<string, string> = {
  ready: 'Siap diambil',
  pending: 'Menunggu konfirmasi',
  accepted: 'Diterima',
  preparing: 'Disiapkan',
  on_the_way: 'Dalam perjalanan',
  arrived: 'Sudah tiba',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
  rejected: 'Ditolak',
}

export const ACTIVE_ORDER_STATUSES = [
  'ready',
  'pending',
  'accepted',
  'preparing',
  'on_the_way',
  'arrived',
]

export const HISTORY_ORDER_STATUSES = ['completed', 'cancelled', 'rejected']

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: 'COD',
  qris: 'QRIS',
  bank_transfer: 'Transfer Bank',
  ewallet: 'E-Wallet',
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Belum dibayar',
  pending_confirmation: 'Menunggu konfirmasi',
  paid: 'Sudah dibayar',
  failed: 'Gagal',
  refunded: 'Dikembalikan',
}

export const FULFILLMENT_TYPE_LABELS: Record<string, string> = {
  self_pickup: 'Ambil sendiri',
  customer_courier: 'Kurir pelanggan',
  meetup: 'Titik temu',
  delivery: 'Antar',
}

export const ORDER_TIMING_LABELS: Record<string, string> = {
  asap: 'Pesan sekarang',
  preorder: 'Titip untuk nanti',
}

export function formatOrderStatusLabel(
  status:
    string | Partial<Pick<Order, 'status' | 'service_flow'>> | null | undefined,
): string {
  if (status && typeof status === 'object') {
    return isPickupOrder(status)
      ? PICKUP_LABELS[status.status || ''] || status.status || ''
      : formatOrderStatusLabel(status.status)
  }
  return ORDER_STATUS_LABELS[status || ''] || String(status || 'pending')
}

export function formatPaymentMethodLabel(method: string | null | undefined) {
  return PAYMENT_METHOD_LABELS[method || ''] || 'COD'
}

export function formatPaymentStatusLabel(status: string | null | undefined) {
  return PAYMENT_STATUS_LABELS[status || ''] || 'Belum dibayar'
}

export function formatFulfillmentTypeLabel(type: string | null | undefined) {
  return FULFILLMENT_TYPE_LABELS[type || ''] || 'Titik temu'
}

export function formatOrderTimingLabel(value: string | null | undefined) {
  return ORDER_TIMING_LABELS[value || ''] || ORDER_TIMING_LABELS.asap
}

export function formatRequestedFulfillmentLabel(
  value: string | null | undefined,
) {
  if (!value) return 'Waktu belum ditentukan'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Waktu belum ditentukan'

  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function getVendorPaymentActions(
  order: OrderLike,
): OrderProgressAction[] {
  if (!order || !isActiveOrderStatus(order.status)) return []
  if (
    isPickupOrder(order) &&
    !['accepted', 'ready'].includes(order.status || '')
  )
    return []

  if (order.payment_method === 'cod') {
    if (isPickupOrder(order)) return []
    if (
      order.status === (isPickupOrder(order) ? 'ready' : 'arrived') &&
      order.payment_status === 'unpaid'
    ) {
      return [{ value: 'paid', label: 'Tandai COD Lunas', tone: 'success' }]
    }

    return []
  }

  if (order.payment_status === 'pending_confirmation') {
    return [
      { value: 'paid', label: 'Konfirmasi Pembayaran', tone: 'success' },
      { value: 'failed', label: 'Tolak Konfirmasi', tone: 'danger' },
    ]
  }

  return []
}

function requiresPrepaidConfirmation(order: OrderLike) {
  return ['qris', 'bank_transfer', 'ewallet'].includes(
    order?.payment_method || '',
  )
}

function isPaymentConfirmed(order: OrderLike) {
  return order?.payment_status === 'paid'
}

export function getVendorStatusTransitionBlockReason(
  order: OrderLike,
  nextStatus: string,
) {
  if (!order || !nextStatus) return ''

  if (requiresPrepaidConfirmation(order) && !isPaymentConfirmed(order)) {
    if (['on_the_way', 'arrived', 'completed'].includes(nextStatus)) {
      return 'Konfirmasi pembayaran pelanggan terlebih dahulu sebelum pesanan dilanjutkan ke pengantaran atau diselesaikan.'
    }
  }

  if (
    order.payment_method === 'cod' &&
    nextStatus === 'completed' &&
    !isPaymentConfirmed(order)
  ) {
    return 'Tandai COD lunas terlebih dahulu sebelum menyelesaikan pesanan.'
  }

  return ''
}

export function getOrderOperationalNotice(
  order: OrderLike,
  viewerRole = 'customer',
) {
  if (!order || !isActiveOrderStatus(order.status)) return ''
  if (isPickupOrder(order)) {
    if (order.status === 'pending')
      return viewerRole === 'vendor'
        ? 'Periksa barang, lalu terima atau tolak pesanan.'
        : 'Menunggu konfirmasi pedagang. Bayar setelah pesanan diterima.'
    if (order.status === 'accepted')
      return viewerRole === 'vendor'
        ? 'Siapkan barang, lalu tandai siap diambil.'
        : 'Pesanan diterima. Tunggu barang siap sebelum mengambil atau memesan kurir.'
    return viewerRole === 'vendor'
      ? order.payment_method === 'cod'
        ? 'Serahkan barang dan terima uang, lalu selesaikan pesanan.'
        : 'Periksa pembayaran, serahkan barang, lalu selesaikan pesanan.'
      : 'Barang siap diambil di titik yang disepakati. Pedagang menyelesaikan pesanan setelah serah terima.'
  }

  if (requiresPrepaidConfirmation(order) && !isPaymentConfirmed(order)) {
    return viewerRole === 'vendor'
      ? 'Pesanan ini belum boleh dilanjutkan ke tahap antar atau selesai sampai pembayaran pelanggan benar-benar dikonfirmasi.'
      : 'Pesanan Anda akan dilanjutkan ke tahap antar setelah pembayaran dikonfirmasi pedagang.'
  }

  if (
    order.payment_method === 'cod' &&
    order.status === 'arrived' &&
    !isPaymentConfirmed(order)
  ) {
    return viewerRole === 'vendor'
      ? 'Pertemuan sudah tiba. Tandai COD lunas setelah pembayaran diterima, lalu selesaikan pesanan.'
      : 'Pedagang sudah tiba. Lakukan pembayaran COD saat bertemu agar pesanan bisa diselesaikan.'
  }

  return ''
}

export function getBuyerPaymentActions(
  order: OrderLike,
): OrderProgressAction[] {
  if (!order) return []
  if (
    !(
      isPickupOrder(order)
        ? ['accepted', 'ready']
        : ['pending', 'accepted', 'preparing']
    ).includes(order.status || '')
  )
    return []
  if (
    !['qris', 'bank_transfer', 'ewallet'].includes(order.payment_method || '')
  )
    return []

  if (order.payment_status === 'unpaid') {
    return [
      {
        value: 'pending_confirmation',
        label: 'Saya Sudah Bayar',
        tone: 'primary',
      },
    ]
  }

  if (order.payment_status === 'failed') {
    return [
      {
        value: 'pending_confirmation',
        label: 'Kirim Ulang Konfirmasi',
        tone: 'primary',
      },
    ]
  }

  return []
}

export function getPaymentGuidance(order: OrderLike, viewerRole = 'customer') {
  if (!order) return ''
  if (['cancelled', 'rejected'].includes(order.status || '')) {
    return ['paid', 'pending_confirmation'].includes(order.payment_status || '')
      ? 'Pesanan berakhir. Jika dana sudah terkirim, hubungi pedagang untuk pengembalian.'
      : ''
  }
  if (order.status === 'completed') {
    return order.payment_status === 'paid'
      ? 'Pembayaran sudah dikonfirmasi.'
      : 'Pesanan sudah selesai.'
  }
  const paymentMethodLabel = formatPaymentMethodLabel(order.payment_method)
  if (isPickupOrder(order) && order.status === 'pending')
    return viewerRole === 'vendor'
      ? 'Pembayaran dilakukan setelah Anda menerima pesanan.'
      : 'Bayar setelah pesanan diterima pedagang.'
  if (
    isPickupOrder(order) &&
    order.payment_method === 'cod' &&
    order.payment_status !== 'paid'
  ) {
    return viewerRole === 'vendor'
      ? 'Selesaikan pesanan setelah barang diserahkan dan uang diterima. COD tercatat lunas sekaligus.'
      : 'Bayar barang saat diambil. Untuk kurir, sepakati pembayaran barang lewat chat.'
  }

  if (order.payment_method === 'cod') {
    if (order.payment_status === 'paid') {
      return 'Pembayaran COD sudah dikonfirmasi.'
    }

    return viewerRole === 'vendor'
      ? 'Konfirmasi pembayaran COD dilakukan saat pesanan sudah tiba atau selesai.'
      : 'Pembayaran COD dilakukan saat bertemu pedagang.'
  }

  switch (order.payment_status) {
    case 'unpaid':
      return viewerRole === 'vendor'
        ? `Menunggu pelanggan menyelesaikan pembayaran ${paymentMethodLabel} dan mengirim konfirmasi.`
        : `Gunakan detail ${paymentMethodLabel} dari pedagang, lalu kirim konfirmasi pembayaran agar bisa dicek.`
    case 'pending_confirmation':
      return viewerRole === 'vendor'
        ? `Pelanggan sudah mengirim konfirmasi pembayaran ${paymentMethodLabel}. Cek dana masuk lalu tandai lunas.`
        : `Konfirmasi pembayaran ${paymentMethodLabel} sudah dikirim. Menunggu pedagang memeriksa.`
    case 'failed':
      return viewerRole === 'vendor'
        ? `Konfirmasi ${paymentMethodLabel} sebelumnya ditolak. Tunggu pelanggan mengirim ulang bukti atau pembayaran.`
        : `Konfirmasi pembayaran ${paymentMethodLabel} sebelumnya belum cocok. Silakan kirim ulang setelah memastikan pembayaran berhasil.`
    case 'paid':
      return 'Pembayaran sudah dikonfirmasi dan transaksi bisa dilanjutkan.'
    default:
      return 'Status pembayaran akan diperbarui setelah transaksi diproses.'
  }
}

export function getOrderPaymentDetails(
  order: OrderLike,
  vendor: Partial<Pick<Vendor, 'payment_details'>> | null | undefined,
) {
  const snapshot = order?.vendor_payment_details_snapshot
  // Existing orders keep the payment destination agreed at checkout.
  return snapshot &&
    typeof snapshot === 'object' &&
    !Array.isArray(snapshot) &&
    Object.keys(snapshot).length > 0
    ? snapshot
    : vendor?.payment_details
}

export function getOrderStatusTone(status: string | null | undefined) {
  switch (status) {
    case 'ready':
    case 'accepted':
    case 'preparing':
    case 'on_the_way':
    case 'arrived':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
    case 'completed':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
    case 'cancelled':
    case 'rejected':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

export function getNextVendorStatusActions(
  input: OrderLike | string,
): OrderProgressAction[] {
  if (input && typeof input === 'object' && isPickupOrder(input))
    return pickupActions(input)
  const order = input && typeof input === 'object' ? input : null
  const status = order ? order.status : input

  let actions: OrderProgressAction[]

  switch (status) {
    case 'pending':
      actions = [
        { value: 'accepted', label: 'Terima', tone: 'primary' },
        { value: 'rejected', label: 'Tolak', tone: 'danger' },
      ]
      break
    case 'accepted':
      actions = [
        { value: 'preparing', label: 'Mulai Siapkan', tone: 'primary' },
      ]
      break
    case 'preparing':
      actions = [
        { value: 'on_the_way', label: 'Sedang Diantar', tone: 'primary' },
      ]
      break
    case 'on_the_way':
      actions = [{ value: 'arrived', label: 'Sudah Tiba', tone: 'primary' }]
      break
    case 'arrived':
      actions = [{ value: 'completed', label: 'Selesaikan', tone: 'success' }]
      break
    default:
      actions = []
  }

  if (!order) return actions

  return actions.map((action) => {
    const disabledReason = getVendorStatusTransitionBlockReason(
      order,
      action.value,
    )

    return {
      ...action,
      disabled: Boolean(disabledReason),
      disabledReason,
    }
  })
}

export function isActiveOrderStatus(status: string | null | undefined) {
  return ACTIVE_ORDER_STATUSES.includes(status || '')
}

export function isHistoryOrderStatus(status: string | null | undefined) {
  return HISTORY_ORDER_STATUSES.includes(status || '')
}

export function getOrderStatusSteps(status: string, serviceFlow = 'legacy') {
  const sequence =
    serviceFlow === 'pickup_v1' ? PICKUP_STATUSES : ORDER_STATUS_SEQUENCE
  const label = (step: string) =>
    serviceFlow === 'pickup_v1'
      ? PICKUP_LABELS[step]
      : formatOrderStatusLabel(step)
  if (status === 'cancelled' || status === 'rejected') {
    return ['pending', status].map((step, index) => ({
      key: step,
      label: label(step),
      complete: index === 0,
      active: index === 1,
      pending: false,
    }))
  }

  const activeIndex =
    sequence.indexOf(status) >= 0 ? sequence.indexOf(status) : 0

  return sequence.map((step, index) => ({
    key: step,
    label: label(step),
    complete: activeIndex > index,
    active: activeIndex === index,
    pending: activeIndex < index,
  }))
}

export function isSchemaCompatibilityError(error: unknown) {
  const combined = errorDetails(error).toLowerCase()
  return (
    combined.includes('schema cache') ||
    combined.includes('column') ||
    combined.includes('relation') ||
    combined.includes('does not exist') ||
    combined.includes('could not find')
  )
}

export function buildOrderItemsText(entries: CartEntry[]) {
  const lines = entries.map((entry, index) => {
    const baseLine = `${index + 1}. ${entry.product.name} x${entry.quantity}`
    return entry.note ? `${baseLine}\n   Catatan: ${entry.note}` : baseLine
  })

  return lines.join('\n')
}

export function buildOrderChatMessage({
  buyerName,
  entries,
  orderId = null,
  paymentMethod = 'cod',
  fulfillmentType = 'meetup',
  orderTiming = 'asap',
  requestedFulfillmentAt = null,
  meetingPointLabel = '',
  customerNote = '',
}: {
  buyerName: string
  entries: CartEntry[]
  orderId?: string | null
  paymentMethod?: string
  fulfillmentType?: string
  orderTiming?: string
  requestedFulfillmentAt?: string | null
  meetingPointLabel?: string
  customerNote?: string
}) {
  const summary = buildOrderItemsText(entries)
  const reference = orderId ? `Pesanan #${String(orderId).slice(0, 8)}\n` : ''
  const timingLine = `\nWaktu pesanan: ${formatOrderTimingLabel(orderTiming)}`
  const requestedTimeLine = requestedFulfillmentAt
    ? `\nDiminta sekitar: ${formatRequestedFulfillmentLabel(requestedFulfillmentAt)}`
    : ''
  const meetingPointLine = String(meetingPointLabel || '').trim()
    ? `\n${orderTiming === 'preorder' ? 'Area titip' : 'Titik temu'}: ${String(meetingPointLabel).trim()}`
    : ''
  const noteLine = String(customerNote || '').trim()
    ? `\nCatatan: ${String(customerNote).trim()}`
    : ''
  return `${reference}Halo, saya ${buyerName} ingin memesan:\n${summary}\n\nMetode bayar: ${formatPaymentMethodLabel(paymentMethod)}\nSerah terima: ${formatFulfillmentTypeLabel(fulfillmentType)}${timingLine}${requestedTimeLine}${meetingPointLine}${noteLine}\n\nMohon konfirmasi kesediaan barang dan titik pengambilan sesuai rute pedagang.`
}

export function getFulfillmentTypeHint(fulfillmentType = 'meetup') {
  if (fulfillmentType === 'self_pickup')
    return 'Ambil barang langsung ke pedagang setelah pesanan siap.'
  if (fulfillmentType === 'customer_courier')
    return 'Kurir Anda mengambil barang ke pedagang setelah pesanan siap. Tidak perlu memasukkan lokasi kurir.'
  return fulfillmentType === 'delivery'
    ? 'Gunakan alamat atau patokan yang paling mudah dikenali pedagang. Lokasi saat ini bisa dipakai untuk memperjelas titik antar.'
    : 'Pilih titik temu yang mudah ditemukan. Anda bisa pakai lokasi saat ini agar tracking lebih akurat.'
}
