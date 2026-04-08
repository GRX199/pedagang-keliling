import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import VendorProductsPreview from '../components/VendorProductsPreview'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import {
  getFriendlyFetchErrorMessage,
  getGeolocationErrorMessage,
  getServerOrigin,
} from '../lib/network'
import { supabase } from '../lib/supabase'
import { getVendorCoordinates, getVendorLocationLabel } from '../lib/vendor'

const DEFAULT_CENTER = [-2.5489, 118.0149]

const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

L.Marker.prototype.options.icon = DefaultIcon

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

function createActionButton(label, colors, onClick) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.style.padding = '6px 10px'
  button.style.borderRadius = '8px'
  button.style.border = `1px solid ${colors.border}`
  button.style.background = colors.background
  button.style.color = colors.color
  button.style.cursor = 'pointer'
  button.style.fontSize = '12px'
  button.addEventListener('click', onClick)
  return button
}

function buildPopupContent(vendor, actions) {
  const wrapper = document.createElement('div')
  wrapper.style.minWidth = '220px'

  const title = document.createElement('strong')
  title.textContent = vendor.name || 'Pedagang'
  wrapper.appendChild(title)

  const status = document.createElement('div')
  status.style.fontSize = '12px'
  status.style.marginTop = '4px'
  status.textContent = vendor.online ? 'Sedang online' : 'Sedang offline'
  status.style.color = vendor.online ? '#15803d' : '#6b7280'
  wrapper.appendChild(status)

  if (vendor.photo_url) {
    const imageWrap = document.createElement('div')
    imageWrap.style.marginTop = '8px'

    const image = document.createElement('img')
    image.src = vendor.photo_url
    image.alt = vendor.name || 'Pedagang'
    image.style.width = '100%'
    image.style.height = '96px'
    image.style.objectFit = 'cover'
    image.style.borderRadius = '8px'

    imageWrap.appendChild(image)
    wrapper.appendChild(imageWrap)
  }

  if (vendor.description) {
    const description = document.createElement('div')
    description.textContent = String(vendor.description).slice(0, 120)
    description.style.marginTop = '8px'
    description.style.fontSize = '13px'
    description.style.color = '#374151'
    wrapper.appendChild(description)
  }

  const actionsRow = document.createElement('div')
  actionsRow.style.display = 'flex'
  actionsRow.style.gap = '8px'
  actionsRow.style.justifyContent = 'flex-end'
  actionsRow.style.marginTop = '10px'

  actionsRow.appendChild(createActionButton('Profil', {
    border: '#d1d5db',
    background: '#ffffff',
    color: '#111827',
  }, actions.onView))

  actionsRow.appendChild(createActionButton('Chat', {
    border: '#2563eb',
    background: '#2563eb',
    color: '#ffffff',
  }, actions.onChat))

  actionsRow.appendChild(createActionButton('Order', {
    border: '#16a34a',
    background: '#16a34a',
    color: '#ffffff',
  }, actions.onOrder))

  L.DomEvent.disableClickPropagation(wrapper)
  wrapper.appendChild(actionsRow)
  return wrapper
}

