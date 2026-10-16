import { getVendorCoordinates } from '../shared/lib/coordinates'
import type { PaymentMethod, Vendor } from '../types/domain.types'
export {
  getVendorCoordinates,
  createLocationPayload,
  createVendorLocationPayload,
} from '../shared/lib/coordinates'

type Presence = Partial<
  Pick<Vendor, 'online' | 'is_verified' | 'last_seen_at'>
> & { location?: unknown }
type Promo = Partial<Pick<Vendor, 'promo_text' | 'promo_expires_at'>>
const recordOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export function getVendorLocationLabel(location: unknown) {
  const coordinates = getVendorCoordinates(location)
  if (!coordinates) return 'Lokasi belum dibagikan'

  return `${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}`
}

export function getDisplayName(value: unknown, fallback = 'Pengguna') {
  if (!value) return fallback
  return String(value).trim() || fallback
}

export const VENDOR_PRESENCE_MAX_AGE_MS = 2 * 60 * 1000

export function getVendorPresenceTime(vendor: Presence | null | undefined) {
  const presenceValue = vendor?.last_seen_at
  const presenceTime = presenceValue ? new Date(presenceValue).getTime() : NaN
  return Number.isFinite(presenceTime) ? presenceTime : null
}

export function isVendorPresenceFresh(
  vendor: Presence | null | undefined,
  now = Date.now(),
) {
  if (
    vendor?.is_verified !== true ||
    !vendor?.online ||
    !getVendorCoordinates(vendor.location)
  )
    return false

  const presenceTime = getVendorPresenceTime(vendor)
  if (!presenceTime) return false

  return (
    now - presenceTime >= -30000 &&
    now - presenceTime <= VENDOR_PRESENCE_MAX_AGE_MS
  )
}

export function formatVendorPresenceAge(
  vendor: Presence | null | undefined,
  now = Date.now(),
) {
  if (!vendor?.online) return 'Offline'

  const presenceTime = getVendorPresenceTime(vendor)
  if (!presenceTime) return 'Belum ada update lokasi'

  const ageMs = Math.max(0, now - presenceTime)
  if (ageMs < 30000) return 'Live sekarang'
  if (ageMs < 60000) return 'Update <1 menit lalu'

  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 60) return `Update ${minutes} menit lalu`

  const hours = Math.floor(minutes / 60)
  return `Update ${hours} jam lalu`
}

export function getVendorPresenceTone(
  vendor: Presence | null | undefined,
  now = Date.now(),
) {
  if (!isVendorPresenceFresh(vendor, now)) return 'stale'

  const presenceTime = getVendorPresenceTime(vendor)
  if (!presenceTime) return 'stale'

  const ageMs = Math.max(0, now - presenceTime)
  return ageMs < 60000 ? 'fresh' : 'aging'
}

function cleanText(value: unknown) {
  return String(value || '').trim()
}

export function normalizeVendorPaymentDetails(paymentDetails: unknown) {
  const source = recordOf(paymentDetails)

  return {
    qris_image_url: cleanText(source.qris_image_url),
    bank_name: cleanText(source.bank_name),
    bank_account_name: cleanText(source.bank_account_name),
    bank_account_number: cleanText(source.bank_account_number),
    ewallet_name: cleanText(source.ewallet_name),
    ewallet_number: cleanText(source.ewallet_number),
    payment_notes: cleanText(source.payment_notes),
  }
}

export function buildVendorPaymentDetailsPayload(paymentDetails: unknown) {
  const normalized = normalizeVendorPaymentDetails(paymentDetails)
  const payload: Record<string, string> = {}

  Object.entries(normalized).forEach(([key, value]) => {
    if (value) payload[key] = value
  })

  return payload
}

export function getVendorPaymentSetupSummary(
  paymentDetails: unknown,
): { method: PaymentMethod; label: string; ready: boolean }[] {
  const normalized = normalizeVendorPaymentDetails(paymentDetails)

  return [
    {
      method: 'qris',
      label: 'QRIS',
      ready: Boolean(normalized.qris_image_url),
    },
    {
      method: 'bank_transfer',
      label: 'Transfer Bank',
      ready: Boolean(normalized.bank_account_number),
    },
    {
      method: 'ewallet',
      label: 'E-Wallet',
      ready: Boolean(normalized.ewallet_number),
    },
  ]
}

