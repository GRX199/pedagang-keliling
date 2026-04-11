export function formatPriceLabel(price) {
  if (price === null || typeof price === 'undefined') return 'Harga belum diatur'
  return `Rp ${Number(price).toLocaleString('id-ID')}`
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