export default function MapViewPage() {
  const { user, role } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const clusterRef = useRef(null)

  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [userLocation, setUserLocation] = useState(null)
  const [radiusKm, setRadiusKm] = useState(2.5)
  const [onlyWithinRadius, setOnlyWithinRadius] = useState(false)
  const [clusterEnabled, setClusterEnabled] = useState(true)

  const serverOrigin = getServerOrigin()
  const isVendor = role === 'vendor' || user?.user_metadata?.is_vendor === true
  const myVendorId = user?.id

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim().toLowerCase())
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [query])

  async function loadVendors() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('id, name, description, photo_url, location, online')

      if (error) throw error
      setVendors(data || [])
    } catch (error) {
      console.error('loadVendors', error)
      toast.push(error.message || 'Gagal memuat pedagang', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!containerRef.current) return undefined

    if (mapRef.current) {
      try {
        mapRef.current.remove()
      } catch (error) {
        console.error('removeExistingMap', error)
      }
    }

    const map = L.map(containerRef.current).setView(DEFAULT_CENTER, 5)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    const locateControl = L.control({ position: 'topleft' })
    locateControl.onAdd = function onAdd() {
      const element = L.DomUtil.create('button', 'leaflet-bar')
      element.type = 'button'
      element.textContent = 'Lokasi'
      element.style.background = 'white'
      element.style.padding = '8px'
      element.style.cursor = 'pointer'
      element.style.border = 'none'
      element.title = 'Tampilkan lokasi saya'
      L.DomEvent.on(element, 'click', () => map.locate({ setView: true, maxZoom: 15 }))
      return element
    }
    locateControl.addTo(map)

    map.on('locationfound', (event) => {
      const { lat, lng } = event.latlng
      setUserLocation({ lat, lng })

      if (map._userMarker) map.removeLayer(map._userMarker)
      map._userMarker = L.circleMarker([lat, lng], {
        radius: 8,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.9,
      }).addTo(map)
    })

    map.on('locationerror', (error) => {
      toast.push(getGeolocationErrorMessage(error), { type: 'error' })
    })

    return () => {
      try {
        map.remove()
      } catch (error) {
        console.error('removeMap', error)
      }
      mapRef.current = null
    }
  }, [toast])

  useEffect(() => {
    loadVendors()

    const channel = supabase
      .channel('vendors-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors' }, () => {
        loadVendors()
      })
      .subscribe()

    return () => {
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeVendorsChannel', error)
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedVendor) return

    const nextVendor = vendors.find((vendor) => vendor.id === selectedVendor.id)
    if (nextVendor && nextVendor !== selectedVendor) {
      setSelectedVendor(nextVendor)
    }
  }, [selectedVendor, vendors])

  const filteredVendors = useMemo(() => {
    return vendors.filter((vendor) => {
      const coordinates = getVendorCoordinates(vendor.location)
      if (!coordinates) return false

      if (debouncedQuery) {
        const haystack = `${vendor.name || ''} ${vendor.description || ''}`.toLowerCase()
        if (!haystack.includes(debouncedQuery)) return false
      }

      if (onlyWithinRadius) {
        if (!userLocation) return false
        const distance = haversineDistance(
          userLocation.lat,
          userLocation.lng,
          coordinates.lat,
          coordinates.lng
        )
        if (distance > radiusKm * 1000) return false
      }

      return true
    })
  }, [debouncedQuery, onlyWithinRadius, radiusKm, userLocation, vendors])

  const vendorsWithinRadius = useMemo(() => {
    if (!userLocation) return []

    return vendors.filter((vendor) => {
      const coordinates = getVendorCoordinates(vendor.location)
      if (!coordinates) return false

      const distance = haversineDistance(
        userLocation.lat,
        userLocation.lng,
        coordinates.lat,
        coordinates.lng
      )

      return distance <= radiusKm * 1000
    })
  }, [radiusKm, userLocation, vendors])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined

    if (clusterRef.current) {
      try {
        map.removeLayer(clusterRef.current)
      } catch (error) {
        console.error('removeCluster', error)
      }
    }

    const group = clusterEnabled ? L.markerClusterGroup() : L.layerGroup()
    const bounds = []

    filteredVendors.forEach((vendor) => {
      const coordinates = getVendorCoordinates(vendor.location)
      if (!coordinates) return

      const marker = L.marker([coordinates.lat, coordinates.lng])
      marker.bindPopup(buildPopupContent(vendor, {
        onView: () => setSelectedVendor(vendor),
        onChat: () => navigate(`/chat/${vendor.id}`),
        onOrder: () => navigate(`/vendor/${vendor.id}#order`),
      }), { maxWidth: 320 })

      group.addLayer(marker)
      bounds.push([coordinates.lat, coordinates.lng])
    })

    clusterRef.current = group
    group.addTo(map)

    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [48, 48] })
      } catch (error) {
        console.error('fitBounds', error)
      }
    }

    return () => {
      try {
        map.removeLayer(group)
      } catch (error) {
        console.error('removeMarkerGroup', error)
      }
      clusterRef.current = null
    }
  }, [clusterEnabled, filteredVendors, navigate])

  async function getAccessToken() {
    try {
      const response = await supabase.auth.getSession()
      return response?.data?.session?.access_token || null
    } catch (error) {
      console.error('getAccessToken', error)
      return null
    }
  }

  async function toggleMyOnlineStatus() {
    if (!isVendor || !myVendorId) {
      toast.push('Hanya pedagang yang dapat mengubah status toko', { type: 'error' })
      return
    }

    const currentRow = vendors.find((vendor) => vendor.id === myVendorId)
    const currentStatus = currentRow?.online === true
    const nextStatus = !currentStatus

    setVendors((current) => current.map((vendor) => (
      vendor.id === myVendorId ? { ...vendor, online: nextStatus, __updating: true } : vendor
    )))

    try {
      const accessToken = await getAccessToken()
      if (!accessToken) throw new Error('Sesi login tidak ditemukan')

      let response
      try {
        response = await fetch(`${serverOrigin}/api/vendor/${myVendorId}/online`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ online: nextStatus }),
        })
      } catch (error) {
        throw new Error(getFriendlyFetchErrorMessage(error, 'Gagal menghubungi server untuk mengubah status toko.'))
      }

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)

      const confirmedStatus = typeof payload.online === 'boolean' ? payload.online : nextStatus

      setVendors((current) => current.map((vendor) => (
        vendor.id === myVendorId ? { ...vendor, online: confirmedStatus, __updating: false } : vendor
      )))

      toast.push(`Status toko: ${confirmedStatus ? 'Online' : 'Offline'}`, { type: 'success' })
    } catch (error) {
      console.error('toggleMyOnlineStatus', error)
      setVendors((current) => current.map((vendor) => (
        vendor.id === myVendorId ? { ...vendor, online: currentStatus, __updating: false } : vendor
      )))
      toast.push(error.message || 'Gagal mengubah status toko', { type: 'error' })
    }
  }

  const myVendorRow = vendors.find((vendor) => vendor.id === myVendorId)
  const toggleLabel = myVendorRow?.online ? 'Jadikan Offline' : 'Jadikan Online'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl p-4 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari pedagang atau produk..."
              className="w-full rounded-xl border border-gray-300 px-3 py-2 md:max-w-md"
            />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setQuery(''); loadVendors() }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                Reset
              </button>
              <button
                onClick={() => {
                  const bounds = clusterRef.current?.getBounds?.()
                  if (bounds?.isValid?.()) mapRef.current?.fitBounds(bounds, { padding: [48, 48] })
                }}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white"
              >
                Zoom Semua
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-600">Radius (km)</label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value || 0))}
              className="w-24 rounded-xl border border-gray-300 px-3 py-2"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={onlyWithinRadius}
                onChange={(event) => setOnlyWithinRadius(event.target.checked)}
              />
              Tampilkan dalam radius
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={clusterEnabled}
                onChange={(event) => setClusterEnabled(event.target.checked)}
              />
              Cluster marker
            </label>
            <button
              onClick={() => mapRef.current?.locate({ setView: true, maxZoom: 15 })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              Lokasi Saya
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div>
            <div ref={containerRef} className="h-[72vh] rounded-2xl shadow-sm" />
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500">
              <div>{loading ? 'Memuat pedagang...' : `${vendors.length} pedagang tersedia`}</div>
              {onlyWithinRadius && userLocation && (
                <div>{vendorsWithinRadius.length} pedagang dalam radius {radiusKm} km</div>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            {!selectedVendor ? (
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
                <h2 className="font-semibold text-gray-900">Detail Pedagang</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Klik marker pada peta untuk melihat profil toko, chat, atau membuat pesanan.
                </p>

                <div className="mt-4">
                  <button onClick={loadVendors} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    Refresh Pedagang
                  </button>
                </div>

                {isVendor && (
                  <div className="mt-6 rounded-xl bg-gray-50 p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Kontrol Pedagang</div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={toggleMyOnlineStatus}
                        className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white"
                      >
                        {myVendorRow?.__updating ? 'Menyimpan...' : toggleLabel}
                      </button>
                      <button
                        onClick={() => navigate('/dashboard?tab=products')}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        Kelola Produk
                      </button>
                    </div>
                    <div className="mt-3 text-sm text-gray-600">
                      Status saat ini: <strong>{myVendorRow?.online ? 'Online' : 'Offline'}</strong>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 overflow-hidden rounded-xl bg-gray-100">
                    {selectedVendor.photo_url ? (
                      <img src={selectedVendor.photo_url} alt={selectedVendor.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xl text-gray-500">
                        {(selectedVendor.name || 'P')[0]}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-gray-900">{selectedVendor.name}</div>
                    <div className="text-sm text-gray-500">{selectedVendor.online ? 'Sedang online' : 'Sedang offline'}</div>
                  </div>
                </div>

                <div className="mt-4 text-sm text-gray-600">
                  {selectedVendor.description || 'Belum ada deskripsi toko.'}
                </div>
                <div className="mt-2 text-sm text-gray-500">
                  Lokasi: {getVendorLocationLabel(selectedVendor.location)}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {isVendor && myVendorId === selectedVendor.id ? (
                    <>
                      <button
                        onClick={toggleMyOnlineStatus}
                        className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white"
                      >
                        {myVendorRow?.__updating ? 'Menyimpan...' : toggleLabel}
                      </button>
                      <button
                        onClick={() => navigate('/dashboard?tab=products')}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        Kelola Produk
                      </button>
                      <button
                        onClick={() => navigate('/dashboard?tab=profile')}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        Edit Profil
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => navigate(`/chat/${selectedVendor.id}`)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        Chat
                      </button>
                      <button
                        onClick={() => navigate(`/vendor/${selectedVendor.id}`)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        Lihat Profil
                      </button>
                      <button
                        onClick={() => navigate(`/vendor/${selectedVendor.id}#order`)}
                        className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white"
                      >
                        Buat Pesanan
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-4">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Preview Produk</h3>
                  <VendorProductsPreview vendorId={selectedVendor.id} />
                </div>

                <div className="mt-4">
                  <button
                    onClick={() => setSelectedVendor(null)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    Tutup Detail
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
