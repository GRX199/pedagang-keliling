import type { Coordinates } from '../../types/domain.types'

export function getVendorCoordinates(location: unknown): Coordinates | null {
  if (!location || typeof location !== 'object') return null
  const source = location as Record<string, unknown>
  const pairs: [unknown, unknown][] = [
    [source.lat, source.lng],
    [source.latitude, source.longitude],
  ]
  if (Array.isArray(source.coordinates)) pairs.push([source.coordinates[1], source.coordinates[0]])
  for (const [lat, lng] of pairs) {
    if (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    )
      return { lat, lng }
  }
  return null
}

export function createLocationPayload({
  lat,
  lng,
  accuracy = null,
}: {
  lat: number
  lng: number
  accuracy?: number | null
}) {
  if (!getVendorCoordinates({ lat, lng })) return null
  return {
    lat,
    lng,
    accuracy:
      typeof accuracy === 'number' && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    updated_at: new Date().toISOString(),
  }
}

export const createVendorLocationPayload = createLocationPayload
