const DEFAULT_ROUTING_API_URL = 'https://router.project-osrm.org'

function getRoutingApiBase() {
  return String(import.meta.env.VITE_ROUTING_API_URL || DEFAULT_ROUTING_API_URL).trim().replace(/\/$/, '')
}

export async function fetchDrivingRoute({ from, to, signal }) {
  if (!from || !to) {
    throw new Error('Koordinat rute tidak lengkap')
  }

  const routingApiBase = getRoutingApiBase()
  const url = new URL(
    `/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}`,
    `${routingApiBase}/`
  )

  url.searchParams.set('overview', 'full')
  url.searchParams.set('geometries', 'geojson')
  url.searchParams.set('steps', 'false')

  const response = await fetch(url.toString(), { signal })
  if (!response.ok) {
    throw new Error(`Routing API error ${response.status}`)
  }

  const payload = await response.json()
  if (payload.code !== 'Ok' || !Array.isArray(payload.routes) || payload.routes.length === 0) {
    throw new Error(payload.message || 'Rute jalan tidak ditemukan')
  }

  const route = payload.routes[0]
  const latLngs = Array.isArray(route.geometry?.coordinates)
    ? route.geometry.coordinates
      .map((coordinate) => {
        if (!Array.isArray(coordinate) || coordinate.length < 2) return null
        const [lng, lat] = coordinate
        if (typeof lat !== 'number' || typeof lng !== 'number') return null
        return [lat, lng]
      })
      .filter(Boolean)
    : []

  if (latLngs.length < 2) {
    throw new Error('Geometry rute tidak lengkap')
  }

  return {
    distanceMeters: typeof route.distance === 'number' ? route.distance : null,
    durationSeconds: typeof route.duration === 'number' ? route.duration : null,
    latLngs,
    provider: routingApiBase,
  }
}
