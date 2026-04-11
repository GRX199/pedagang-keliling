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
  if (typeof lat !== 'number' || typeof lng !== 'number') return null

  return {
    lat,
    lng,
    accuracy: typeof accuracy === 'number' ? Math.round(accuracy) : null,
    updated_at: new Date().toISOString(),
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
