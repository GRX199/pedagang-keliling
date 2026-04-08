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
