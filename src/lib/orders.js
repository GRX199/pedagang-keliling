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

export const PAYMENT_METHOD_LABELS = {
  cod: 'COD',
  qris: 'QRIS',
  bank_transfer: 'Transfer',
}

export const PAYMENT_STATUS_LABELS = {
  unpaid: 'Belum dibayar',
  pending_confirmation: 'Menunggu konfirmasi',
  paid: 'Sudah dibayar',
  failed: 'Gagal',
  refunded: 'Dikembalikan',
}

export const FULFILLMENT_TYPE_LABELS = {
  meetup: 'Titik Temu',
  delivery: 'Antar',
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
  return FULFILLMENT_TYPE_LABELS[type] || 'Titik Temu'
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

export function getNextVendorStatusActions(status) {
  switch (status) {
    case 'pending':
      return [
        { value: 'accepted', label: 'Terima', tone: 'primary' },
        { value: 'rejected', label: 'Tolak', tone: 'danger' },
      ]
    case 'accepted':
      return [{ value: 'preparing', label: 'Mulai Siapkan', tone: 'primary' }]
    case 'preparing':
      return [{ value: 'on_the_way', label: 'Sedang Diantar', tone: 'primary' }]
    case 'on_the_way':
      return [{ value: 'arrived', label: 'Sudah Tiba', tone: 'primary' }]
    case 'arrived':
      return [{ value: 'completed', label: 'Selesaikan', tone: 'success' }]
    default:
      return []
  }
}

export function getOrderStatusSteps(status) {
  const currentIndex = ORDER_STATUS_SEQUENCE.indexOf(status)
  const fallbackIndex = status === 'completed' ? ORDER_STATUS_SEQUENCE.length - 1 : currentIndex

  return ORDER_STATUS_SEQUENCE.map((step, index) => ({
    key: step,
    label: formatOrderStatusLabel(step),
    complete: fallbackIndex >= index && currentIndex !== -1,
    active: step === status,
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

export function buildOrderChatMessage({ buyerName, entries, orderId = null }) {
  const summary = buildOrderItemsText(entries)
  const reference = orderId ? `Pesanan #${String(orderId).slice(0, 8)}\n` : ''
  return `${reference}Halo, saya ${buyerName} ingin memesan:\n${summary}\n\nSilakan konfirmasi stok atau detail pengirimannya ya.`
}

export function buildLegacyOrderMetadataText({
  paymentMethod = 'cod',
  fulfillmentType = 'meetup',
  meetingPointLabel = '',
  customerNote = '',
}) {
  const lines = [
    `Pembayaran: ${formatPaymentMethodLabel(paymentMethod)}`,
    `Serah terima: ${formatFulfillmentTypeLabel(fulfillmentType)}`,
  ]

  if (String(meetingPointLabel || '').trim()) {
    lines.push(`Titik temu: ${String(meetingPointLabel).trim()}`)
  }

  if (String(customerNote || '').trim()) {
    lines.push(`Catatan order: ${String(customerNote).trim()}`)
  }

  return lines.join('\n')
}

export function buildLegacyOrderSummary({
  entries,
  paymentMethod = 'cod',
  fulfillmentType = 'meetup',
  meetingPointLabel = '',
  customerNote = '',
}) {
  return [
    buildLegacyOrderMetadataText({
      paymentMethod,
      fulfillmentType,
      meetingPointLabel,
      customerNote,
    }),
    buildOrderItemsText(entries),
  ].filter(Boolean).join('\n---\n')
}

export function parseLegacyOrderSummary(orderText) {
  const raw = String(orderText || '').trim()
  if (!raw) {
    return {
      paymentMethod: null,
      fulfillmentType: null,
      meetingPointLabel: '',
      customerNote: '',
      itemLines: [],
    }
  }

  const [metadataBlock, itemsBlock = ''] = raw.split('\n---\n')
  const metadataLines = metadataBlock.split('\n').map((line) => line.trim()).filter(Boolean)

  const parsed = {
    paymentMethod: null,
    fulfillmentType: null,
    meetingPointLabel: '',
    customerNote: '',
    itemLines: [],
  }

  for (const line of metadataLines) {
    const normalized = line.toLowerCase()
    if (normalized.startsWith('pembayaran:')) {
      if (normalized.includes('qris')) parsed.paymentMethod = 'qris'
      else if (normalized.includes('transfer')) parsed.paymentMethod = 'bank_transfer'
      else parsed.paymentMethod = 'cod'
    } else if (normalized.startsWith('serah terima:')) {
      parsed.fulfillmentType = normalized.includes('antar') ? 'delivery' : 'meetup'
    } else if (normalized.startsWith('titik temu:')) {
      parsed.meetingPointLabel = line.split(':').slice(1).join(':').trim()
    } else if (normalized.startsWith('catatan order:')) {
      parsed.customerNote = line.split(':').slice(1).join(':').trim()
    }
  }

  const itemsSource = itemsBlock || metadataBlock
  parsed.itemLines = itemsSource
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\./.test(line) || line.startsWith('Catatan:'))

  return parsed
}

export function resolveOrderDisplayData(order) {
  const legacy = parseLegacyOrderSummary(order?.items)

  return {
    paymentMethod: order?.payment_method || legacy.paymentMethod || 'cod',
    paymentStatus: order?.payment_status || 'unpaid',
    fulfillmentType: order?.fulfillment_type || legacy.fulfillmentType || 'meetup',
    meetingPointLabel: order?.meeting_point_label || legacy.meetingPointLabel || '',
    customerNote: order?.customer_note || legacy.customerNote || '',
    itemLines: legacy.itemLines,
  }
}

export function buildOrderInsertPayload({
  vendorId,
  vendorName,
  buyerId,
  buyerName,
  entries,
  paymentMethod = 'cod',
  fulfillmentType = 'meetup',
  meetingPointLabel = '',
  customerNote = '',
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
    payment_status: paymentMethod === 'cod' ? 'unpaid' : 'pending_confirmation',
    fulfillment_type: fulfillmentType,
    meeting_point_label: String(meetingPointLabel || '').trim() || null,
    customer_note: String(customerNote || '').trim() || null,
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
