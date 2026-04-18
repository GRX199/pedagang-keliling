function normalizeText(value) {
  return String(value || '').trim()
}

export function normalizeFavoriteVendorIds(rows) {
  const uniqueIds = new Set()

  for (const row of rows || []) {
    const vendorId = normalizeText(row?.vendor_id)
    if (vendorId) uniqueIds.add(vendorId)
  }

  return Array.from(uniqueIds)
}

export function isVendorFavorited(favoriteVendorIds, vendorId) {
  const targetVendorId = normalizeText(vendorId)
  if (!targetVendorId) return false

  return (favoriteVendorIds || []).some((value) => normalizeText(value) === targetVendorId)
}

export function formatFavoriteCountLabel(count) {
  const total = Number(count)
  if (!Number.isFinite(total) || total <= 0) return 'Belum ada favorit'
  if (total === 1) return '1 toko favorit'
  return `${total} toko favorit`
}

export function isFavoritesSchemaCompatibilityError(error) {
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  const combined = `${message} ${details} ${hint}`

  return (
    combined.includes('favorites') &&
    (
      combined.includes('does not exist') ||
      combined.includes('could not find') ||
      combined.includes('schema cache') ||
      combined.includes('not found')
    )
  )
}
