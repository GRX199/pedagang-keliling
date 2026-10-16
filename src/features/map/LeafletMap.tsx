import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import L from '../../shared/lib/leaflet'

type Props = HTMLAttributes<HTMLDivElement> & {
  onReady: (map: L.Map | null) => void
  onLocate: () => void
}
export default function LeafletMap({ onReady, onLocate, ...props }: Props) {
  const element = useRef<HTMLDivElement>(null)
  const ready = useRef(onReady)
  const locate = useRef(onLocate)
  const [tileError, setTileError] = useState(false)
  useEffect(() => {
    ready.current = onReady
    locate.current = onLocate
  }, [onReady, onLocate])
  useEffect(() => {
    if (!element.current) return undefined
    let active = true
    const map = L.map(element.current).setView([-2.5489, 118.0149], 5)
    const tile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    tile.on('tileerror', () => {
      if (active) setTileError(true)
    })
    tile.on('tileload', () => {
      if (active) setTileError(false)
    })
    const control = new L.Control({ position: 'topleft' })
    const button = L.DomUtil.create('button', 'leaflet-bar')
    button.type = 'button'
    button.textContent = 'Lokasi Saya'
    button.title = 'Fokus ke lokasi saya'
    Object.assign(button.style, {
      background: 'white',
      padding: '8px',
      cursor: 'pointer',
      border: 'none',
      fontWeight: '700',
      minHeight: '44px',
    })
    const click = () => locate.current()
    button.addEventListener('click', click)
    L.DomEvent.disableClickPropagation(button)
    control.onAdd = () => button
    control.addTo(map)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (active) map.invalidateSize({ animate: false })
    })
    observer?.observe(element.current)
    ready.current(map)
    return () => {
      active = false
      observer?.disconnect()
      button.removeEventListener('click', click)
      ready.current(null)
      map.remove()
    }
  }, [])
  return (
    <>
      <div ref={element} {...props} />
      {tileError && (
        <p role="status" className="px-3 py-2 text-xs text-amber-800">
          Gambar peta belum termuat. Periksa koneksi Anda.
        </p>
      )}
    </>
  )
}
