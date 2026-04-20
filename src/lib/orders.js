export function formatPriceLabel(price) {
  if (price === null || typeof price === 'undefined') return 'Harga belum diatur'
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

export const ORDER_STATUS_LABELS = {
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
  'pending',
  'accepted',
  'preparing',
  'on_the_way',
  'arrived',
]

export const HISTORY_ORDER_STATUSES = [
  'completed',
  'cancelled',
  'rejected',
]

export const PAYMENT_METHOD_LABELS = {
  cod: 'COD',
  qris: 'QRIS',
  bank_transfer: 'Transfer Bank',
  ewallet: 'E-Wallet',
}

export const PAYMENT_STATUS_LABELS = {
  unpaid: 'Belum dibayar',
  pending_confirmation: 'Menunggu konfirmasi',
  paid: 'Sudah dibayar',
  failed: 'Gagal',
  refunded: 'Dikembalikan',
}

export const FULFILLMENT_TYPE_LABELS = {
  meetup: 'Titik temu',
  delivery: 'Antar',
}

export const ORDER_TIMING_LABELS = {
  asap: 'Pesan sekarang',
  preorder: 'Titip untuk nanti',
}

export function formatOrderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || String(status || 'pending')
}

export function formatPaymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || 'COD'
}

export function formatPaymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || 'Belum dibayar'
}

export function formatFulfillmentTypeLabel(type) {
  return FULFILLMENT_TYPE_LABELS[type] || 'Titik temu'
}

export function formatOrderTimingLabel(value) {
  return ORDER_TIMING_LABELS[value] || ORDER_TIMING_LABELS.asap
}

