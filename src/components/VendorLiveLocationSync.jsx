import { useEffect, useRef, useState } from 'react'
import { useToast } from './ToastProvider'
import { useAuth } from '../lib/auth'
import { getGeolocationErrorMessage } from '../lib/network'
import { supabase } from '../lib/supabase'
import { createVendorLocationPayload, getVendorCoordinates } from '../lib/vendor'

const LOCATION_SYNC_DISTANCE_METERS = 20
const LOCATION_SYNC_INTERVAL_MS = 15000

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180
  const radius = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2

  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function shouldSyncLocation(previousCoordinates, nextCoordinates, lastSyncedAt) {
  if (!previousCoordinates) return true

  const movedEnough = haversineDistance(
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
  const isVendor = role === 'vendor' || user?.user_metadata?.is_vendor === true
  const vendorId = user?.id

  const [vendorOnline, setVendorOnline] = useState(false)
  const watchIdRef = useRef(null)
  const lastSyncedCoordinatesRef = useRef(null)
  const lastSyncedAtRef = useRef(0)
  const lastErrorKeyRef = useRef('')
  const announcedOnlineRef = useRef(false)

  useEffect(() => {
    if (!isVendor || !vendorId) {
      setVendorOnline(false)
      lastSyncedCoordinatesRef.current = null
      lastSyncedAtRef.current = 0
      announcedOnlineRef.current = false
      return undefined
    }

    let active = true

    async function loadVendorPresence() {
      try {
        const { data, error } = await supabase
          .from('vendors')
          .select('id, online, location')
          .eq('id', vendorId)
          .maybeSingle()

        if (error) throw error
        if (!active) return

        setVendorOnline(Boolean(data?.online))

        const coordinates = getVendorCoordinates(data?.location)
        if (coordinates) {
          lastSyncedCoordinatesRef.current = coordinates
        }

        const updatedAt = data?.location?.updated_at
        const updatedTime = updatedAt ? new Date(updatedAt).getTime() : NaN
        if (!Number.isNaN(updatedTime)) {
          lastSyncedAtRef.current = updatedTime
        }
      } catch (error) {
        console.error('loadVendorPresence', error)
      }
    }

    void loadVendorPresence()

    const channel = supabase
      .channel(`vendor-live-sync-${vendorId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors', filter: `id=eq.${vendorId}` }, (payload) => {
        const row = payload.new || payload.old
        if (!row) return

        setVendorOnline(Boolean(row.online))
        const coordinates = getVendorCoordinates(row.location)
        if (coordinates) {
          lastSyncedCoordinatesRef.current = coordinates
        }

        const updatedAt = row.location?.updated_at
        const updatedTime = updatedAt ? new Date(updatedAt).getTime() : NaN
        if (!Number.isNaN(updatedTime)) {
          lastSyncedAtRef.current = updatedTime
        }
      })
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeVendorLiveSyncChannel', error)
      }
    }
  }, [isVendor, vendorId])

  useEffect(() => {
    if (!vendorOnline) {
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
      toast.push('Mode online aktif. Lokasi toko akan diperbarui otomatis saat Anda bergerak.', { type: 'info' })
    }

    async function syncPosition(position) {
      const nextCoordinates = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }

      if (!shouldSyncLocation(
        lastSyncedCoordinatesRef.current,
        nextCoordinates,
        lastSyncedAtRef.current
      )) {
        return
      }

      const nextLocation = createVendorLocationPayload({
        ...nextCoordinates,
        accuracy: position.coords.accuracy,
      })

      try {
        const { data, error } = await supabase
          .from('vendors')
          .update({ location: nextLocation })
          .eq('id', vendorId)
          .select('location')
          .maybeSingle()

        if (error) throw error

        lastSyncedCoordinatesRef.current = getVendorCoordinates(data?.location || nextLocation) || nextCoordinates
        lastSyncedAtRef.current = Date.now()
        lastErrorKeyRef.current = ''
      } catch (error) {
        console.error('syncVendorLiveLocation', error)
        if (lastErrorKeyRef.current !== 'sync-failed') {
          lastErrorKeyRef.current = 'sync-failed'
          toast.push(error.message || 'Gagal menyinkronkan lokasi toko secara otomatis.', { type: 'error' })
        }
      }
    }

    function handlePositionError(error) {
      const errorKey = `geo:${error?.code || 'unknown'}`
      if (lastErrorKeyRef.current === errorKey) return

      lastErrorKeyRef.current = errorKey
      toast.push(getGeolocationErrorMessage(error), { type: 'error' })
    }

    navigator.geolocation.getCurrentPosition(
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

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      watchIdRef.current = null
    }
  }, [toast, vendorId, vendorOnline])

  return null
}
