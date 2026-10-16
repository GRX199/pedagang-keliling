import { useEffect, useRef } from 'react'
import L from '../../shared/lib/leaflet'
import { escapeMapText } from '../../lib/map-popup'
import type { DemandHotspot } from '../../lib/territory'

type Area = { circle: L.Circle; core: L.CircleMarker }

export function useDemandLayer(
  map: L.Map | null,
  hotspots: readonly DemandHotspot[],
  enabled: boolean,
  focusRequest: number,
) {
  const group = useRef<L.LayerGroup | null>(null)
  const areas = useRef(new Map<string, Area>())
  const focusedRequest = useRef(0)

  useEffect(() => {
    if (!map) return
    const layer = L.layerGroup()
    group.current = layer
    focusedRequest.current = 0
    const items = areas.current
    return () => {
      layer.remove()
      layer.clearLayers()
      items.clear()
      group.current = null
    }
  }, [map])

  useEffect(() => {
    const layer = group.current
    if (!map || !layer) return
    if (!enabled) {
      layer.remove()
      return
    }
    layer.addTo(map)
    const visible = new Set(hotspots.map((hotspot) => hotspot.id))
    for (const [id, area] of areas.current) {
      if (!visible.has(id)) {
        layer.removeLayer(area.circle)
        layer.removeLayer(area.core)
        areas.current.delete(id)
      }
    }
    for (const hotspot of hotspots) {
      let area = areas.current.get(hotspot.id)
      if (!area) {
        area = {
          circle: L.circle([hotspot.lat, hotspot.lng], {
            radius: 1,
            className: 'vendor-demand-area',
          }).addTo(layer),
          core: L.circleMarker([hotspot.lat, hotspot.lng], {
            className: 'vendor-demand-core',
          }).addTo(layer),
        }
        areas.current.set(hotspot.id, area)
      }
      area.circle
        .setLatLng([hotspot.lat, hotspot.lng])
        .setRadius(120 + hotspot.intensity * 95)
      area.circle.setStyle({
        color: '#f97316',
        weight: 1,
        opacity: 0.45,
        fillColor: '#f59e0b',
        fillOpacity: 0.1 + hotspot.intensity * 0.08,
      })
      area.core
        .setLatLng([hotspot.lat, hotspot.lng])
        .setRadius(5 + hotspot.intensity)
      area.core.setStyle({
        color: '#ea580c',
        weight: 1,
        fillColor: '#f97316',
        fillOpacity: 0.85,
      })
      const content = `${escapeMapText(hotspot.label)}: ${hotspot.orderCount} pesanan`
      if (area.circle.getTooltip()) area.circle.setTooltipContent(content)
      else area.circle.bindTooltip(content, { direction: 'top', opacity: 0.92 })
    }
  }, [map, hotspots, enabled])

  useEffect(() => {
    if (
      !map ||
      !enabled ||
      !hotspots.length ||
      focusRequest <= focusedRequest.current
    )
      return
    const bounds = L.latLngBounds([])
    for (const hotspot of hotspots) {
      const area = areas.current.get(hotspot.id)
      if (area) bounds.extend(area.circle.getBounds())
    }
    if (!bounds.isValid()) return
    // Focus only on an explicit toggle/period change, never on background polling.
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, animate: false })
    focusedRequest.current = focusRequest
  }, [map, hotspots, enabled, focusRequest])
}
