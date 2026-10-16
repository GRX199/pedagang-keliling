import { useCallback, useEffect, useRef, useState } from 'react'
import type { Coordinates } from '../../types/domain.types'

export function useGeolocation() {
  const [location, setLocation] = useState<Coordinates | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    []
  )
  const locate = useCallback(async (): Promise<Coordinates | null> => {
    const version = ++request.current
    setPending(true)
    setError('')
    try {
      if (!navigator.geolocation) throw new Error('Browser belum mendukung lokasi.')
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 30_000,
          timeout: 15_000,
        })
      )
      const point = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }
      if (version !== request.current) return null
      setLocation(point)
      return point
    } catch {
      if (version === request.current)
        setError('Lokasi belum terbaca. Periksa izin lokasi dan coba lagi.')
      return null
    } finally {
      if (version === request.current) setPending(false)
    }
  }, [])
  return { location, error, pending, locate }
}
