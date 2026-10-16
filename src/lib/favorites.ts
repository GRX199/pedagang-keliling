import { errorDetails } from '../shared/lib/utils'

function normalizeText(value: unknown) {
  return String(value || '').trim()
}

export function normalizeFavoriteVendorIds(
  rows: readonly { vendor_id?: string | null }[] | null | undefined,
) {
  const uniqueIds = new Set<string>()

  for (const row of rows || []) {
    const vendorId = normalizeText(row?.vendor_id)
    if (vendorId) uniqueIds.add(vendorId)
  }

  return Array.from(uniqueIds)
}

export function isVendorFavorited(
  favoriteVendorIds: readonly string[] | null | undefined,
  vendorId: unknown,
) {
  const targetVendorId = normalizeText(vendorId)
  if (!targetVendorId) return false

  return (favoriteVendorIds || []).some(
    (value) => normalizeText(value) === targetVendorId,
  )
}

export function formatFavoriteCountLabel(count: unknown) {
  const total = Number(count)
  if (!Number.isFinite(total) || total <= 0) return 'Belum ada favorit'
  if (total === 1) return '1 toko favorit'
  return `${total} toko favorit`
}

export function isFavoritesSchemaCompatibilityError(error: unknown) {
  const combined = errorDetails(error).toLowerCase()

  return (
    combined.includes('favorites') &&
    (combined.includes('does not exist') ||
      combined.includes('could not find') ||
      combined.includes('schema cache') ||
      combined.includes('not found'))
  )
}
