export function getVendorCoordinates(location) {
  if (!location) return null

  if (typeof location.lat === 'number' && typeof location.lng === 'number') {
    return { lat: location.lat, lng: location.lng }
  }

  if (typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    return { lat: location.latitude, lng: location.longitude }
  }

  if (location.type === 'Point' && Array.isArray(location.coordinates)) {
    const [lng, lat] = location.coordinates
    if (typeof lat === 'number' && typeof lng === 'number') {
      return { lat, lng }
    }
  }

  if (Array.isArray(location.coordinates)) {
    const [lng, lat] = location.coordinates
    if (typeof lat === 'number' && typeof lng === 'number') {
      return { lat, lng }
    }
  }

  return null
}

export function createLocationPayload({ lat, lng, accuracy = null }) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null

  return {
    lat,
    lng,
    accuracy: typeof accuracy === 'number' ? Math.round(accuracy) : null,
    updated_at: new Date().toISOString(),
  }
}

export function getVendorLocationLabel(location) {
  const coordinates = getVendorCoordinates(location)
  if (!coordinates) return 'Lokasi belum dibagikan'

  return `${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}`
}

export function getDisplayName(value, fallback = 'Pengguna') {
  if (!value) return fallback
  return String(value).trim() || fallback
}

export function createVendorLocationPayload({ lat, lng, accuracy = null }) {
  return createLocationPayload({ lat, lng, accuracy })
}

function cleanText(value) {
  return String(value || '').trim()
}

export function normalizeVendorPaymentDetails(paymentDetails) {
  const source = paymentDetails && typeof paymentDetails === 'object' ? paymentDetails : {}

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

export function buildVendorPaymentDetailsPayload(paymentDetails) {
  const normalized = normalizeVendorPaymentDetails(paymentDetails)
  const payload = {}

  Object.entries(normalized).forEach(([key, value]) => {
    if (value) payload[key] = value
  })

  return payload
}

export function getVendorPaymentSetupSummary(paymentDetails) {
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

export function getVendorAvailablePaymentMethods(paymentDetails, { includeCod = true } = {}) {
  const summary = getVendorPaymentSetupSummary(paymentDetails)
  const methods = includeCod ? ['cod'] : []

  summary.forEach((entry) => {
    if (entry.ready) {
      methods.push(entry.method)
    }
  })

  return methods
}

export function getVendorPaymentMethodDetails(paymentDetails, method) {
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

export function getVendorLocationUpdatedAtLabel(location) {
  const updatedAt = location?.updated_at
  if (!updatedAt) return 'Belum pernah disinkronkan'

  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return 'Belum pernah disinkronkan'

  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatVendorServiceMode(mode) {
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

export function formatVendorCategoryLabel(categoryName) {
  return String(categoryName || '').trim() || 'Belum diatur'
}

export function formatVendorServiceRadius(serviceRadiusKm) {
  const radius = Number(serviceRadiusKm)
  if (!Number.isFinite(radius) || radius <= 0) {
    return 'Menyesuaikan area sekitar pedagang'
  }

  return `Sekitar ${radius.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
}

export function getOperatingHoursText(operatingHours) {
  if (!operatingHours) return 'Belum diatur'

  if (typeof operatingHours === 'string') {
    return String(operatingHours).trim() || 'Belum diatur'
  }

  if (typeof operatingHours?.text === 'string') {
    return String(operatingHours.text).trim() || 'Belum diatur'
  }

  return 'Belum diatur'
}

export function buildOperatingHoursPayload(value) {
  const text = String(value || '').trim()
  if (!text) return null

  return { text }
}

export function getVendorPromoText(vendor) {
  return String(vendor?.promo_text || '').trim()
}

export function getVendorPromoExpiry(vendor) {
  const rawValue = vendor?.promo_expires_at
  if (!rawValue) return null

  const date = new Date(rawValue)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isVendorPromoActive(vendor) {
  const promoText = getVendorPromoText(vendor)
  if (!promoText) return false

  const expiryDate = getVendorPromoExpiry(vendor)
  if (!expiryDate) return true

  return expiryDate.getTime() > Date.now()
}

export function formatVendorPromoExpiry(vendor) {
  const expiryDate = getVendorPromoExpiry(vendor)
  if (!expiryDate) return 'Selama promo masih aktif'

  return expiryDate.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
