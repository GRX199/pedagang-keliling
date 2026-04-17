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
  formatVendorCategoryLabel,
  getVendorCoordinates,
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

function getVendorDistance(vendor, userLocation) {
  const coordinates = getVendorCoordinates(vendor?.location)
  if (!coordinates || !userLocation) return null

  return haversineDistance(
    userLocation.lat,
    userLocation.lng,
    coordinates.lat,
    coordinates.lng
  )
}

function formatDistanceLabel(distanceMeters) {
  if (typeof distanceMeters !== 'number') return 'Aktifkan lokasi untuk melihat jarak'
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m dari Anda`
  return `${(distanceMeters / 1000).toFixed(1)} km dari Anda`
}

function getViewerLocationStatus(userLocation) {
  if (!userLocation) {
    return 'Belum aktif. Tekan "Lokasi Saya" agar jarak pedagang bisa dihitung otomatis.'
  }

  return 'Lokasi Anda aktif dan sudah dipakai untuk menghitung pedagang terdekat.'
}

function normalizeCategoryValue(value) {
  return String(value || '').trim().toLowerCase()
}

function getStoreLocationStatus(location, { owner = false } = {}) {
  const coordinates = getVendorCoordinates(location)
  if (!coordinates) {
    return owner
      ? 'Lokasi toko belum dibagikan. Aktifkan mode online agar posisi toko bisa muncul di peta pelanggan.'
      : 'Lokasi toko belum tersedia di peta.'
  }

  return owner
    ? 'Lokasi toko sudah tersinkron dan siap tampil ke pelanggan saat toko online.'
    : 'Lokasi toko aktif di peta dan siap dipakai untuk estimasi jarak.'
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

function buildPopupContent(vendor, actions = []) {
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

  if (vendor.category_primary) {
    const category = document.createElement('div')
    category.style.fontSize = '12px'
    category.style.marginTop = '6px'
    category.style.color = '#475569'
    category.textContent = `Kategori: ${formatVendorCategoryLabel(vendor.category_primary)}`
    wrapper.appendChild(category)
  }

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

  for (const action of actions) {
    if (!action?.label || typeof action.onClick !== 'function') continue
    actionsRow.appendChild(createActionButton(action.label, action.colors, action.onClick))
  }

  L.DomEvent.disableClickPropagation(wrapper)
  if (actionsRow.childElementCount > 0) {
    wrapper.appendChild(actionsRow)
  }
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
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [userLocation, setUserLocation] = useState(null)
  const [radiusKm, setRadiusKm] = useState(2.5)
  const [onlyWithinRadius, setOnlyWithinRadius] = useState(false)
  const [syncingStoreLocation, setSyncingStoreLocation] = useState(false)

  const serverOrigin = getServerOrigin()
  const isVendor = role === 'vendor' || user?.user_metadata?.is_vendor === true
  const myVendorId = user?.id
  const clusterEnabled = true

  const applyViewerLocation = useCallback((lat, lng) => {
    const map = mapRef.current
    setUserLocation({ lat, lng })

    if (!map) return

    if (map._userMarker) map.removeLayer(map._userMarker)
    map._userMarker = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#2563eb',
      fillColor: '#2563eb',
      fillOpacity: 0.9,
    }).addTo(map)
  }, [])

  const syncMyVendorLocation = useCallback(async (coords, options = {}) => {
    if (!isVendor || !myVendorId) return

    const nextLocation = createVendorLocationPayload(coords)
    if (!nextLocation) return

    const previousLocation = lastSyncedLocationRef.current
    if (!options.force && !hasMeaningfulLocationChange(previousLocation, nextLocation)) {
      return
    }

    setSyncingStoreLocation(true)
    try {
      const { data, error } = await supabase
        .from('vendors')
        .update({ location: nextLocation })
        .eq('id', myVendorId)
        .select('id, name, description, photo_url, location, online, category_primary')
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

  const syncStoreLocationNow = useCallback(() => {
    if (!isVendor || !myVendorId) return
    if (!navigator.geolocation) {
      toast.push('Browser ini tidak mendukung akses lokasi', { type: 'error' })
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude

        applyViewerLocation(lat, lng)
        mapRef.current?.flyTo([lat, lng], 16, {
          animate: true,
          duration: 0.6,
        })

        void syncMyVendorLocation({
          lat,
          lng,
          accuracy: position.coords.accuracy,
        }, { force: true })
      },
      (error) => {
        toast.push(getGeolocationErrorMessage(error), { type: 'error' })
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 10000,
      }
    )
  }, [applyViewerLocation, isVendor, myVendorId, syncMyVendorLocation, toast])

  function requestCurrentLocation(options = {}) {
    mapRef.current?.locate({
      enableHighAccuracy: true,
      maxZoom: options.maxZoom || 15,
      setView: options.setView !== false,
    })
  }

  const focusVendor = useCallback((vendor) => {
    if (!vendor) return

    const coordinates = getVendorCoordinates(vendor.location)
    setSelectedVendor(vendor)

    if (coordinates) {
      mapRef.current?.flyTo([coordinates.lat, coordinates.lng], 16, {
        animate: true,
        duration: 0.8,
      })
    }
  }, [])

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
        .select('id, name, description, photo_url, location, online, category_primary')

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
      applyViewerLocation(lat, lng)
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
  }, [applyViewerLocation, toast])

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
    if (!nextVendor || !nextVendor.online || !getVendorCoordinates(nextVendor.location)) {
      setSelectedVendor(null)
      return
    }

    if (nextVendor !== selectedVendor) {
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
    syncStoreLocationNow()
  }, [isVendor, myVendorId, syncStoreLocationNow, toast, vendors])

  const filteredVendors = useMemo(() => {
    return vendors.filter((vendor) => {
      const coordinates = getVendorCoordinates(vendor.location)
      if (!vendor.online || !coordinates) return false

      if (selectedCategory !== 'all') {
        if (normalizeCategoryValue(vendor.category_primary) !== selectedCategory) return false
      }

      if (debouncedQuery) {
        const haystack = `${vendor.name || ''} ${vendor.description || ''} ${vendor.category_primary || ''}`.toLowerCase()
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
  }, [debouncedQuery, onlyWithinRadius, radiusKm, selectedCategory, userLocation, vendors])

  const onlineVendors = useMemo(
    () => vendors.filter((vendor) => vendor.online && getVendorCoordinates(vendor.location)),
    [vendors]
  )

  const categoryOptions = useMemo(() => {
    const categoryMap = new Map()

    for (const vendor of onlineVendors) {
      const rawCategory = String(vendor.category_primary || '').trim()
      if (!rawCategory) continue

      const key = normalizeCategoryValue(rawCategory)
      if (!categoryMap.has(key)) {
        categoryMap.set(key, rawCategory)
      }
    }

    return [...categoryMap.entries()]
      .sort((left, right) => left[1].localeCompare(right[1], 'id'))
      .map(([value, label]) => ({ value, label }))
  }, [onlineVendors])

  useEffect(() => {
    if (selectedCategory === 'all') return
    if (categoryOptions.some((option) => option.value === selectedCategory)) return
    setSelectedCategory('all')
  }, [categoryOptions, selectedCategory])

  const onlineVendorsWithinRadius = useMemo(() => {
    if (!userLocation) return []

    return onlineVendors.filter((vendor) => {
      const distance = getVendorDistance(vendor, userLocation)
      return typeof distance === 'number' && distance <= radiusKm * 1000
    })
  }, [onlineVendors, radiusKm, userLocation])

  const onlineListVendors = useMemo(() => {
    return [...filteredVendors].sort((left, right) => {
      const leftDistance = getVendorDistance(left, userLocation)
      const rightDistance = getVendorDistance(right, userLocation)

      if (typeof leftDistance === 'number' && typeof rightDistance === 'number') {
        return leftDistance - rightDistance
      }

      if (typeof leftDistance === 'number') return -1
      if (typeof rightDistance === 'number') return 1
      return (left.name || '').localeCompare(right.name || '', 'id')
    })
  }, [filteredVendors, userLocation])

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
      const isOwnVendor = isVendor && vendor.id === myVendorId
      const popupActions = isOwnVendor
        ? [
          {
            label: 'Pilih',
            colors: {
              border: '#d1d5db',
              background: '#ffffff',
              color: '#111827',
            },
            onClick: () => focusVendor(vendor),
          },
          {
            label: 'Kelola',
            colors: {
              border: '#16a34a',
              background: '#16a34a',
              color: '#ffffff',
            },
            onClick: () => navigate('/dashboard?tab=products'),
          },
        ]
        : [
          {
            label: 'Detail',
            colors: {
              border: '#d1d5db',
              background: '#ffffff',
              color: '#111827',
            },
            onClick: () => focusVendor(vendor),
          },
          {
            label: 'Chat',
            colors: {
              border: '#2563eb',
              background: '#2563eb',
              color: '#ffffff',
            },
            onClick: () => navigate(`/chat/${vendor.id}`),
          },
          {
            label: 'Order',
            colors: {
              border: '#16a34a',
              background: '#16a34a',
              color: '#ffffff',
            },
            onClick: () => navigate(`/vendor/${vendor.id}#order-summary`),
          },
        ]

      marker.bindPopup(buildPopupContent(vendor, popupActions), { maxWidth: 320 })

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
  }, [clusterEnabled, filteredVendors, focusVendor, isVendor, myVendorId, navigate])

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
  const filteredVendorCount = filteredVendors.length
  const onlineVendorCount = onlineVendors.length
  const selectedVendorDistance = getVendorDistance(selectedVendor, userLocation)
  const selectedVendorIsMine = isVendor && selectedVendor?.id === myVendorId
  const selectedCategoryLabel = categoryOptions.find((option) => option.value === selectedCategory)?.label || 'Semua kategori'
  const heroBadge = isVendor ? 'Mode Pedagang' : 'Mode Pelanggan'
  const heroTitle = isVendor
    ? 'Pantau toko Anda dan tetap siap menerima pesanan dari peta.'
    : 'Temukan pedagang online terdekat dan lanjutkan transaksi dari peta.'
  const heroDescription = isVendor
    ? 'Kelilingku menempatkan pedagang pada mode operasional yang lebih ringkas: online, lokasi otomatis tersinkron, lalu pesanan dan chat bisa dipantau dari dashboard.'
    : 'Halaman utama difokuskan untuk pelanggan: cari pedagang aktif, cek yang paling dekat, lalu lanjutkan chat atau pesan tanpa banyak pindah layar.'

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:py-6">
        <section className="rounded-[32px] bg-white/95 p-5 shadow-sm ring-1 ring-slate-200/80 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-white">
                {heroBadge}
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                {heroTitle}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-base">
                {heroDescription}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => requestCurrentLocation()}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Lokasi Saya
              </button>
              <button
                onClick={() => {
                  const bounds = clusterRef.current?.getBounds?.()
                  if (bounds?.isValid?.()) mapRef.current?.fitBounds(bounds, { padding: [48, 48] })
                }}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Zoom Semua Toko
              </button>
              {isVendor && (
                <button
                  onClick={syncStoreLocationNow}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                >
                  {syncingStoreLocation ? 'Menyinkronkan...' : 'Sinkron Toko'}
                </button>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-700">Cari pedagang aktif</label>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Contoh: bakso, sayur, nasi kuning..."
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
                />
              </div>

                <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setOnlyWithinRadius((current) => !current)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    onlyWithinRadius
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {onlyWithinRadius ? 'Radius Aktif' : 'Filter Radius'}
                </button>
                  <button
                    onClick={() => {
                      setQuery('')
                      setSelectedCategory('all')
                      setOnlyWithinRadius(false)
                    }}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Reset
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="font-medium text-slate-800">Kategori pedagang</div>
                  <select
                    value={selectedCategory}
                    onChange={(event) => setSelectedCategory(event.target.value)}
                    className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
                  >
                    <option value="all">Semua kategori online</option>
                    {categoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {formatVendorCategoryLabel(option.label)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="font-medium text-slate-800">Radius pencarian</div>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={radiusKm}
                    onChange={(event) => setRadiusKm(Number(event.target.value || 0))}
                    className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
                  />
                </label>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <div className="font-medium text-slate-800">Status lokasi Anda</div>
                  <div className="mt-2">{getViewerLocationStatus(userLocation)}</div>
                  <div className="mt-2 text-xs text-slate-500">
                    Radius dipakai untuk menghitung toko yang paling dekat dan paling relevan.
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[24px] bg-slate-900 p-4 text-white">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Pedagang Online</div>
                <div className="mt-2 text-3xl font-semibold">{onlineVendorCount}</div>
                <div className="mt-1 text-sm text-slate-300">Toko aktif yang siap diajak chat atau dipesan.</div>
              </div>
              <div className="rounded-[24px] bg-emerald-50 p-4 ring-1 ring-emerald-100">
                <div className="text-xs uppercase tracking-[0.2em] text-emerald-700">Online Dalam Radius</div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">
                  {userLocation ? onlineVendorsWithinRadius.length : '-'}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {userLocation ? `Dalam radius ${radiusKm} km dari posisi Anda.` : 'Aktifkan lokasi untuk menghitung radius.'}
                </div>
              </div>
              <div className="rounded-[24px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Hasil Ditampilkan</div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">{filteredVendorCount}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {selectedCategory === 'all'
                    ? 'Sesuai pencarian, status toko, dan filter radius yang aktif.'
                    : `Difokuskan ke kategori ${formatVendorCategoryLabel(selectedCategoryLabel)}.`}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_380px]">
          <div className="rounded-[30px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Pedagang online sekarang</h2>
                <p className="text-sm leading-6 text-slate-500">
                  Daftar ini diprioritaskan untuk mobile: pilih toko, lanjut chat, lalu pesan dari menu yang tersedia.
                </p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {onlineListVendors.length} toko cocok dengan filter
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {onlineListVendors.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  Belum ada pedagang online yang cocok dengan pencarian Anda.
                </div>
              ) : (
                onlineListVendors.map((vendor) => {
                  const vendorDistance = getVendorDistance(vendor, userLocation)
                  const active = selectedVendor?.id === vendor.id
                  const isOwnVendor = isVendor && vendor.id === myVendorId

                  return (
                    <div
                      key={vendor.id}
                      className={`rounded-[24px] border p-4 transition ${
                        active
                          ? 'border-slate-900 bg-slate-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-14 w-14 overflow-hidden rounded-2xl bg-slate-100">
                          {vendor.photo_url ? (
                            <img src={vendor.photo_url} alt={vendor.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-lg font-semibold text-slate-500">
                              {(vendor.name || 'P')[0]}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-base font-semibold text-slate-900">{vendor.name}</div>
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                              Online
                            </span>
                            {vendor.category_primary ? (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                {formatVendorCategoryLabel(vendor.category_primary)}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">{formatDistanceLabel(vendorDistance)}</div>
                          <div className="mt-2 text-sm leading-6 text-slate-600">
                            {vendor.description ? String(vendor.description).slice(0, 120) : 'Belum ada deskripsi toko.'}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {isOwnVendor ? (
                          <>
                            <button
                              onClick={() => focusVendor(vendor)}
                              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Pantau Toko
                            </button>
                            <button
                              onClick={() => navigate('/dashboard?tab=products')}
                              className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
                            >
                              Kelola Produk
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => focusVendor(vendor)}
                              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Pilih Toko
                            </button>
                            <button
                              onClick={() => navigate(`/chat/${vendor.id}`)}
                              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Chat
                            </button>
                            <button
                              onClick={() => navigate(`/vendor/${vendor.id}#order-summary`)}
                              className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
                            >
                              Pesan Sekarang
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            {isVendor && (
              <div className="rounded-[30px] bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-5 shadow-sm ring-1 ring-emerald-100">
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
                  <div className="text-sm font-medium text-slate-800">Lokasi toko</div>
                  <div className="mt-2 text-sm text-slate-600">
                    {getStoreLocationStatus(myVendorLocation, { owner: true })}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Sinkron terakhir: {getVendorLocationUpdatedAtLabel(myVendorLocation)}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Saat toko online, lokasi akan terus diperbarui otomatis di background.
                  </div>
                </div>

                <div className="mt-4 grid gap-2">
                  <button
                    onClick={toggleMyOnlineStatus}
                    className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                  >
                    {myVendorRow?.__updating ? 'Menyimpan...' : toggleLabel}
                  </button>
                  <button
                    onClick={syncStoreLocationNow}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {syncingStoreLocation ? 'Sinkron Lokasi...' : 'Sinkron Sekarang'}
                  </button>
                  <button
                    onClick={() => navigate('/dashboard?tab=products')}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Kelola Produk
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-[30px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              {!selectedVendor ? (
                <>
                  <h2 className="text-lg font-semibold text-slate-900">Detail toko</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Pilih toko dari daftar online atau marker pada peta untuk melihat detail yang lebih lengkap.
                  </p>
                </>
              ) : (
                <>
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
                      <div className="text-sm text-slate-500">
                        {selectedVendor.online ? 'Sedang online' : 'Sedang offline'}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {formatDistanceLabel(selectedVendorDistance)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                    {selectedVendor.description || 'Belum ada deskripsi toko.'}
                  </div>

                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                    <div className="font-medium text-slate-800">Lokasi toko</div>
                    <div className="mt-1">{getStoreLocationStatus(selectedVendor.location, { owner: selectedVendorIsMine })}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Sinkron terakhir: {getVendorLocationUpdatedAtLabel(selectedVendor.location)}
                    </div>
                    {selectedVendor.category_primary ? (
                      <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {formatVendorCategoryLabel(selectedVendor.category_primary)}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {selectedVendorIsMine ? (
                      <>
                        <button
                          onClick={toggleMyOnlineStatus}
                          className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                        >
                          {myVendorRow?.__updating ? 'Menyimpan...' : toggleLabel}
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
                          Profil Toko
                        </button>
                        <button
                          onClick={() => navigate(`/vendor/${selectedVendor.id}#order-summary`)}
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
                </>
              )}
            </div>
          </aside>
        </section>

        <section className="space-y-3">
          <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/80">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Peta pedagang sekitar</h2>
                <p className="text-sm leading-6 text-slate-500">
                  Peta utama hanya menampilkan pedagang yang sedang online agar keputusan pelanggan tetap cepat dan fokus.
                </p>
              </div>
              <div className="text-sm text-slate-500">
                {loading ? 'Memuat pedagang...' : `${filteredVendorCount} toko tampil di peta`}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] bg-white p-2 shadow-lg shadow-slate-200/50 ring-1 ring-slate-200/70">
            <div ref={containerRef} className="h-[52vh] rounded-[24px] sm:h-[60vh] lg:h-[68vh]" />
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/70">
            <div>Peta fokus ke pedagang online yang cocok dengan pencarian dan filter radius Anda.</div>
            {userLocation ? (
              <div>{onlineVendorsWithinRadius.length} pedagang online dalam radius {radiusKm} km</div>
            ) : (
              <div className="text-slate-400">Aktifkan lokasi Anda untuk menghitung toko terdekat.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
