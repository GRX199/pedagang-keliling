import { useEffect, useRef } from 'react'
import type { Coordinates } from '../../types/domain.types'
import { errorMessage } from '../../shared/lib/utils'
import { useVendorPresence, useSyncVendorLocation } from './useVendorPresence'
import { useToast } from '../../shared/components/ToastProvider'
import { useAuth } from '../auth/AuthProvider'
import { getGeolocationErrorMessage } from '../../lib/network'
import { createVendorLocationPayload, getVendorCoordinates } from '../../lib/vendor'

const LOCATION_SYNC_DISTANCE_METERS = 20
const LOCATION_SYNC_INTERVAL_MS = 15000

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const radius = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2

  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function shouldSyncLocation(
  previousCoordinates: Coordinates | null,
  nextCoordinates: Coordinates,
  lastSyncedAt: number
) {
  if (!previousCoordinates) return true

  const movedEnough =
    haversineDistance(
      previousCoordinates.lat,
      previousCoordinates.lng,
      nextCoordinates.lat,
      nextCoordinates.lng
    ) >= LOCATION_SYNC_DISTANCE_METERS

  const intervalPassed = Date.now() - lastSyncedAt >= LOCATION_SYNC_INTERVAL_MS
  return movedEnough || intervalPassed
}

export default function VendorLiveLocationSync() {
  const { user, role } = useAuth()
  const toast = useToast()
  const isVendor = role === 'vendor'
  const vendorId = user?.id

  const presence = useVendorPresence(vendorId, isVendor)
  const vendorOnline = Boolean(presence.data?.online && presence.data?.is_verified)
  const { mutateAsync: syncLocation } = useSyncVendorLocation(vendorId)
  const watchIdRef = useRef<number | null>(null)
  const lastSyncedCoordinatesRef = useRef<Coordinates | null>(null)
  const lastSyncedAtRef = useRef(0)
  const lastErrorKeyRef = useRef('')
  const announcedOnlineRef = useRef(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    lastSyncedCoordinatesRef.current = null
    lastSyncedAtRef.current = 0
    announcedOnlineRef.current = false
  }, [vendorId])

  useEffect(() => {
    if (!isVendor || !vendorId || !vendorOnline) {
      announcedOnlineRef.current = false
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      watchIdRef.current = null
      return undefined
    }

    if (!navigator.geolocation) {
      if (lastErrorKeyRef.current !== 'unsupported') {
        lastErrorKeyRef.current = 'unsupported'
        toast.push('Browser ini tidak mendukung sinkronisasi lokasi pedagang.', { type: 'error' })
      }
      return undefined
    }

    if (!announcedOnlineRef.current) {
      announcedOnlineRef.current = true
      toast.push('Mode online aktif. Lokasi toko akan diperbarui otomatis saat Anda bergerak.', {
        type: 'info',
      })
    }

    let active = true
    let inFlight = false
    async function syncPosition(position: GeolocationPosition) {
      if (!active || !vendorId || inFlight) return

      const nextCoordinates = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }

      if (
        !shouldSyncLocation(
          lastSyncedCoordinatesRef.current,
          nextCoordinates,
          lastSyncedAtRef.current
        )
      ) {
        return
      }

      const nextLocation = createVendorLocationPayload({
        ...nextCoordinates,
        accuracy: position.coords.accuracy,
      })

      inFlight = true
      try {
        const data = await syncLocation(nextLocation)
        if (!active || !data) return

        lastSyncedCoordinatesRef.current =
          getVendorCoordinates(data?.location || nextLocation) || nextCoordinates
        lastSyncedAtRef.current = Date.now()
        lastErrorKeyRef.current = ''
      } catch (error) {
        console.error('syncVendorLiveLocation', error)
        if (lastErrorKeyRef.current !== 'sync-failed') {
          lastErrorKeyRef.current = 'sync-failed'
          if (active)
            toast.push(errorMessage(error, 'Gagal menyinkronkan lokasi toko secara otomatis.'), {
              type: 'error',
            })
        }
      } finally {
        inFlight = false
      }
    }

    function handlePositionError(error: GeolocationPositionError) {
      const errorKey = `geo:${error?.code || 'unknown'}`
      if (lastErrorKeyRef.current === errorKey) return

      lastErrorKeyRef.current = errorKey
      toast.push(getGeolocationErrorMessage(error), { type: 'error' })
    }

    const geolocationOptions = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    }

    function requestCurrentPositionSync() {
      if (!active || document.visibilityState === 'hidden') return
      navigator.geolocation.getCurrentPosition(
        (position) => {
          void syncPosition(position)
        },
        handlePositionError,
        geolocationOptions
      )
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        requestCurrentPositionSync()
      }
    }

    requestCurrentPositionSync()

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        void syncPosition(position)
      },
      handlePositionError,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      }
    )

    const heartbeat = window.setInterval(requestCurrentPositionSync, LOCATION_SYNC_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(heartbeat)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      watchIdRef.current = null
    }
  }, [isVendor, toast, vendorId, vendorOnline, syncLocation])

  useEffect(() => {
    if (!isVendor || !vendorOnline) {
      const currentWakeLock = wakeLockRef.current
      wakeLockRef.current = null
      if (currentWakeLock && !currentWakeLock.released) {
        void currentWakeLock.release().catch((error) => {
          console.warn('releaseVendorWakeLock', error)
        })
      }
      return undefined
    }

    if (
      typeof document === 'undefined' ||
      typeof navigator === 'undefined' ||
      !('wakeLock' in navigator)
    ) {
      return undefined
    }

    let cancelled = false

    async function requestWakeLock() {
      if (cancelled || document.visibilityState !== 'visible' || wakeLockRef.current) return

      try {
        const wakeLock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          await wakeLock.release().catch((error) => {
            console.warn('releaseCancelledVendorWakeLock', error)
          })
          return
        }

        wakeLockRef.current = wakeLock
        wakeLock.addEventListener('release', () => {
          if (wakeLockRef.current === wakeLock) {
            wakeLockRef.current = null
          }
        })
      } catch (error) {
        console.warn('requestVendorWakeLock', error)
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void requestWakeLock()
      } else {
        wakeLockRef.current = null
      }
    }

    void requestWakeLock()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)

      const currentWakeLock = wakeLockRef.current
      wakeLockRef.current = null
      if (currentWakeLock && !currentWakeLock.released) {
        void currentWakeLock.release().catch((error) => {
          console.warn('releaseVendorWakeLockCleanup', error)
        })
      }
    }
  }, [isVendor, vendorOnline])

  return null
}