export function formatRequestedFulfillmentLabel(value) {
  if (!value) return 'Waktu belum ditentukan'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Waktu belum ditentukan'

  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function getOrderTimingHint(orderTiming = 'asap') {
  return orderTiming === 'preorder'
    ? 'Gunakan mode ini jika Anda ingin pedagang menyiapkan pesanan untuk area Anda pada waktu tertentu, bukan langsung sekarang.'
    : 'Gunakan mode ini jika Anda ingin pedagang memproses pesanan dan menindaklanjuti chat secepatnya.'
}

export function getVendorPaymentActions(order) {
  if (!order) return []

  if (order.payment_method === 'cod') {
    if (['arrived', 'completed'].includes(order.status) && order.payment_status !== 'paid') {
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

function requiresPrepaidConfirmation(order) {
  return ['qris', 'bank_transfer', 'ewallet'].includes(order?.payment_method)
}

function isPaymentConfirmed(order) {
  return order?.payment_status === 'paid'
}

export function getVendorStatusTransitionBlockReason(order, nextStatus) {
  if (!order || !nextStatus) return ''

  if (requiresPrepaidConfirmation(order) && !isPaymentConfirmed(order)) {
    if (['on_the_way', 'arrived', 'completed'].includes(nextStatus)) {
      return 'Konfirmasi pembayaran pelanggan terlebih dahulu sebelum pesanan dilanjutkan ke pengantaran atau diselesaikan.'
    }
  }

  if (order.payment_method === 'cod' && nextStatus === 'completed' && !isPaymentConfirmed(order)) {
    return 'Tandai COD lunas terlebih dahulu sebelum menyelesaikan pesanan.'
  }

  return ''
}

export function getOrderOperationalNotice(order, viewerRole = 'customer') {
  if (!order) return ''

  if (requiresPrepaidConfirmation(order) && !isPaymentConfirmed(order)) {
    return viewerRole === 'vendor'
      ? 'Pesanan ini belum boleh dilanjutkan ke tahap antar atau selesai sampai pembayaran pelanggan benar-benar dikonfirmasi.'
      : 'Pesanan Anda akan dilanjutkan ke tahap antar setelah pembayaran dikonfirmasi pedagang.'
  }

  if (order.payment_method === 'cod' && order.status === 'arrived' && !isPaymentConfirmed(order)) {
    return viewerRole === 'vendor'
      ? 'Pertemuan sudah tiba. Tandai COD lunas setelah pembayaran diterima, lalu selesaikan pesanan.'
      : 'Pedagang sudah tiba. Lakukan pembayaran COD saat bertemu agar pesanan bisa diselesaikan.'
  }

  return ''
}

export function getBuyerPaymentActions(order) {
  if (!order) return []
  if (!['qris', 'bank_transfer', 'ewallet'].includes(order.payment_method)) return []

  if (order.payment_status === 'unpaid') {
    return [{ value: 'pending_confirmation', label: 'Saya Sudah Bayar', tone: 'primary' }]
  }

  if (order.payment_status === 'failed') {
    return [{ value: 'pending_confirmation', label: 'Kirim Ulang Konfirmasi', tone: 'primary' }]
  }

  return []
}

export function getPaymentGuidance(order, viewerRole = 'customer') {
  if (!order) return ''
  const paymentMethodLabel = formatPaymentMethodLabel(order.payment_method)

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

export function getOrderStatusTone(status) {
  switch (status) {
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

export function getNextVendorStatusActions(input) {
  const order = input && typeof input === 'object' ? input : null
  const status = order ? order.status : input

  let actions = []

  switch (status) {
    case 'pending':
      actions = [
        { value: 'accepted', label: 'Terima', tone: 'primary' },
        { value: 'rejected', label: 'Tolak', tone: 'danger' },
      ]
      break
    case 'accepted':
      actions = [{ value: 'preparing', label: 'Mulai Siapkan', tone: 'primary' }]
      break
    case 'preparing':
      actions = [{ value: 'on_the_way', label: 'Sedang Diantar', tone: 'primary' }]
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
    const disabledReason = getVendorStatusTransitionBlockReason(order, action.value)

    return {
      ...action,
      disabled: Boolean(disabledReason),
      disabledReason,
    }
  })
}

export function isActiveOrderStatus(status) {
  return ACTIVE_ORDER_STATUSES.includes(status)
}

export function isHistoryOrderStatus(status) {
  return HISTORY_ORDER_STATUSES.includes(status)
}

export function getOrderStatusSteps(status) {
  if (status === 'cancelled' || status === 'rejected') {
    return ['pending', status].map((step, index) => ({
      key: step,
      label: formatOrderStatusLabel(step),
      complete: index === 0,
      active: index === 1,
      pending: false,
    }))
  }

  const activeIndex = ORDER_STATUS_SEQUENCE.indexOf(status) >= 0
    ? ORDER_STATUS_SEQUENCE.indexOf(status)
    : 0

  return ORDER_STATUS_SEQUENCE.map((step, index) => ({
    key: step,
    label: formatOrderStatusLabel(step),
    complete: activeIndex > index,
    active: activeIndex === index,
    pending: activeIndex < index,
  }))
}

export function isSchemaCompatibilityError(error) {
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  const combined = `${message} ${details} ${hint}`

  return (
    combined.includes('schema cache') ||
    combined.includes('column') ||
    combined.includes('relation') ||
    combined.includes('does not exist') ||
    combined.includes('could not find')
  )
}

export function getCartEntries(cartMap, products) {
  return products
    .map((product) => {
      const entry = cartMap[product.id]
      if (!entry?.quantity) return null
      return {
        product,
        quantity: Number(entry.quantity) || 0,
        note: String(entry.note || '').trim(),
      }
    })
    .filter((entry) => entry && entry.quantity > 0)
}

export function buildOrderItemsText(entries) {
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
  return `${reference}Halo, saya ${buyerName} ingin memesan:\n${summary}\n\nMetode bayar: ${formatPaymentMethodLabel(paymentMethod)}\nSerah terima: ${formatFulfillmentTypeLabel(fulfillmentType)}${timingLine}${requestedTimeLine}${meetingPointLine}${noteLine}\n\nSilakan konfirmasi stok, pembayaran, atau detail pengirimannya ya.`
}

export function buildOrderInsertPayload({
  vendorId,
  vendorName,
  buyerId,
  buyerName,
  entries,
  paymentMethod = 'cod',
  fulfillmentType = 'meetup',
  orderTiming = 'asap',
  requestedFulfillmentAt = null,
  meetingPointLabel = '',
  meetingPointLocation = null,
  customerNote = '',
  customerLocation = null,
  vendorLocationSnapshot = null,
}) {
  const totals = getCartTotals(entries)

  return {
    vendor_id: vendorId,
    vendor_name: vendorName || 'Pedagang',
    buyer_id: buyerId,
    buyer_name: buyerName || 'Pelanggan',
    items: buildOrderItemsText(entries),
    status: 'pending',
    payment_method: paymentMethod,
    payment_status: 'unpaid',
    fulfillment_type: fulfillmentType,
    order_timing: orderTiming,
    requested_fulfillment_at: requestedFulfillmentAt || null,
    meeting_point_label: String(meetingPointLabel || '').trim() || null,
    meeting_point_location: meetingPointLocation || null,
    customer_note: String(customerNote || '').trim() || null,
    customer_location: customerLocation || null,
    vendor_location_snapshot: vendorLocationSnapshot || null,
    subtotal_amount: totals.estimatedTotal,
    delivery_fee: 0,
    total_amount: totals.estimatedTotal,
  }
}

export function buildOrderItemRows({ orderId, vendorId, entries }) {
  return entries.map((entry) => {
    const quantity = Number(entry.quantity) || 0
    const price = Number(entry.product.price || 0)

    return {
      order_id: orderId,
      product_id: entry.product.id,
      vendor_id: vendorId,
      product_name_snapshot: entry.product.name,
      price_snapshot: price,
      quantity,
      line_total: quantity * price,
      item_note: entry.note || null,
    }
  })
}

export function getCartTotals(entries) {
  return entries.reduce((summary, entry) => {
    const quantity = Number(entry.quantity) || 0
    const price = Number(entry.product.price || 0)
    summary.items += quantity
    summary.types += 1
    summary.estimatedTotal += quantity * price
    return summary
  }, {
    items: 0,
    types: 0,
    estimatedTotal: 0,
  })
}

export function getMeetingPointPresetOptions(fulfillmentType = 'meetup') {
  if (fulfillmentType === 'delivery') {
    return [
      { label: 'Gunakan lokasi saya saat ini', usesCurrentLocation: true },
      { label: 'Rumah / alamat utama' },
      { label: 'Kantor / tempat usaha' },
      { label: 'Gerbang komplek / lobby' },
    ]
  }

  return [
    { label: 'Gunakan lokasi saya saat ini', usesCurrentLocation: true },
    { label: 'Depan rumah' },
    { label: 'Gerbang gang' },
    { label: 'Minimarket terdekat' },
  ]
}

export function getMeetingPointPlaceholder(fulfillmentType = 'meetup') {
  return fulfillmentType === 'delivery'
    ? 'Alamat singkat atau patokan antar'
    : 'Contoh: depan gang, minimarket dekat rumah'
}

export function getFulfillmentTypeHint(fulfillmentType = 'meetup') {
  return fulfillmentType === 'delivery'
    ? 'Gunakan alamat atau patokan yang paling mudah dikenali pedagang. Lokasi saat ini bisa dipakai untuk memperjelas titik antar.'
    : 'Pilih titik temu yang mudah ditemukan. Anda bisa pakai lokasi saat ini agar tracking lebih akurat.'
}
