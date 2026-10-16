import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Coordinates, MapFilters, VendorMapItem } from '../../types/domain.types'
import { errorMessage } from '../../shared/lib/utils'
import { usePresenceClock } from '../../shared/hooks/usePresenceClock'
import { useVendorOperations } from '../vendor/useVendorOperations'
import LeafletMap from './LeafletMap'
import { useVendorMarkers } from './useVendorMarkers'

import { getBrowserPositionWithFallback } from '../../shared/lib/geolocation'
import { buildPopupContent } from './VendorMarker'
import { useLocation, useNavigate } from 'react-router-dom'
import { useActiveVendors } from './useActiveVendors'
import { useFavorites } from '../vendor/useFavorites'
import { useDemandOrders } from './useDemandOrders'
import { useDebounce } from '../../shared/hooks/useDebounce'
import L from '../../shared/lib/leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import VendorProductsPreview from '../vendor/components/VendorProductsPreview'
import MapSearchFilters from './components/MapFilters'

import { useToast } from '../../shared/components/ToastProvider'
import { useAuth } from '../auth/AuthProvider'
import { escapeMapText } from '../../lib/map-popup'
import { VENDOR_CATEGORIES } from '../../lib/vendor-categories'

import { getGeolocationErrorMessage } from '../../lib/network'

import { buildVendorTerritoryInsights } from '../../lib/territory'
import {
  formatVendorCategoryLabel,
  formatVendorPresenceAge,
  formatVendorPromoExpiry,
  getVendorPresenceTone,
  getVendorCoordinates,
  getVendorLocationUpdatedAtLabel,
  getVendorPromoText,
  isVendorPresenceFresh,
  isVendorPromoActive,
} from '../../lib/vendor'

import {
  haversineDistance,
  getVendorDistance,
  formatDistanceLabel,
  normalizeCategoryValue,
  getVendorCategory,
  getVendorSearchText,
  getVendorReviewCount,
  formatVendorRatingMeta,
  matchesRatingFilter,
  isVendorModeratedOut,
  getStoreLocationStatus,
  getPresenceBadgeClass,
} from './map-model'

const DEFAULT_FILTERS: MapFilters = {
  query: '',
  category: 'all',
  rating: 'all',
  mobility: 'all',
  radius: 2.5,
  withinRadius: false,
  promo: false,
  favorites: false,
}

export default function MapViewPage() {
  const { user, role } = useAuth()
  return <MapViewContent key={`${user?.id}:${role}`} />
}

