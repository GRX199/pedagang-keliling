import { useEffect, useState } from 'react'
import { getVendorCoordinates } from '../lib/coordinates'
import type { Coordinates } from '../../types/domain.types'

export function useLiveViewerLocation(enabled: boolean): Coordinates | null {
  const [point, setPoint] = useState<Coordinates | null>(null)
  useEffect(() => {
    if (!enabled || !navigator.geolocation) return
    let watch: number | undefined
    let generation = 0
    const stop = () => {
      generation++
      if (watch !== undefined) navigator.geolocation.clearWatch(watch)
      watch = undefined
    }
    const start = () => {
      stop()
      if (document.visibilityState !== 'visible') return
      const version = generation
      watch = navigator.geolocation.watchPosition(
        (position) => {
          if (generation !== version) return
          const next = getVendorCoordinates({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          })
          if (next) setPoint(next)
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 },
      )
    }
    start()
    document.addEventListener('visibilitychange', start)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', start)
    }
  }, [enabled])
  return enabled ? point : null
}
