import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../shared/lib/supabase'
import { getBrowserPosition } from '../../shared/lib/geolocation'
import { getVendorCoordinates, isVendorPresenceFresh } from '../../lib/vendor'
import { haversineDistance } from '../map/map-model'
import type { Role } from '../../types/domain.types'
import type { useToast } from '../../shared/components/ToastProvider'

type Alert = { id: string; text: string }
type Props = {
  userId: string
  role: Role | null
  pathname: string
  push: ReturnType<typeof useToast>['push']
}

export function useNearbyAlerts({ userId, role, pathname, push }: Props) {
  const onMap = useRef(pathname === '/map')
  onMap.current = pathname === '/map'
  const prompted = useRef(false)
  const seen = useRef({ userId, ids: new Set<string>() })
  if (seen.current.userId !== userId) {
    seen.current = { userId, ids: new Set() }
    prompted.current = false
  }
  const query = useQuery({
    queryKey: ['nearby-alerts', userId],
    enabled: !!userId && role === 'customer',
    refetchInterval: 60_000,
    queryFn: async ({ signal }): Promise<Alert[]> => {
      const alerts: Alert[] = []
      const [favorites, orders] = await Promise.all([
        supabase
          .from('favorites')
          .select('vendor_id')
          .eq('buyer_id', userId)
          .abortSignal(signal),
        supabase
          .from('orders')
          .select(
            'id,vendor_id,vendor_name,meeting_point_location,customer_location',
          )
          .eq('buyer_id', userId)
          .in('status', ['on_the_way', 'arrived'])
          .abortSignal(signal),
      ])
      if (favorites.error) throw favorites.error
      if (orders.error) throw orders.error
      const ids = [
        ...new Set([
          ...favorites.data.map((row) => row.vendor_id),
          ...orders.data.map((row) => row.vendor_id),
        ]),
      ]
      if (!ids.length) return alerts
      const vendors = await supabase
        .from('vendors')
        .select('id,name,location,online,is_verified,last_seen_at')
        .in('id', ids)
        .abortSignal(signal)
      if (vendors.error) throw vendors.error
      const active = vendors.data.filter((vendor) =>
        isVendorPresenceFresh(vendor),
      )
      for (const order of orders.data) {
        const vendor = active.find((row) => row.id === order.vendor_id)
        const origin = getVendorCoordinates(vendor?.location)
        const destination = getVendorCoordinates(
          order.meeting_point_location || order.customer_location,
        )
        if (!origin || !destination) continue
        const distance = haversineDistance(
          origin.lat,
          origin.lng,
          destination.lat,
          destination.lng,
        )
        const threshold = distance <= 150 ? 150 : distance <= 500 ? 500 : null
        if (threshold)
          alerts.push({
            id: `order:${order.id}:${threshold}`,
            text: `Pedagang ${vendor?.name || order.vendor_name} sudah ${threshold === 150 ? 'sangat dekat' : 'dalam radius 500 meter'} dari titik temu.`,
          })
      }
      if (!navigator.geolocation || !favorites.data.length) return alerts
      const permission = await navigator.permissions
        ?.query({ name: 'geolocation' })
        .then((state) => state.state)
        .catch(() => undefined)
      signal.throwIfAborted()
      if (
        permission === 'denied' ||
        (permission !== 'granted' && (!onMap.current || prompted.current))
      )
        return alerts
      prompted.current = true
      const position = await getBrowserPosition(
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
        signal,
      ).catch(() => null)
      signal.throwIfAborted()
      if (!position) return alerts
      const favoritesSet = new Set(favorites.data.map((row) => row.vendor_id))
      for (const vendor of active) {
        if (!favoritesSet.has(vendor.id)) continue
        const point = getVendorCoordinates(vendor.location)
        if (!point) continue
        const distance = haversineDistance(
          position.coords.latitude,
          position.coords.longitude,
          point.lat,
          point.lng,
        )
        if (distance <= 500)
          alerts.push({
            id: `favorite:${vendor.id}`,
            text: `Pedagang favorit ${vendor.name} sudah dekat, sekitar ${Math.round(distance)} m dari Anda.`,
          })
      }
      return alerts
    },
  })
  useEffect(() => {
    if (!userId || seen.current.userId !== userId) return
    for (const alert of query.data || []) {
      if (seen.current.ids.has(alert.id)) continue
      seen.current.ids.add(alert.id)
      push(alert.text, { type: 'info' })
    }
  }, [push, query.data, userId])
}