export function getVendorAvailablePaymentMethods(
  paymentDetails: unknown,
  { includeCod = true } = {},
) {
  const summary = getVendorPaymentSetupSummary(paymentDetails)
  const methods: PaymentMethod[] = includeCod ? ['cod'] : []

  summary.forEach((entry) => {
    if (entry.ready) {
      methods.push(entry.method)
    }
  })

  return methods
}

export function getVendorPaymentMethodDetails(
  paymentDetails: unknown,
  method: unknown,
): {
  ready: boolean
  title: string
  description: string
  imageUrl: string
  rows: { label: string; value: string }[]
  note: string
} {
  const normalized = normalizeVendorPaymentDetails(paymentDetails)

  if (method === 'qris') {
    return {
      ready: Boolean(normalized.qris_image_url),
      title: 'QRIS Pedagang',
      description: 'Scan kode QR ini dari aplikasi bank atau e-wallet Anda.',
      imageUrl: normalized.qris_image_url,
      rows: [],
      note: normalized.payment_notes,
    }
  }

  if (method === 'bank_transfer') {
    return {
      ready: Boolean(normalized.bank_account_number),
      title: 'Transfer Bank',
      description: 'Gunakan rekening berikut untuk transfer manual.',
      imageUrl: '',
      rows: [
        { label: 'Bank', value: normalized.bank_name },
        { label: 'Atas nama', value: normalized.bank_account_name },
        { label: 'Nomor rekening', value: normalized.bank_account_number },
      ].filter((row) => row.value),
      note: normalized.payment_notes,
    }
  }

  if (method === 'ewallet') {
    return {
      ready: Boolean(normalized.ewallet_number),
      title: 'E-Wallet',
      description: 'Gunakan nomor e-wallet berikut untuk pembayaran non-tunai.',
      imageUrl: '',
      rows: [
        { label: 'Aplikasi', value: normalized.ewallet_name },
        { label: 'Nomor', value: normalized.ewallet_number },
      ].filter((row) => row.value),
      note: normalized.payment_notes,
    }
  }

  return {
    ready: true,
    title: 'COD',
    description: 'Pembayaran dilakukan saat bertemu pedagang.',
    imageUrl: '',
    rows: [],
    note: '',
  }
}

export function getVendorLocationUpdatedAtLabel(location: unknown) {
  const updatedAt = recordOf(location).updated_at
  if (typeof updatedAt !== 'string' || !updatedAt)
    return 'Belum pernah disinkronkan'

  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return 'Belum pernah disinkronkan'

  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatVendorServiceMode(mode: unknown) {
  switch (mode) {
    case 'delivery':
      return 'Antar ke pelanggan'
    case 'both':
      return 'Antar dan titik temu'
    case 'meetup':
    default:
      return 'Titik temu'
  }
}

export function formatVendorCategoryLabel(categoryName: unknown) {
  return String(categoryName || '').trim() || 'Belum diatur'
}

export function formatVendorServiceRadius(serviceRadiusKm: unknown) {
  const radius = Number(serviceRadiusKm)
  if (!Number.isFinite(radius) || radius <= 0) {
    return 'Menyesuaikan area sekitar pedagang'
  }

  return `Sekitar ${radius.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
}

export function getOperatingHoursText(operatingHours: unknown) {
  if (!operatingHours) return 'Belum diatur'

  if (typeof operatingHours === 'string') {
    return String(operatingHours).trim() || 'Belum diatur'
  }

  if (typeof recordOf(operatingHours).text === 'string') {
    return String(recordOf(operatingHours).text).trim() || 'Belum diatur'
  }

  return 'Belum diatur'
}

export function buildOperatingHoursPayload(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return null

  return { text }
}

export function getVendorPromoText(vendor: Promo | null | undefined) {
  return String(vendor?.promo_text || '').trim()
}

export function getVendorPromoExpiry(vendor: Promo | null | undefined) {
  const rawValue = vendor?.promo_expires_at
  if (!rawValue) return null

  const date = new Date(rawValue)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isVendorPromoActive(vendor: Promo | null | undefined) {
  const promoText = getVendorPromoText(vendor)
  if (!promoText) return false

  const expiryDate = getVendorPromoExpiry(vendor)
  if (!expiryDate) return true

  return expiryDate.getTime() > Date.now()
}

export function formatVendorPromoExpiry(vendor: Promo | null | undefined) {
  const expiryDate = getVendorPromoExpiry(vendor)
  if (!expiryDate) return 'Selama promo masih aktif'

  return expiryDate.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
