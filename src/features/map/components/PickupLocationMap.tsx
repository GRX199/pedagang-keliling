import React, { useEffect, useRef, useState } from 'react'
import L from '../../../shared/lib/leaflet'
import 'leaflet/dist/leaflet.css'
import type { Json } from '../../../types/database.types'
import type { Coordinates, Vendor } from '../../../types/domain.types'
import { usePresenceClock } from '../../../shared/hooks/usePresenceClock'
import { haversineDistance } from '../map-model'
import {
  getVendorCoordinates,
  isVendorPresenceFresh,
  formatVendorPresenceAge,
} from '../../../lib/vendor'

export default function PickupLocationMap({
  vendor,
  point,
  pointLabel = 'Titik pengambilan',
  vendorOnly = false,
}: {
  vendor: Vendor | null
  point: Json
  pointLabel?: string
  vendorOnly?: boolean
}) {
  const element = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layers = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(0)
  const now = usePresenceClock([vendor])
  const [tileError, setTileError] = useState(false)
  const fresh =
    vendor?.is_verified === true && isVendorPresenceFresh(vendor, now)
  const vendorPoint = fresh ? getVendorCoordinates(vendor.location) : null
  const meetingPoint = getVendorCoordinates(point)

  useEffect(() => {
    if (!element.current) return undefined
    const map = L.map(element.current).setView([1.4748, 124.8421], 12)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    })
      .on('tileerror', () => setTileError(true))
      .on('tileload', () => setTileError(false))
      .addTo(map)
    layers.current = L.layerGroup().addTo(map)
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => map.invalidateSize())
    observer?.observe(element.current)
    return () => {
      observer?.disconnect()
      map.remove()
      mapRef.current = null
      fitted.current = 0
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !layers.current) return
    layers.current.clearLayers()
    const positions: L.LatLngTuple[] = []
    const markers: [Coordinates | null, string, string][] = [
      [vendorPoint, '#059669', 'Pedagang aktif'],
      [meetingPoint, '#0284c7', pointLabel],
    ]
    for (const [coordinates, color, label] of markers) {
      if (!coordinates) continue
      const latlng: L.LatLngTuple = [coordinates.lat, coordinates.lng]
      positions.push(latlng)
      const tooltip = document.createElement('span')
      tooltip.textContent = label
      L.circleMarker(latlng, {
        radius: 10,
        color: 'white',
        weight: 3,
        fillColor: color,
        fillOpacity: 1,
      })
        .bindTooltip(tooltip)
        .addTo(layers.current)
    }
    if (positions.length === 2)
      L.polyline(positions, {
        color: '#64748b',
        weight: 2,
        dashArray: '6 6',
      }).addTo(layers.current)
    if (positions.length > fitted.current) {
      map.fitBounds(L.latLngBounds(positions), {
        padding: [36, 36],
        maxZoom: 16,
        animate: false,
      })
      fitted.current = positions.length
    }
  }, [
    vendorPoint?.lat,
    vendorPoint?.lng,
    meetingPoint?.lat,
    meetingPoint?.lng,
    pointLabel,
  ])

  let distance = null
  if (vendorPoint && meetingPoint)
    distance = haversineDistance(
      vendorPoint.lat,
      vendorPoint.lng,
      meetingPoint.lat,
      meetingPoint.lng,
    )
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div
        ref={element}
        className="relative isolate z-0 w-full"
        style={{ height: 'clamp(260px, 45vh, 420px)' }}
        aria-label="Peta pedagang dan titik pengambilan"
      />
      <div className="space-y-1 p-3 text-xs text-slate-600" aria-live="polite">
        <p>
          <span className="font-medium text-emerald-700">Hijau: pedagang</span>
          {meetingPoint && (
            <>
              {' '}
              ·{' '}
              <span className="font-medium text-sky-700">
                Biru: {pointLabel.toLowerCase()}
              </span>
            </>
          )}
        </p>
        <p>
          {fresh
            ? `Pedagang: ${formatVendorPresenceAge(vendor, now)}`
            : 'Lokasi pedagang tidak aktif. Koordinasikan titik melalui chat.'}
        </p>
        {!meetingPoint && !vendorOnly && (
          <p>
            Titik pengambilan berupa patokan tertulis, belum ditandai pada peta.
          </p>
        )}
        {distance !== null && (
          <p>
            Jarak garis lurus:{' '}
            {distance < 1000
              ? `${Math.round(distance)} m`
              : `${(distance / 1000).toFixed(1)} km`}
            . Bukan rute perjalanan atau ETA.
          </p>
        )}
        {tileError && (
          <p role="alert">
            Gambar peta belum termuat. Periksa koneksi; patokan titik tetap
            tersedia di atas.
          </p>
        )}
      </div>
    </section>
  )
}
