import { useEffect, useRef, useState } from 'react'
import L from '../../../shared/lib/leaflet'
import type { Coordinates } from '../../../types/domain.types'

type Props = {
  vendorPoint: Coordinates | null
  customerPoint: Coordinates | null
  vendorName: string
  customerLabel: string
  route: L.LatLngTuple[] | null
  road: boolean
}
const SOURCES = [
  {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
]
const textNode = (text: string) => {
  const node = document.createElement('div')
  node.textContent = text
  return node
}

export default function LegacyTrackingMap({
  vendorPoint,
  customerPoint,
  vendorName,
  customerLabel,
  route,
  road,
}: Props) {
  const element = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const vendorMarker = useRef<L.CircleMarker | null>(null)
  const customerMarker = useRef<L.CircleMarker | null>(null)
  const line = useRef<L.Polyline | null>(null)
  const fitted = useRef(0)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!element.current) return
    const map = L.map(element.current).setView([-2.5489, 118.0149], 5)
    mapRef.current = map
    let active = true
    let tile: L.TileLayer | undefined
    let index = 0
    let failures = 0
    const attach = () => {
      const source = SOURCES[index]
      tile = L.tileLayer(source.url, {
        attribution: source.attribution,
        maxZoom: 19,
      }).addTo(map)
      tile.on('tileload', () => {
        if (active) setNotice('')
      })
      tile.on('tileerror', () => {
        if (!active) return
        failures++
        if (failures >= 3 && index < SOURCES.length - 1) {
          tile?.off().remove()
          index++
          failures = 0
          attach()
        }
        setNotice('Gambar peta belum termuat. Periksa koneksi Anda.')
      })
    }
    attach()
    const resize = () => map.invalidateSize({ animate: false })
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(element.current)
    window.addEventListener('resize', resize)
    const frame = requestAnimationFrame(resize)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      observer?.disconnect()
      tile?.off()
      map.remove()
      mapRef.current = null
      vendorMarker.current = null
      customerMarker.current = null
      line.current = null
      fitted.current = 0
    }
  }, [])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const positions: L.LatLngTuple[] = []
    for (const [point, marker, color, label] of [
      [vendorPoint, vendorMarker, '#059669', vendorName],
      [customerPoint, customerMarker, '#0284c7', customerLabel],
    ] as const) {
      if (point) {
        const latlng: L.LatLngTuple = [point.lat, point.lng]
        positions.push(latlng)
        if (!marker.current)
          marker.current = L.circleMarker(latlng, {
            radius: 9,
            color: 'white',
            weight: 3,
            fillColor: color,
            fillOpacity: 1,
          }).addTo(map)
        else marker.current.setLatLng(latlng)
        marker.current.bindPopup(textNode(label))
      } else if (marker.current) {
        marker.current.remove()
        marker.current = null
      }
    }
    if (positions.length === 2) {
      const points = route && route.length > 1 ? route : positions
      if (!line.current)
        line.current = L.polyline(points, {
          color: '#0f766e',
          weight: 4,
        }).addTo(map)
      else line.current.setLatLngs(points)
      line.current.setStyle({ dashArray: road ? undefined : '8 8' })
    } else if (line.current) {
      line.current.remove()
      line.current = null
    }
    if (positions.length > fitted.current) {
      map.fitBounds(positions, {
        padding: [40, 40],
        maxZoom: 16,
        animate: false,
      })
      fitted.current = positions.length
    }
  }, [
    vendorPoint?.lat,
    vendorPoint?.lng,
    customerPoint?.lat,
    customerPoint?.lng,
    vendorName,
    customerLabel,
    route,
    road,
  ])
  return (
    <>
      <div
        ref={element}
        aria-label="Peta tracking pesanan lama"
        className="tracking-map relative isolate z-0 h-[48vh] min-h-[300px] w-full rounded-[18px] sm:h-[56vh] sm:min-h-[360px]"
      />
      {notice && (
        <p role="status" className="p-3 text-xs text-slate-500">
          {notice}
        </p>
      )}
    </>
  )
}
