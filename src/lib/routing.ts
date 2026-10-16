import type { Coordinates } from '../types/domain.types'
import { getVendorCoordinates } from '../shared/lib/coordinates'

export type DrivingRoute = {
  distanceMeters: number | null
  durationSeconds: number | null
  latLngs: [number, number][]
  provider: string
}
const recordOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const DEFAULT_ROUTING_API_URL = 'https://router.project-osrm.org'

function getRoutingApiBase() {
  return String(import.meta.env.VITE_ROUTING_API_URL || DEFAULT_ROUTING_API_URL)
    .trim()
    .replace(/\/$/, '')
}

export async function fetchDrivingRoute({
  from,
  to,
  signal,
}: {
  from: Coordinates | null
  to: Coordinates | null
  signal?: AbortSignal
}): Promise<DrivingRoute> {
  if (
    !getVendorCoordinates(from) ||
    !getVendorCoordinates(to) ||
    !from ||
    !to
  ) {
    throw new Error('Koordinat rute tidak lengkap')
  }

  const routingApiBase = getRoutingApiBase()
  const url = new URL(
    `/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}`,
    `${routingApiBase}/`,
  )

  url.searchParams.set('overview', 'full')
  url.searchParams.set('geometries', 'geojson')
  url.searchParams.set('steps', 'false')

  const response = await fetch(url.toString(), { signal })
  if (!response.ok) {
    throw new Error(`Routing API error ${response.status}`)
  }

  const payload = recordOf(await response.json())
  if (
    payload.code !== 'Ok' ||
    !Array.isArray(payload.routes) ||
    payload.routes.length === 0
  ) {
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : 'Rute jalan tidak ditemukan',
    )
  }

  const route = recordOf(payload.routes[0])
  const geometry = recordOf(route.geometry)
  const latLngs: [number, number][] = Array.isArray(geometry.coordinates)
    ? geometry.coordinates
        .map((coordinate: unknown): [number, number] | null => {
          if (!Array.isArray(coordinate) || coordinate.length < 2) return null
          const [lng, lat] = coordinate
          if (
            typeof lat !== 'number' ||
            typeof lng !== 'number' ||
            !getVendorCoordinates({ lat, lng })
          )
            return null
          return [lat, lng]
        })
        .filter((point): point is [number, number] => point !== null)
    : []

  if (latLngs.length < 2) {
    throw new Error('Geometry rute tidak lengkap')
  }

  return {
    distanceMeters:
      typeof route.distance === 'number' &&
      Number.isFinite(route.distance) &&
      route.distance >= 0
        ? route.distance
        : null,
    durationSeconds:
      typeof route.duration === 'number' &&
      Number.isFinite(route.duration) &&
      route.duration >= 0
        ? route.duration
        : null,
    latLngs,
    provider: routingApiBase,
  }
}
