import type { Coordinates, VendorMapItem } from '../../types/domain.types'
import { formatMobility } from '../../lib/pickup'
import { formatReviewScore } from '../../lib/reviews'
import { getVendorCategoryDefinition } from '../../lib/vendor-categories'
import { getVendorCoordinates, getVendorPromoText } from '../../lib/vendor'
type VendorData = VendorMapItem | null | undefined
const LOCATION_SYNC_DISTANCE_METERS = 20

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const radius = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2

  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function hasMeaningfulLocationChange(
  previousLocation: Coordinates | null,
  nextLocation: Coordinates
) {
  if (!previousLocation) return true

  return (
    haversineDistance(
      previousLocation.lat,
      previousLocation.lng,
      nextLocation.lat,
      nextLocation.lng
    ) >= LOCATION_SYNC_DISTANCE_METERS
  )
}

export function getVendorDistance(vendor: VendorData, userLocation: Coordinates | null) {
  const coordinates = getVendorCoordinates(vendor?.location)
  if (!coordinates || !userLocation) return null

  return haversineDistance(userLocation.lat, userLocation.lng, coordinates.lat, coordinates.lng)
}

export function formatDistanceLabel(distanceMeters: number | null) {
  if (typeof distanceMeters !== 'number') return 'Aktifkan lokasi untuk melihat jarak'
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m dari Anda`
  return `${(distanceMeters / 1000).toFixed(1)} km dari Anda`
}

export function normalizeCategoryValue(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export function getVendorCategory(vendor: VendorData) {
  return getVendorCategoryDefinition(vendor?.category_primary || vendor?.map_category).label
}

export function getVendorSearchText(vendor: VendorData) {
  return [
    vendor?.map_search_text,
    vendor?.service_area,
    vendor?.route_description,
    vendor?.stopping_points,
    formatMobility(vendor?.mobility_type),
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
    .toLowerCase()
}

export function getVendorAverageRating(vendor: VendorData) {
  const rating = Number(vendor?.review_average)
  return Number.isFinite(rating) ? rating : 0
}

export function getVendorReviewCount(vendor: VendorData) {
  const count = Number(vendor?.review_count)
  return Number.isFinite(count) ? count : 0
}

export function formatVendorRatingMeta(vendor: VendorData) {
  const reviewCount = getVendorReviewCount(vendor)
  if (reviewCount <= 0) return 'Belum ada ulasan'
  return `${formatReviewScore(getVendorAverageRating(vendor))} • ${reviewCount} ulasan`
}

export function matchesRatingFilter(vendor: VendorData, selectedRatingFilter: string) {
  if (selectedRatingFilter === 'all') return true

  const minimumRating = Number(selectedRatingFilter)
  if (!Number.isFinite(minimumRating)) return true
  if (getVendorReviewCount(vendor) <= 0) return false

  return getVendorAverageRating(vendor) >= minimumRating
}

export function formatVendorPromoTeaser(vendor: VendorData) {
  const promoText = getVendorPromoText(vendor)
  if (!promoText) return ''
  if (promoText.length <= 96) return promoText
  return `${promoText.slice(0, 93)}...`
}

export function isVendorModeratedOut(vendor: VendorData) {
  return vendor?.account_status === 'suspended' || vendor?.account_status === 'blocked'
}

export function getStoreLocationStatus(location: unknown, { owner = false } = {}) {
  const coordinates = getVendorCoordinates(location)
  if (!coordinates) {
    return owner
      ? 'Lokasi toko belum dibagikan. Aktifkan mode online agar posisi toko bisa muncul di peta pelanggan.'
      : 'Lokasi toko belum tersedia di peta.'
  }

  return owner
    ? 'Lokasi toko sudah tersinkron dan siap tampil ke pelanggan saat toko online.'
    : 'Lokasi toko aktif di peta dan siap dipakai untuk estimasi jarak.'
}

export function getPresenceBadgeClass(tone: string) {
  switch (tone) {
    case 'fresh':
      return 'bg-emerald-100 text-emerald-700'
    case 'aging':
      return 'bg-amber-100 text-amber-800'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}
