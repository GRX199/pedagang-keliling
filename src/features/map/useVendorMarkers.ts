import { useEffect, useRef } from 'react'
import L from '../../shared/lib/leaflet'
import 'leaflet.markercluster'
import type { VendorMapItem } from '../../types/domain.types'
import { getVendorCoordinates } from '../../shared/lib/coordinates'
import { getVendorMarkerOptions } from '../../lib/vendor-categories'
import { getVendorCategory } from './map-model'

type Entry = { marker: L.Marker; signature: string; category: string }
export function useVendorMarkers(
  map: L.Map | null,
  vendors: VendorMapItem[],
  createPopup: (vendor: VendorMapItem) => HTMLElement,
  popupKey: string
) {
  const group = useRef<L.MarkerClusterGroup | null>(null)
  const markers = useRef(new Map<string, Entry>())
  const fitted = useRef(false)
  useEffect(() => {
    if (!map) return undefined
    const layer = L.markerClusterGroup().addTo(map)
    group.current = layer
    fitted.current = false
    return () => {
      markers.current.clear()
      map.removeLayer(layer)
      if (group.current === layer) group.current = null
    }
  }, [map])
  useEffect(() => {
    if (!map || !group.current) return
    const visible = new Set<string>()
    const bounds: L.LatLngTuple[] = []
    for (const vendor of vendors) {
      const point = getVendorCoordinates(vendor.location)
      if (!point) continue
      visible.add(vendor.id)
      bounds.push([point.lat, point.lng])
      const category = getVendorCategory(vendor)
      const signature = JSON.stringify([
        vendor.name,
        vendor.description,
        vendor.photo_url,
        vendor.online,
        category,
        vendor.review_average,
        vendor.review_count,
        vendor.promo_text,
        vendor.promo_expires_at,
        popupKey,
      ])
      const entry = markers.current.get(vendor.id)
      if (entry) {
        const current = entry.marker.getLatLng()
        if (current.lat !== point.lat || current.lng !== point.lng)
          entry.marker.setLatLng([point.lat, point.lng])
        if (entry.category !== category)
          entry.marker.setIcon(L.divIcon(getVendorMarkerOptions(category)))
        if (entry.signature !== signature) entry.marker.setPopupContent(createPopup(vendor))
        entry.signature = signature
        entry.category = category
      } else {
        const marker = L.marker([point.lat, point.lng], {
          icon: L.divIcon(getVendorMarkerOptions(category)),
          title: `${vendor.name} - ${category}`,
          alt: `${vendor.name} - ${category}`,
        }).bindPopup(createPopup(vendor), { maxWidth: 320 })
        group.current.addLayer(marker)
        markers.current.set(vendor.id, { marker, signature, category })
      }
    }
    for (const [id, entry] of markers.current)
      if (!visible.has(id)) {
        group.current.removeLayer(entry.marker)
        markers.current.delete(id)
      }
    if (!fitted.current && bounds.length) {
      if (map.getZoom() === 5) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 })
      fitted.current = true
    }
  }, [map, vendors, createPopup, popupKey])
}
