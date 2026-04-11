import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  createVendorLocationPayload,
  getVendorCoordinates,
  getVendorLocationLabel,
  getVendorLocationUpdatedAtLabel,
} from '../lib/vendor'

const DEFAULT_CENTER = [-2.5489, 118.0149]
const LOCATION_SYNC_DISTANCE_METERS = 20

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

function hasMeaningfulLocationChange(previousLocation, nextLocation) {
  if (!previousLocation) return true

  return haversineDistance(
    previousLocation.lat,
    previousLocation.lng,
    nextLocation.lat,
    nextLocation.lng
  ) >= LOCATION_SYNC_DISTANCE_METERS
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
  const autoLocateAttemptedRef = useRef(false)
  const lastSyncedLocationRef = useRef(null)

  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [userLocation, setUserLocation] = useState(null)
  const [radiusKm, setRadiusKm] = useState(2.5)
  const [onlyWithinRadius, setOnlyWithinRadius] = useState(false)
  const [clusterEnabled, setClusterEnabled] = useState(true)
  const [syncingStoreLocation, setSyncingStoreLocation] = useState(false)

  const serverOrigin = getServerOrigin()
  const isVendor = role === 'vendor' || user?.user_metadata?.is_vendor === true
  const myVendorId = user?.id

  const syncMyVendorLocation = useCallback(async (coords, options = {}) => {
    if (!isVendor || !myVendorId) return

    const nextLocation = createVendorLocationPayload(coords)
    if (!nextLocation) return

    const previousLocation = lastSyncedLocationRef.current
    if (!hasMeaningfulLocationChange(previousLocation, nextLocation)) {
      return
    }

    setSyncingStoreLocation(true)
    try {
      const { data, error } = await supabase
        .from('vendors')
        .update({ location: nextLocation })
        .eq('id', myVendorId)
        .select('id, name, description, photo_url, location, online')
        .maybeSingle()

      if (error) throw error

      lastSyncedLocationRef.current = getVendorCoordinates(data?.location || nextLocation)
      setVendors((current) => current.map((vendor) => (
        vendor.id === myVendorId
          ? { ...vendor, ...(data || {}), location: data?.location || nextLocation }
          : vendor
      )))

      if (!options.silentSuccess) {
        toast.push('Lokasi toko berhasil diperbarui', { type: 'success' })
      }
    } catch (error) {
      console.error('syncMyVendorLocation', error)
      if (!options.silentError) {
        toast.push(error.message || 'Gagal memperbarui lokasi toko', { type: 'error' })
      }
    } finally {
      setSyncingStoreLocation(false)
    }
  }, [isVendor, myVendorId, toast])

  function requestCurrentLocation(options = {}) {
    mapRef.current?.locate({
      enableHighAccuracy: true,
      maxZoom: options.maxZoom || 15,
      setView: options.setView !== false,
    })
  }

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
      L.DomEvent.on(element, 'click', () => requestCurrentLocation())
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

      if (isVendor && myVendorId) {
        void syncMyVendorLocation({
          lat,
          lng,
          accuracy: event.accuracy,
        }, { silentSuccess: true, silentError: true })
      }
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
  }, [isVendor, myVendorId, syncMyVendorLocation, toast])

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

  useEffect(() => {
    const existingLocation = getVendorCoordinates(vendors.find((vendor) => vendor.id === myVendorId)?.location)
    if (existingLocation) {
      lastSyncedLocationRef.current = existingLocation
    }
  }, [myVendorId, vendors])

  useEffect(() => {
    if (!isVendor || !myVendorId || autoLocateAttemptedRef.current) return

    const currentVendor = vendors.find((vendor) => vendor.id === myVendorId)
    if (!currentVendor) return
    if (getVendorCoordinates(currentVendor.location)) return
    if (!mapRef.current) return

    autoLocateAttemptedRef.current = true
    toast.push('Izinkan lokasi agar posisi toko Anda muncul di peta pelanggan.', { type: 'info' })
    requestCurrentLocation({ maxZoom: 16 })
  }, [isVendor, myVendorId, toast, vendors])

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
  const myVendorLocation = myVendorRow?.location
  const myVendorCoordinates = getVendorCoordinates(myVendorLocation)
  const filteredVendorCount = filteredVendors.length
  const selectedVendorCoordinates = getVendorCoordinates(selectedVendor?.location)

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:py-6">
        <section className="overflow-hidden rounded-[28px] bg-slate-900 px-4 py-5 text-white shadow-xl shadow-slate-900/10 sm:px-6">
          <div className="grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
            <div>
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-slate-200">
                Peta Pedagang Sekitar
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                Cari pedagang yang sedang aktif dan lihat posisi toko secara real-time.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Gunakan peta ini untuk menemukan pedagang terdekat, membuka chat, dan langsung membuat pesanan dari HP maupun desktop.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={() => requestCurrentLocation()}
                  className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
                >
                  Lokasi Saya
                </button>
                <button
                  onClick={() => {
                    const bounds = clusterRef.current?.getBounds?.()
                    if (bounds?.isValid?.()) mapRef.current?.fitBounds(bounds, { padding: [48, 48] })
                  }}
                  className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
                >
                  Zoom Semua Pedagang
                </button>
                {isVendor && (
                  <button
                    onClick={() => requestCurrentLocation({ maxZoom: 16 })}
                    className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/15"
                  >
                    {syncingStoreLocation ? 'Menyinkronkan Lokasi...' : 'Bagikan Lokasi Toko'}
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Pedagang Tersedia</div>
                <div className="mt-2 text-3xl font-semibold text-white">{vendors.length}</div>
                <div className="mt-1 text-sm text-slate-300">Total toko yang sudah masuk ke peta.</div>
              </div>
              <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Hasil Tersaring</div>
                <div className="mt-2 text-3xl font-semibold text-white">{filteredVendorCount}</div>
                <div className="mt-1 text-sm text-slate-300">Sesuai pencarian, radius, dan lokasi.</div>
              </div>
              <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Dalam Radius</div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {userLocation ? vendorsWithinRadius.length : '-'}
                </div>
                <div className="mt-1 text-sm text-slate-300">
                  {userLocation ? `Pedagang dalam radius ${radiusKm} km.` : 'Aktifkan lokasi untuk menghitung jarak.'}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] bg-white/95 p-4 shadow-sm ring-1 ring-slate-200/80 backdrop-blur sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-700">Cari pedagang atau produk</div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Contoh: bakso, sayur, nasi kuning..."
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
                />
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <button
                    onClick={() => {
                      setQuery('')
                      loadVendors()
                    }}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Reset
                  </button>
                  <button
                    onClick={loadVendors}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-medium text-slate-800">Radius Pencarian</div>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={radiusKm}
                  onChange={(event) => setRadiusKm(Number(event.target.value || 0))}
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
                />
              </label>

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={onlyWithinRadius}
                    onChange={(event) => setOnlyWithinRadius(event.target.checked)}
                  />
                  <span>Tampilkan dalam radius</span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={clusterEnabled}
                    onChange={(event) => setClusterEnabled(event.target.checked)}
                  />
                  <span>Gabungkan marker berdekatan</span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-3">
            <div className="overflow-hidden rounded-[30px] bg-white p-2 shadow-lg shadow-slate-200/50 ring-1 ring-slate-200/70">
              <div ref={containerRef} className="h-[56vh] rounded-[24px] sm:h-[64vh] lg:h-[72vh]" />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/70">
              <div>{loading ? 'Memuat pedagang...' : `${vendors.length} pedagang tersedia di peta`}</div>
              {onlyWithinRadius && userLocation && (
                <div>{vendorsWithinRadius.length} pedagang dalam radius {radiusKm} km</div>
              )}
              {!userLocation && (
                <div className="text-slate-400">Aktifkan lokasi Anda untuk menghitung jarak terdekat.</div>
              )}
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {!selectedVendor ? (
              <>
                <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
                  <h2 className="font-semibold text-slate-900">Detail Pedagang</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Ketuk marker pada peta untuk melihat detail toko, produk, chat, dan tombol pesanan.
                  </p>
                </div>

                {isVendor && (
                  <div className="rounded-[28px] bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-5 shadow-sm ring-1 ring-emerald-100">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-[0.22em] text-emerald-700">Kontrol Pedagang</div>
                        <h3 className="mt-2 text-lg font-semibold text-slate-900">Status toko dan lokasi</h3>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                        myVendorRow?.online ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {myVendorRow?.online ? 'Online' : 'Offline'}
                      </span>
                    </div>

                    <div className="mt-4 rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                      <div className="text-sm font-medium text-slate-800">Lokasi toko saat ini</div>
                      <div className="mt-2 text-sm text-slate-600">
                        {myVendorCoordinates ? getVendorLocationLabel(myVendorLocation) : 'Lokasi toko belum dibagikan'}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Sinkron terakhir: {getVendorLocationUpdatedAtLabel(myVendorLocation)}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button
                        onClick={toggleMyOnlineStatus}
                        className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                      >
                        {myVendorRow?.__updating ? 'Menyimpan...' : toggleLabel}
                      </button>
                      <button
                        onClick={() => requestCurrentLocation({ maxZoom: 16 })}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {syncingStoreLocation ? 'Sinkron Lokasi...' : 'Perbarui Lokasi Toko'}
                      </button>
                      <button
                        onClick={() => navigate('/dashboard?tab=products')}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:col-span-2"
                      >
                        Kelola Produk
                      </button>
                    </div>

                    <p className="mt-4 text-xs leading-5 text-slate-500">
                      Agar pelanggan bisa melihat posisi Anda di peta, izinkan lokasi saat membuka halaman ini lalu tekan tombol perbarui lokasi bila perlu.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 overflow-hidden rounded-2xl bg-slate-100">
                    {selectedVendor.photo_url ? (
                      <img src={selectedVendor.photo_url} alt={selectedVendor.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xl text-slate-500">
                        {(selectedVendor.name || 'P')[0]}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-semibold text-slate-900">{selectedVendor.name}</div>
                    <div className="text-sm text-slate-500">{selectedVendor.online ? 'Sedang online' : 'Sedang offline'}</div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  {selectedVendor.description || 'Belum ada deskripsi toko.'}
                </div>

                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                  <div className="font-medium text-slate-800">Lokasi toko</div>
                  <div className="mt-1">{getVendorLocationLabel(selectedVendor.location)}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {selectedVendorCoordinates ? 'Lokasi siap dipakai untuk navigasi dan estimasi jarak.' : 'Pedagang belum membagikan lokasi.'}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {isVendor && myVendorId === selectedVendor.id ? (
                    <>
                      <button
                        onClick={toggleMyOnlineStatus}
                        className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                      >
                        {myVendorRow?.__updating ? 'Menyimpan...' : toggleLabel}
                      </button>
                      <button
                        onClick={() => requestCurrentLocation({ maxZoom: 16 })}
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {syncingStoreLocation ? 'Sinkron Lokasi...' : 'Perbarui Lokasi'}
                      </button>
                      <button
                        onClick={() => navigate('/dashboard?tab=products')}
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Kelola Produk
                      </button>
                      <button
                        onClick={() => navigate('/dashboard?tab=profile')}
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Edit Profil
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => navigate(`/chat/${selectedVendor.id}`)}
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Chat
                      </button>
                      <button
                        onClick={() => navigate(`/vendor/${selectedVendor.id}`)}
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Lihat Profil
                      </button>
                      <button
                        onClick={() => navigate(`/vendor/${selectedVendor.id}#order`)}
                        className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700 sm:col-span-2"
                      >
                        Buat Pesanan
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-5">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Preview Produk</h3>
                  <VendorProductsPreview vendorId={selectedVendor.id} />
                </div>

                <div className="mt-5">
                  <button
                    onClick={() => setSelectedVendor(null)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
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