function MapViewContent() {
  const { user, role } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const mapRef = useRef<L.Map | null>(null)
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const viewerMarker = useRef<L.CircleMarker | null>(null)
  const gpsRequest = useRef<AbortController | null>(null)
  const gpsBusy = useRef(false)
  const operations = useVendorOperations()
  const updateLocation = operations.updateLocation
  const readyMap = useCallback((map: L.Map | null) => {
    mapRef.current = map
    viewerMarker.current = null
    setMapInstance(map)
  }, [])
  useEffect(
    () => () => {
      gpsRequest.current?.abort()
    },
    []
  )
  const heatmapLayerRef = useRef<L.LayerGroup | null>(null)
  const autoLocateAttemptedRef = useRef(false)

  const vendorQuery = useActiveVendors()
  const { vendors } = vendorQuery
  const loading = vendorQuery.isPending
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS)
  const {
    query,
    category: selectedCategory,
    rating: selectedRatingFilter,
    mobility: selectedMobility,
    radius: radiusKm,
    withinRadius: onlyWithinRadius,
    favorites: onlyFavoriteVendors,
    promo: onlyPromoVendors,
  } = filters
  const debouncedQuery = useDebounce(query.trim().toLowerCase(), 300)
  const [selectedVendor, setSelectedVendor] = useState<VendorMapItem | null>(null)
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null)
  const [syncingStoreLocation, setSyncingStoreLocation] = useState(false)
  const favoritesQuery = useFavorites()
  const {
    ids: favoriteVendorIds,
    available: favoriteFeatureEnabled,
    busyVendorId: favoriteBusyVendorId,
    setFavorite,
  } = favoritesQuery

  const [showAllVendors, setShowAllVendors] = useState(false)
  const demandQuery = useDemandOrders()
  const demandOrders = demandQuery.orders
  const [showDemandHeatmap, setShowDemandHeatmap] = useState(true)
  const presenceClock = usePresenceClock(vendors)
  const changeVendorFilter = useCallback(
    <K extends keyof MapFilters>(name: K, value: MapFilters[K]) => {
      setFilters((previous) => ({ ...previous, [name]: value }))
      setShowAllVendors(false)
    },
    []
  )

  const isAdmin = role === 'admin'
  const isVendor = role === 'vendor'
  const isCustomerViewer = Boolean(user?.id) && !isVendor && !isAdmin
  const myVendorId = user?.id
  const favoriteVendorIdSet = useMemo(() => new Set(favoriteVendorIds), [favoriteVendorIds])

  const requestFavoriteView = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('favorites') === '1'
  }, [location.search])

  const applyViewerLocation = useCallback(
    (
      lat: number,
      lng: number,
      options: { focus?: boolean; zoom?: number; duration?: number } = {}
    ) => {
      const map = mapRef.current
      setUserLocation({ lat, lng })

      if (!map) return

      if (viewerMarker.current) viewerMarker.current.setLatLng([lat, lng])
      else
        viewerMarker.current = L.circleMarker([lat, lng], {
          radius: 8,
          color: '#2563eb',
          fillColor: '#2563eb',
          fillOpacity: 0.9,
        }).addTo(map)

      if (options.focus) {
        map.flyTo([lat, lng], options.zoom || 16, {
          animate: true,
          duration: options.duration || 0.6,
        })
      }
    },
    []
  )

  const syncStoreLocationNow = useCallback(async () => {
    if (!isVendor || !myVendorId || gpsBusy.current) return
    gpsBusy.current = true
    gpsRequest.current?.abort()
    const controller = new AbortController()
    gpsRequest.current = controller
    setSyncingStoreLocation(true)
    try {
      const position = await getBrowserPositionWithFallback(controller.signal)
      if (controller.signal.aborted) return
      const { latitude: lat, longitude: lng, accuracy } = position.coords
      applyViewerLocation(lat, lng, { focus: true, zoom: 16 })
      await updateLocation({ lat, lng, accuracy })
      if (!controller.signal.aborted)
        toast.push('Lokasi toko berhasil diperbarui', { type: 'success' })
    } catch (error) {
      if (!controller.signal.aborted)
        toast.push(getGeolocationErrorMessage(error), { type: 'error' })
    } finally {
      gpsBusy.current = false
      setSyncingStoreLocation(false)
    }
  }, [applyViewerLocation, isVendor, myVendorId, toast, updateLocation])

  const requestCurrentLocation = useCallback(async () => {
    if (!mapRef.current) return
    gpsRequest.current?.abort()
    const controller = new AbortController()
    gpsRequest.current = controller
    setSelectedVendor(null)
    try {
      const position = await getBrowserPositionWithFallback(controller.signal)
      if (!controller.signal.aborted)
        applyViewerLocation(position.coords.latitude, position.coords.longitude, {
          focus: true,
          zoom: 16,
        })
    } catch (error) {
      if (!controller.signal.aborted)
        toast.push(getGeolocationErrorMessage(error), { type: 'error' })
    }
  }, [applyViewerLocation, toast])

  const focusVendor = useCallback((vendor: VendorMapItem) => {
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
    if (!isCustomerViewer || !favoriteFeatureEnabled) {
      changeVendorFilter('favorites', false)
      return
    }

    changeVendorFilter('favorites', requestFavoriteView)
  }, [changeVendorFilter, favoriteFeatureEnabled, isCustomerViewer, requestFavoriteView])

  const toggleVendorFavorite = useCallback(
    async (vendor: VendorMapItem) => {
      if (!vendor?.id || !isCustomerViewer || !favoriteFeatureEnabled) return
      const next = !favoriteVendorIdSet.has(vendor.id)
      try {
        const saved = await setFavorite(vendor.id, next)
        if (saved)
          toast.push(next ? 'Pedagang disimpan ke favorit' : 'Pedagang dihapus dari favorit', {
            type: 'success',
          })
      } catch {
        toast.push('Favorit belum dapat diperbarui. Coba lagi.', { type: 'error' })
      }
    },
    [favoriteFeatureEnabled, favoriteVendorIdSet, isCustomerViewer, setFavorite, toast]
  )

  useEffect(() => {
    if (!selectedVendor) return

    const nextVendor = vendors.find((vendor) => vendor.id === selectedVendor.id)
    if (!nextVendor || !isVendorPresenceFresh(nextVendor, presenceClock)) {
      setSelectedVendor(null)
      return
    }

    if (nextVendor !== selectedVendor) {
      setSelectedVendor(nextVendor)
    }
  }, [presenceClock, selectedVendor, vendors])

  useEffect(() => {
    if (!isVendor || !myVendorId || autoLocateAttemptedRef.current) return

    const currentVendor = vendors.find((vendor) => vendor.id === myVendorId)
    if (!currentVendor) return
    if (getVendorCoordinates(currentVendor.location)) return
    if (!mapRef.current) return

    autoLocateAttemptedRef.current = true
    toast.push('Izinkan lokasi agar posisi toko Anda muncul di peta pelanggan.', { type: 'info' })
    void syncStoreLocationNow()
  }, [isVendor, mapInstance, myVendorId, syncStoreLocationNow, toast, vendors])

  const filteredVendors = useMemo(() => {
    return vendors.filter((vendor) => {
      const coordinates = getVendorCoordinates(vendor.location)
      if (
        !isVendorPresenceFresh(vendor, presenceClock) ||
        !coordinates ||
        isVendorModeratedOut(vendor)
      )
        return false

      const vendorCategory = getVendorCategory(vendor)
      if (selectedCategory !== 'all') {
        if (normalizeCategoryValue(vendorCategory) !== selectedCategory) return false
      }

      if (!matchesRatingFilter(vendor, selectedRatingFilter)) return false
      if (selectedMobility !== 'all' && vendor.mobility_type !== selectedMobility) return false
      if (onlyFavoriteVendors && !favoriteVendorIdSet.has(vendor.id)) return false
      if (onlyPromoVendors && !isVendorPromoActive(vendor)) return false

      if (debouncedQuery) {
        const haystack =
          `${vendor.name || ''} ${vendor.description || ''} ${vendorCategory} ${getVendorSearchText(vendor)} ${getVendorPromoText(vendor)}`.toLowerCase()
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
  }, [
    debouncedQuery,
    favoriteVendorIdSet,
    onlyFavoriteVendors,
    onlyPromoVendors,
    onlyWithinRadius,
    radiusKm,
    presenceClock,
    selectedCategory,
    selectedRatingFilter,
    selectedMobility,
    userLocation,
    vendors,
  ])

  const onlineVendors = useMemo(
    () =>
      vendors.filter(
        (vendor) => isVendorPresenceFresh(vendor, presenceClock) && !isVendorModeratedOut(vendor)
      ),
    [presenceClock, vendors]
  )

  const categoryOptions = useMemo(() => {
    const categoryMap = new Map(
      VENDOR_CATEGORIES.map((category) => [category.label.toLowerCase(), category.label])
    )

    for (const vendor of onlineVendors) {
      const rawCategory = getVendorCategory(vendor)
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
    changeVendorFilter('category', 'all')
  }, [categoryOptions, changeVendorFilter, selectedCategory])

  const onlineVendorsWithinRadius = useMemo(() => {
    if (!userLocation) return []

    return onlineVendors.filter((vendor) => {
      const distance = getVendorDistance(vendor, userLocation)
      return typeof distance === 'number' && distance <= radiusKm * 1000
    })
  }, [onlineVendors, radiusKm, userLocation])

  const onlineListVendors = useMemo(() => {
    return [...filteredVendors].sort((left, right) => {
      const leftFavorite = favoriteVendorIdSet.has(left.id)
      const rightFavorite = favoriteVendorIdSet.has(right.id)
      if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1

      const leftPromo = isVendorPromoActive(left)
      const rightPromo = isVendorPromoActive(right)
      if (leftPromo !== rightPromo) return leftPromo ? -1 : 1

      const leftDistance = getVendorDistance(left, userLocation)
      const rightDistance = getVendorDistance(right, userLocation)

      if (typeof leftDistance === 'number' && typeof rightDistance === 'number') {
        return leftDistance - rightDistance
      }

      if (typeof leftDistance === 'number') return -1
      if (typeof rightDistance === 'number') return 1
      return (left.name || '').localeCompare(right.name || '', 'id')
    })
  }, [favoriteVendorIdSet, filteredVendors, userLocation])

  const visibleOnlineListVendors = showAllVendors
    ? onlineListVendors
    : onlineListVendors.slice(0, 6)

  useEffect(() => {
    setShowAllVendors(false)
  }, [
    debouncedQuery,
    onlyFavoriteVendors,
    onlyPromoVendors,
    onlyWithinRadius,
    radiusKm,
    selectedCategory,
    selectedRatingFilter,
  ])

  const demandInsights = useMemo(() => buildVendorTerritoryInsights(demandOrders), [demandOrders])

  useEffect(() => {
    if (!selectedVendor) return
    if (filteredVendors.some((vendor) => vendor.id === selectedVendor.id)) return
    setSelectedVendor(null)
  }, [filteredVendors, selectedVendor])

  const createVendorPopup = useCallback(
    (vendor: VendorMapItem) => {
      const isOwnVendor = isVendor && vendor.id === myVendorId
      const isFavorite = favoriteVendorIdSet.has(vendor.id)
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
            ...(isCustomerViewer && favoriteFeatureEnabled
              ? [
                  {
                    label:
                      favoriteBusyVendorId === vendor.id
                        ? 'Menyimpan...'
                        : isFavorite
                          ? 'Favorit'
                          : 'Simpan',
                    colors: {
                      border: '#e11d48',
                      background: isFavorite ? '#e11d48' : '#fff1f2',
                      color: isFavorite ? '#ffffff' : '#be123c',
                    },
                    onClick: () => {
                      void toggleVendorFavorite(vendor)
                    },
                  },
                ]
              : []),
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

      return buildPopupContent(vendor, popupActions)
    },
    [
      favoriteBusyVendorId,
      favoriteFeatureEnabled,
      favoriteVendorIdSet,
      focusVendor,
      isCustomerViewer,
      isVendor,
      myVendorId,
      navigate,
      toggleVendorFavorite,
    ]
  )
  useVendorMarkers(
    mapInstance,
    filteredVendors,
    createVendorPopup,
    JSON.stringify([
      favoriteBusyVendorId,
      favoriteFeatureEnabled,
      favoriteVendorIds,
      isCustomerViewer,
      isVendor,
      myVendorId,
    ])
  )

  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined

    if (heatmapLayerRef.current) {
      try {
        map.removeLayer(heatmapLayerRef.current)
      } catch (error) {
        console.error('removeDemandHeatmapLayer', error)
      }
      heatmapLayerRef.current = null
    }

    if (!isVendor || !showDemandHeatmap || !demandInsights.hotspotCount) {
      return undefined
    }

    const group = L.layerGroup()

    demandInsights.hotspots.forEach((hotspot) => {
      if (!Number.isFinite(hotspot.lat) || !Number.isFinite(hotspot.lng)) return

      const radius = 120 + hotspot.intensity * 95
      const fillOpacity = 0.1 + hotspot.intensity * 0.08
      const circle = L.circle([hotspot.lat, hotspot.lng], {
        radius,
        color: '#f97316',
        weight: 1,
        opacity: 0.45,
        fillColor: '#f59e0b',
        fillOpacity,
      })

      circle.bindTooltip(`${escapeMapText(hotspot.label)}: ${hotspot.orderCount} permintaan`, {
        direction: 'top',
        opacity: 0.92,
      })

      const core = L.circleMarker([hotspot.lat, hotspot.lng], {
        radius: 5 + hotspot.intensity,
        color: '#ea580c',
        weight: 1,
        fillColor: '#f97316',
        fillOpacity: 0.85,
      })

      group.addLayer(circle)
      group.addLayer(core)
    })

    heatmapLayerRef.current = group
    group.addTo(map)

    return () => {
      try {
        map.removeLayer(group)
      } catch (error) {
        console.error('cleanupDemandHeatmapLayer', error)
      }
      heatmapLayerRef.current = null
    }
  }, [demandInsights, isVendor, mapInstance, showDemandHeatmap])

  async function toggleMyOnlineStatus() {
    const current = vendors.find((vendor) => vendor.id === myVendorId)
    if (!isVendor || !current) return
    try {
      const online = await operations.setOnline(!current.online)
      if (online !== null)
        toast.push(`Status toko: ${online ? 'Online' : 'Offline'}`, { type: 'success' })
    } catch (error) {
      toast.push(errorMessage(error, 'Gagal mengubah status toko'), { type: 'error' })
    }
  }

  const myVendorRow = vendors.find((vendor) => vendor.id === myVendorId)
  const toggleLabel = myVendorRow?.online ? 'Jadikan Offline' : 'Jadikan Online'
  const myVendorPresenceLabel = myVendorRow?.online
    ? formatVendorPresenceAge(myVendorRow, presenceClock)
    : 'Offline'
  const myVendorPresenceTone = getVendorPresenceTone(myVendorRow, presenceClock)
  const filteredVendorCount = filteredVendors.length
  const onlineVendorCount = onlineVendors.length
  const favoriteVendorCount = favoriteVendorIds.length
  const promoVendorCount = onlineVendors.filter((vendor) => isVendorPromoActive(vendor)).length
  const selectedVendorDistance = getVendorDistance(selectedVendor, userLocation)
  const selectedVendorIsMine = isVendor && selectedVendor?.id === myVendorId
  const selectedVendorIsFavorite = selectedVendor
    ? favoriteVendorIdSet.has(selectedVendor.id)
    : false
  const selectedVendorHasPromo = selectedVendor ? isVendorPromoActive(selectedVendor) : false
  const selectedVendorPresenceLabel = selectedVendor
    ? formatVendorPresenceAge(selectedVendor, presenceClock)
    : ''
  const selectedVendorPresenceTone = selectedVendor
    ? getVendorPresenceTone(selectedVendor, presenceClock)
    : 'stale'
  const emptyVendorStateMessage =
    onlyFavoriteVendors && onlyPromoVendors
      ? favoriteVendorCount > 0
        ? promoVendorCount > 0
          ? 'Belum ada pedagang favorit dengan promo aktif yang cocok dengan filter ini.'
          : 'Belum ada promo aktif yang sedang berjalan pada pedagang favorit Anda.'
        : 'Anda belum punya pedagang favorit. Simpan toko dari detail peta atau profil toko terlebih dahulu.'
      : onlyFavoriteVendors
        ? favoriteVendorCount > 0
          ? 'Belum ada pedagang favorit Anda yang online dan cocok dengan filter ini.'
          : 'Anda belum punya pedagang favorit. Simpan toko dari detail peta atau profil toko terlebih dahulu.'
        : onlyPromoVendors
          ? promoVendorCount > 0
            ? 'Belum ada pedagang dengan promo aktif yang cocok dengan filter ini.'
            : 'Belum ada pedagang yang sedang menjalankan promo aktif saat ini.'
          : 'Belum ada pedagang online yang cocok dengan pencarian Anda.'
  function resetVendorFilters() {
    setFilters({ ...DEFAULT_FILTERS, radius: radiusKm })
    setShowAllVendors(false)
  }
  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6">
        {vendorQuery.error ? (
          <p role="alert" className="order-1 text-sm text-amber-800">
            Pembaruan peta tertunda.{' '}
            <button
              type="button"
              onClick={() => {
                void vendorQuery.refetch()
              }}
            >
              Coba lagi
            </button>
          </p>
        ) : null}
        {isVendor ? (
          <section className="order-1 min-w-0 rounded-[22px] border border-teal-900 bg-gradient-to-br from-teal-950 to-slate-900 p-3 text-white shadow-sm sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold sm:text-base">Status jualan</h2>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      myVendorRow?.online
                        ? 'bg-emerald-400 text-emerald-950'
                        : 'bg-white/10 text-slate-200'
                    }`}
                  >
                    {myVendorRow?.online ? 'Online' : 'Offline'}
                  </span>
                  {myVendorRow?.online ? (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${getPresenceBadgeClass(myVendorPresenceTone)}`}
                    >
                      {myVendorPresenceLabel}
                    </span>
                  ) : null}
                </div>
              </div>

              <button
                onClick={toggleMyOnlineStatus}
                disabled={operations.updatingOnline}
                className="min-h-11 shrink-0 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
              >
                {operations.updatingOnline ? 'Menyimpan...' : toggleLabel}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 sm:flex sm:flex-wrap">
              <button
                onClick={syncStoreLocationNow}
                disabled={syncingStoreLocation}
                className="shrink-0 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/15"
              >
                {syncingStoreLocation ? 'Sinkron...' : 'Sinkron Lokasi'}
              </button>
              <button
                onClick={() => setShowDemandHeatmap((current) => !current)}
                title="Area dari pesanan toko Anda, bukan seluruh permintaan pasar"
                aria-pressed={Boolean(showDemandHeatmap && demandInsights.hotspotCount)}
                disabled={!demandInsights.hotspotCount}
                className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  showDemandHeatmap && demandInsights.hotspotCount
                    ? 'bg-amber-400 text-amber-950'
                    : 'border border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-50'
                }`}
              >
                {showDemandHeatmap && demandInsights.hotspotCount
                  ? 'Area pesanan aktif'
                  : 'Area pesanan'}
              </button>
            </div>
          </section>
        ) : null}

        <section
          className={isVendor ? 'order-3 min-w-0' : 'order-2 min-w-0'}
          aria-label="Pencarian pedagang"
        >
          <MapSearchFilters
            filters={filters}
            onChange={changeVendorFilter}
            onReset={resetVendorFilters}
            categories={categoryOptions}
            customer={isCustomerViewer}
            favoritesEnabled={favoriteFeatureEnabled}
            favoritesCount={favoriteVendorCount}
            totalCount={onlineVendorCount}
            resultCount={filteredVendorCount}
            nearbyCount={onlineVendorsWithinRadius.length}
            locationAvailable={Boolean(userLocation)}
          />
        </section>

        <section
          className={`${isVendor ? 'order-4' : 'order-3'} grid min-w-0 max-w-full gap-4 xl:grid-cols-[minmax(0,1.35fr)_380px]`}
        >
          <div className="min-w-0 max-w-full overflow-hidden rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:p-4">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-900 sm:text-lg">
                  Pedagang online
                </h2>
              </div>
              <div className="shrink-0 text-xs font-medium text-slate-500">
                {onlineListVendors.length} toko
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {onlineListVendors.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  {emptyVendorStateMessage}
                </div>
              ) : (
                visibleOnlineListVendors.map((vendor) => {
                  const vendorDistance = getVendorDistance(vendor, userLocation)
                  const active = selectedVendor?.id === vendor.id
                  const isOwnVendor = isVendor && vendor.id === myVendorId
                  const hasPromo = isVendorPromoActive(vendor)
                  const vendorPresenceTone = getVendorPresenceTone(vendor, presenceClock)
                  const vendorPresenceLabel = formatVendorPresenceAge(vendor, presenceClock)

                  return (
                    <div
                      key={vendor.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => focusVendor(vendor)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          focusVendor(vendor)
                        }
                      }}
                      className={`min-w-0 max-w-full cursor-pointer overflow-hidden rounded-[18px] border p-3 transition ${
                        active
                          ? 'border-slate-900 bg-slate-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:h-12 sm:w-12">
                          {vendor.photo_url ? (
                            <img
                              src={vendor.photo_url}
                              alt={vendor.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-lg font-semibold text-slate-500">
                              {(vendor.name || 'P')[0]}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="truncate text-base font-semibold text-slate-900">
                              {vendor.name}
                            </div>
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                              title="Online"
                            />
                            {hasPromo ? (
                              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                Promo
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 truncate text-sm text-slate-500">
                            {[
                              getVendorCategory(vendor)
                                ? formatVendorCategoryLabel(getVendorCategory(vendor))
                                : null,
                              formatDistanceLabel(vendorDistance),
                              getVendorReviewCount(vendor) > 0
                                ? formatVendorRatingMeta(vendor)
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' • ')}
                          </div>
                          {vendorPresenceTone !== 'fresh' ? (
                            <div
                              className={`mt-1 text-xs ${vendorPresenceTone === 'aging' ? 'text-amber-700' : 'text-slate-500'}`}
                            >
                              {vendorPresenceLabel}
                            </div>
                          ) : null}
                          {vendor.description ? (
                            <div className="mt-1 line-clamp-1 text-sm text-slate-600">
                              {vendor.description}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        {isOwnVendor ? (
                          <>
                            <button
                              onClick={() => focusVendor(vendor)}
                              className="hidden rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:inline-flex"
                            >
                              Pantau Toko
                            </button>
                            <button
                              onClick={() => navigate('/dashboard?tab=products')}
                              className="col-span-2 rounded-xl bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-emerald-700 sm:col-span-1"
                            >
                              Kelola Produk
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => focusVendor(vendor)}
                              className="hidden rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:inline-flex"
                            >
                              Pilih Toko
                            </button>
                            <button
                              onClick={() => navigate(`/chat/${vendor.id}`)}
                              className="min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Chat
                            </button>
                            <button
                              onClick={() => navigate(`/vendor/${vendor.id}#order-summary`)}
                              className="min-w-0 truncate rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
                            >
                              <span className="sm:hidden">Pesan</span>
                              <span className="hidden sm:inline">Pesan Sekarang</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            {onlineListVendors.length > 6 ? (
              <button
                type="button"
                onClick={() => setShowAllVendors((current) => !current)}
                className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                {showAllVendors
                  ? 'Tampilkan lebih sedikit'
                  : `Lihat ${onlineListVendors.length - 6} toko lainnya`}
              </button>
            ) : null}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <div className="hidden rounded-[30px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80 xl:block">
              {!selectedVendor ? (
                <>
                  <h2 className="text-lg font-semibold text-slate-900">Detail toko</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Pilih toko dari daftar online atau marker pada peta untuk melihat detail yang
                    lebih lengkap.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-16 w-16 overflow-hidden rounded-2xl bg-slate-100">
                      {selectedVendor.photo_url ? (
                        <img
                          src={selectedVendor.photo_url}
                          alt={selectedVendor.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xl text-slate-500">
                          {(selectedVendor.name || 'P')[0]}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-lg font-semibold text-slate-900">
                        {selectedVendor.name}
                      </div>
                      <div className="text-sm text-slate-500">
                        {selectedVendor.online ? 'Sedang online' : 'Sedang offline'}
                      </div>
                      {selectedVendor.online ? (
                        <div
                          className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getPresenceBadgeClass(selectedVendorPresenceTone)}`}
                        >
                          {selectedVendorPresenceLabel}
                        </div>
                      ) : null}
                      <div className="mt-1 text-xs text-slate-400">
                        {formatDistanceLabel(selectedVendorDistance)}
                      </div>
                      <div className="mt-1 text-xs text-amber-700">
                        {formatVendorRatingMeta(selectedVendor)}
                      </div>
                      {selectedVendorHasPromo ? (
                        <div className="mt-1 text-xs font-medium text-amber-700">
                          Promo aktif tersedia di toko ini
                        </div>
                      ) : null}
                      {isCustomerViewer && selectedVendorIsFavorite ? (
                        <div className="mt-1 text-xs font-medium text-rose-700">
                          Sudah tersimpan di favorit Anda
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {selectedVendorHasPromo ? (
                    <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                        Promo Aktif
                      </div>
                      <div className="mt-2 font-medium">{getVendorPromoText(selectedVendor)}</div>
                      <div className="mt-1 text-xs text-amber-700">
                        Berlaku sampai {formatVendorPromoExpiry(selectedVendor)}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                    {selectedVendor.description || 'Belum ada deskripsi toko.'}
                  </div>

                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                    <div className="font-medium text-slate-800">Lokasi toko</div>
                    <div className="mt-1">
                      {getStoreLocationStatus(selectedVendor.location, {
                        owner: selectedVendorIsMine,
                      })}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Sinkron terakhir: {getVendorLocationUpdatedAtLabel(selectedVendor.location)}
                    </div>
                    {getVendorCategory(selectedVendor) ? (
                      <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {formatVendorCategoryLabel(getVendorCategory(selectedVendor))}
                      </div>
                    ) : null}
                    {getVendorReviewCount(selectedVendor) > 0 ? (
                      <div className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        {formatVendorRatingMeta(selectedVendor)}
                      </div>
                    ) : null}
                    {selectedVendorHasPromo ? (
                      <div className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                        Promo Aktif
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
                          {operations.updatingOnline ? 'Menyimpan...' : toggleLabel}
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
                        {isCustomerViewer && favoriteFeatureEnabled && (
                          <button
                            onClick={() => void toggleVendorFavorite(selectedVendor)}
                            disabled={favoriteBusyVendorId === selectedVendor.id}
                            className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                              selectedVendorIsFavorite
                                ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70'
                                : 'border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70'
                            }`}
                          >
                            {favoriteBusyVendorId === selectedVendor.id
                              ? 'Menyimpan...'
                              : selectedVendorIsFavorite
                                ? 'Tersimpan di Favorit'
                                : 'Simpan Favorit'}
                          </button>
                        )}
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

                  <div className="mt-5 hidden xl:block">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Preview Produk
                    </h3>
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

        <section className={`${isVendor ? 'order-2' : 'order-1'} space-y-3`}>
          <div className="overflow-hidden rounded-[22px] bg-white p-2 shadow-sm ring-1 ring-slate-200/80">
            <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
              <h1 className="text-sm font-semibold text-slate-900 sm:text-base">
                Peta pedagang sekitar
              </h1>
              <div className="text-xs text-slate-500">
                {loading ? 'Memuat...' : `${filteredVendorCount} toko`}
              </div>
            </div>
            <LeafletMap
              onReady={readyMap}
              onLocate={() => {
                void requestCurrentLocation()
              }}
              className="h-[56vh] rounded-[18px] sm:h-[62vh] lg:h-[68vh]"
            />
          </div>

          {selectedVendor ? (
            <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 xl:hidden">
              <div className="flex items-start gap-3">
                <div className="h-14 w-14 overflow-hidden rounded-2xl bg-slate-100">
                  {selectedVendor.photo_url ? (
                    <img
                      src={selectedVendor.photo_url}
                      alt={selectedVendor.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-lg font-semibold text-slate-500">
                      {(selectedVendor.name || 'P')[0]}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-slate-900">
                        {selectedVendor.name}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {formatDistanceLabel(selectedVendorDistance)}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedVendor(null)}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50"
                    >
                      Tutup
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        selectedVendor.online
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {selectedVendor.online ? 'Online' : 'Offline'}
                    </span>
                    {selectedVendor.online ? (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${getPresenceBadgeClass(selectedVendorPresenceTone)}`}
                      >
                        {selectedVendorPresenceLabel}
                      </span>
                    ) : null}
                    {getVendorCategory(selectedVendor) ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {formatVendorCategoryLabel(getVendorCategory(selectedVendor))}
                      </span>
                    ) : null}
                    {getVendorReviewCount(selectedVendor) > 0 ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        {formatVendorRatingMeta(selectedVendor)}
                      </span>
                    ) : null}
                    {selectedVendorHasPromo ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                        Promo Aktif
                      </span>
                    ) : null}
                    {isCustomerViewer && selectedVendorIsFavorite ? (
                      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                        Favorit
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-3 text-sm leading-6 text-slate-600">
                {selectedVendor.description
                  ? String(selectedVendor.description).slice(0, 120)
                  : 'Belum ada deskripsi toko.'}
              </div>

              {selectedVendorIsMine ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={toggleMyOnlineStatus}
                    className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                  >
                    {operations.updatingOnline ? 'Menyimpan...' : toggleLabel}
                  </button>
                  <button
                    onClick={syncStoreLocationNow}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {syncingStoreLocation ? 'Sinkron...' : 'Sinkron Lokasi'}
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
                </div>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => navigate(`/chat/${selectedVendor.id}`)}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Chat
                    </button>
                    <button
                      onClick={() => navigate(`/vendor/${selectedVendor.id}#order-summary`)}
                      className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                    >
                      Pesan
                    </button>
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={() => navigate(`/vendor/${selectedVendor.id}`)}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Profil Toko
                    </button>
                    {isCustomerViewer && favoriteFeatureEnabled ? (
                      <button
                        onClick={() => void toggleVendorFavorite(selectedVendor)}
                        disabled={favoriteBusyVendorId === selectedVendor.id}
                        className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                          selectedVendorIsFavorite
                            ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70'
                            : 'border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70'
                        }`}
                      >
                        {favoriteBusyVendorId === selectedVendor.id
                          ? 'Menyimpan...'
                          : selectedVendorIsFavorite
                            ? 'Favorit Tersimpan'
                            : 'Simpan Favorit'}
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
