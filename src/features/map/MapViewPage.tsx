import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Modal } from '../../shared/components/Modal'
import { useMediaQuery } from '../../shared/hooks/useMediaQuery'
import VendorSummary from './components/VendorSummary'
import type {
  Coordinates,
  MapFilters,
  VendorMapItem
} from '../../types/domain.types'
import { errorMessage } from '../../shared/lib/utils'
import { usePresenceClock } from '../../shared/hooks/usePresenceClock'
import { SyncStatus } from '../../shared/components/SyncStatus'
import { useVendorOperations } from '../vendor/useVendorOperations'
import LeafletMap from './LeafletMap'
import { useVendorMarkers } from './useVendorMarkers'

import { getBrowserPositionWithFallback } from '../../shared/lib/geolocation'
import { buildPopupContent } from './VendorMarker'
import { useLocation, useNavigate } from 'react-router-dom'
import { useActiveVendors } from './useActiveVendors'
import { useFavorites } from '../vendor/useFavorites'
import { useDemandOrders } from './useDemandOrders'
import { useDemandLayer } from './useDemandLayer'
import { useDebounce } from '../../shared/hooks/useDebounce'
import L from '../../shared/lib/leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import MapSearchFilters from './components/MapFilters'

import { useToast } from '../../shared/components/ToastProvider'
import { useAuth } from '../auth/AuthProvider'
import { VENDOR_CATEGORIES } from '../../lib/vendor-categories'

import { getGeolocationErrorMessage } from '../../lib/network'

import { buildVendorTerritoryInsights } from '../../lib/territory'
import {
  formatVendorCategoryLabel,
  formatVendorPresenceAge,
  getVendorPresenceTone,
  getVendorCoordinates,
  getVendorPromoText,
  isVendorPresenceFresh,
  isVendorPromoActive
} from '../../lib/vendor'

import {
  haversineDistance,
  getVendorDistance,
  formatDistanceLabel,
  normalizeCategoryValue,
  getVendorCategory,
  getVendorSearchText,
  matchesRatingFilter,
  isVendorModeratedOut
} from './map-model'

const DEFAULT_FILTERS: MapFilters = {
  query: '',
  category: 'all',
  rating: 'all',
  mobility: 'all',
  radius: 2.5,
  withinRadius: false,
  promo: false,
  favorites: false
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
    promo: onlyPromoVendors
  } = filters
  const debouncedQuery = useDebounce(query.trim().toLowerCase(), 300)
  const [selectedVendor, setSelectedVendor] = useState<VendorMapItem | null>(
    null
  )
  const wideLayout = useMediaQuery('(min-width: 1024px)')
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null)
  const [syncingStoreLocation, setSyncingStoreLocation] = useState(false)
  const favoritesQuery = useFavorites()
  const {
    ids: favoriteVendorIds,
    available: favoriteFeatureEnabled,
    busyVendorId: favoriteBusyVendorId,
    setFavorite
  } = favoritesQuery

  const [showAllVendors, setShowAllVendors] = useState(false)
  const demandQuery = useDemandOrders()
  const demandOrders = demandQuery.orders
  const [showDemandHeatmap, setShowDemandHeatmap] = useState(false)
  const [demandPeriod, setDemandPeriod] = useState<'14' | '30' | 'all'>('14')
  const [demandFocusRequest, setDemandFocusRequest] = useState(0)
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
  const favoriteVendorIdSet = useMemo(
    () => new Set(favoriteVendorIds),
    [favoriteVendorIds]
  )

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
          fillOpacity: 0.9
        }).addTo(map)

      if (options.focus) {
        map.flyTo([lat, lng], options.zoom || 16, {
          animate: true,
          duration: options.duration || 0.6
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
        applyViewerLocation(
          position.coords.latitude,
          position.coords.longitude,
          {
            focus: true,
            zoom: 16
          }
        )
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
        duration: 0.8
      })
    }
  }, [])

  useEffect(() => {
    if (!isCustomerViewer || !favoriteFeatureEnabled) {
      changeVendorFilter('favorites', false)
      return
    }

    changeVendorFilter('favorites', requestFavoriteView)
  }, [
    changeVendorFilter,
    favoriteFeatureEnabled,
    isCustomerViewer,
    requestFavoriteView
  ])

  const toggleVendorFavorite = useCallback(
    async (vendor: VendorMapItem) => {
      if (!vendor?.id || !isCustomerViewer || !favoriteFeatureEnabled) return
      const next = !favoriteVendorIdSet.has(vendor.id)
      try {
        const saved = await setFavorite(vendor.id, next)
        if (saved)
          toast.push(
            next
              ? 'Pedagang disimpan ke favorit'
              : 'Pedagang dihapus dari favorit',
            {
              type: 'success'
            }
          )
      } catch {
        toast.push('Favorit belum dapat diperbarui. Coba lagi.', {
          type: 'error'
        })
      }
    },
    [
      favoriteFeatureEnabled,
      favoriteVendorIdSet,
      isCustomerViewer,
      setFavorite,
      toast
    ]
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
    toast.push(
      'Izinkan lokasi agar posisi toko Anda muncul di peta pelanggan.',
      { type: 'info' }
    )
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
        if (normalizeCategoryValue(vendorCategory) !== selectedCategory)
          return false
      }

      if (!matchesRatingFilter(vendor, selectedRatingFilter)) return false
      if (
        selectedMobility !== 'all' &&
        vendor.mobility_type !== selectedMobility
      )
        return false
      if (onlyFavoriteVendors && !favoriteVendorIdSet.has(vendor.id))
        return false
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
    vendors
  ])

  const onlineVendors = useMemo(
    () =>
      vendors.filter(
        (vendor) =>
          isVendorPresenceFresh(vendor, presenceClock) &&
          !isVendorModeratedOut(vendor)
      ),
    [presenceClock, vendors]
  )

  const categoryOptions = useMemo(() => {
    const categoryMap = new Map(
      VENDOR_CATEGORIES.map((category) => [
        category.label.toLowerCase(),
        category.label
      ])
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
    if (categoryOptions.some((option) => option.value === selectedCategory))
      return
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

      if (
        typeof leftDistance === 'number' &&
        typeof rightDistance === 'number'
      ) {
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
    selectedRatingFilter
  ])

  const demandMinute = Math.floor(presenceClock / 60_000)
  const demandInsights = useMemo(
    () =>
      buildVendorTerritoryInsights(demandOrders, {
        lookbackDays: demandPeriod === 'all' ? null : Number(demandPeriod)
      }),
    [demandOrders, demandPeriod, demandMinute]
  )
  useDemandLayer(
    mapInstance,
    demandInsights.hotspots,
    isVendor && showDemandHeatmap,
    demandFocusRequest
  )

  function toggleDemandLayer() {
    setShowDemandHeatmap((current) => !current)
    if (!showDemandHeatmap) setDemandFocusRequest((current) => current + 1)
  }

  useEffect(() => {
    setSelectedVendor((current) =>
      current
        ? filteredVendors.find((vendor) => vendor.id === current.id) || null
        : null
    )
  }, [filteredVendors, selectedVendor?.id])

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
                color: '#111827'
              },
              onClick: () => focusVendor(vendor)
            },
            {
              label: 'Kelola',
              colors: {
                border: '#16a34a',
                background: '#16a34a',
                color: '#ffffff'
              },
              onClick: () => navigate('/dashboard?tab=products')
            }
          ]
        : [
            {
              label: 'Detail',
              colors: {
                border: '#d1d5db',
                background: '#ffffff',
                color: '#111827'
              },
              onClick: () => focusVendor(vendor)
            },
            {
              label: 'Chat',
              colors: {
                border: '#2563eb',
                background: '#2563eb',
                color: '#ffffff'
              },
              onClick: () => navigate(`/chat/${vendor.id}`)
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
                      color: isFavorite ? '#ffffff' : '#be123c'
                    },
                    onClick: () => {
                      void toggleVendorFavorite(vendor)
                    }
                  }
                ]
              : []),
            {
              label: 'Order',
              colors: {
                border: '#16a34a',
                background: '#16a34a',
                color: '#ffffff'
              },
              onClick: () => navigate(`/vendor/${vendor.id}#order-summary`)
            }
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
      toggleVendorFavorite
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
      myVendorId
    ]),
    focusVendor
  )

  async function toggleMyOnlineStatus() {
    const current = vendors.find((vendor) => vendor.id === myVendorId)
    if (!isVendor || !current) return
    try {
      const online = await operations.setOnline(!current.online)
      if (online !== null)
        toast.push(`Status toko: ${online ? 'Online' : 'Offline'}`, {
          type: 'success'
        })
    } catch (error) {
      toast.push(errorMessage(error, 'Gagal mengubah status toko'), {
        type: 'error'
      })
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
  const promoVendorCount = onlineVendors.filter((vendor) =>
    isVendorPromoActive(vendor)
  ).length
  const selectedVendorDistance = getVendorDistance(selectedVendor, userLocation)
  const selectedVendorIsMine = isVendor && selectedVendor?.id === myVendorId
  const selectedVendorIsFavorite = selectedVendor
    ? favoriteVendorIdSet.has(selectedVendor.id)
    : false
  const selectedVendorPresenceLabel = selectedVendor
    ? formatVendorPresenceAge(selectedVendor, presenceClock)
    : ''
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
  const vendorSummary = selectedVendor ? (
    <VendorSummary
      vendor={selectedVendor}
      isOwner={selectedVendorIsMine}
      distance={formatDistanceLabel(selectedVendorDistance)}
      presence={selectedVendorPresenceLabel}
      favorite={selectedVendorIsFavorite}
      favoriteBusy={favoriteBusyVendorId === selectedVendor.id}
      canFavorite={isCustomerViewer && favoriteFeatureEnabled}
      onFavorite={() => void toggleVendorFavorite(selectedVendor)}
      onVisit={() =>
        navigate(
          selectedVendorIsMine
            ? '/dashboard?tab=products'
            : '/vendor/' + selectedVendor.id
        )
      }
      onChat={() => navigate('/chat/' + selectedVendor.id)}
      onProfile={() => navigate('/dashboard?tab=profile')}
      onClose={wideLayout ? () => setSelectedVendor(null) : undefined}
    />
  ) : null

  return (
    <div className="ui-page space-y-3">
      {vendorQuery.error && (
        <p role="alert" className="text-sm text-amber-800">
          Pembaruan peta tertunda.{' '}
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => void vendorQuery.refetch()}
          >
            Coba lagi
          </button>
        </p>
      )}

      {isVendor && (
        <section
          aria-label="Kontrol pedagang"
          className="ui-surface p-3 sm:p-4"
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">
                Status jualan
              </h2>
              <p className="mt-0.5 flex items-center gap-2 text-sm text-slate-600">
                <span
                  aria-hidden="true"
                  className={
                    'h-2 w-2 rounded-full ' +
                    (myVendorRow?.online ? 'bg-teal-600' : 'bg-slate-400')
                  }
                />
                {myVendorRow?.online ? 'Online' : 'Offline'}
                {myVendorRow?.online && myVendorPresenceTone !== 'fresh' && (
                  <span className="truncate text-xs text-amber-800">
                    {myVendorPresenceLabel}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleMyOnlineStatus}
              disabled={operations.updatingOnline}
              className="ui-primary shrink-0"
            >
              {operations.updatingOnline ? 'Menyimpan...' : toggleLabel}
            </button>
          </div>
          {myVendorRow?.online && myVendorPresenceTone === 'stale' && (
            <p role="status" className="mt-2 text-xs text-amber-800">
              Lokasi belum aktif. Toko belum terlihat di peta pelanggan; coba
              Sinkron Lokasi.
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:flex">
            <button
              type="button"
              onClick={syncStoreLocationNow}
              disabled={syncingStoreLocation}
              className="ui-secondary"
            >
              {syncingStoreLocation ? 'Sinkron...' : 'Sinkron Lokasi'}
            </button>
            <button
              type="button"
              onClick={toggleDemandLayer}
              aria-pressed={showDemandHeatmap}
              title="Area dari pesanan toko Anda, bukan seluruh permintaan pasar"
              className={
                'ui-secondary ' +
                (showDemandHeatmap
                  ? 'border-teal-700 bg-teal-50 text-teal-900'
                  : '')
              }
            >
              {showDemandHeatmap && demandInsights.hotspotCount
                ? 'Area pesanan aktif'
                : 'Area pesanan'}
            </button>
          </div>
          {showDemandHeatmap && (
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="demand-period">
                  Periode area pesanan
                </label>
                <select
                  id="demand-period"
                  value={demandPeriod}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value !== '14' && value !== '30' && value !== 'all')
                      return
                    setDemandPeriod(value)
                    setDemandFocusRequest((current) => current + 1)
                  }}
                  className="min-h-11 max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  <option value="14">14 hari terakhir</option>
                  <option value="30">30 hari terakhir</option>
                  <option value="all">Semua periode</option>
                </select>
                {demandInsights.mappedOrderCount > 0 && (
                  <span className="text-xs text-slate-500">
                    {demandInsights.mappedOrderCount} pesanan ·{' '}
                    {demandInsights.hotspotCount} area
                  </span>
                )}
              </div>
              {demandQuery.isPending ? (
                <p role="status" className="text-xs text-slate-500">
                  Memuat area pesanan...
                </p>
              ) : demandQuery.isError ? (
                <p role="alert" className="text-xs text-amber-800">
                  Area pesanan belum diperbarui.{' '}
                  <button
                    type="button"
                    onClick={() => void demandQuery.refetch()}
                    className="min-h-11 underline"
                  >
                    Coba lagi
                  </button>
                </p>
              ) : !demandInsights.mappedOrderCount ? (
                <p role="status" className="text-xs text-slate-500">
                  {!demandOrders.length
                    ? 'Belum ada pesanan untuk dipetakan.'
                    : !demandInsights.eligibleOrderCount
                      ? 'Tidak ada pesanan ' +
                        demandPeriod +
                        ' hari terakhir. Pilih Semua periode untuk melihat riwayat.'
                      : 'Pesanan pada periode ini belum memiliki lokasi yang dapat dipetakan.'}
                </p>
              ) : null}
              {demandQuery.truncated && (
                <p className="text-xs text-slate-500">
                  Menampilkan {demandOrders.length.toLocaleString('id-ID')}{' '}
                  pesanan terbaru.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4">
        <section
          className="ui-surface min-w-0 overflow-hidden p-2 lg:sticky lg:top-20"
          aria-label="Peta pedagang"
        >
          <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
            <h1 className="text-sm font-semibold text-slate-900 sm:text-base">
              Peta pedagang sekitar
            </h1>
            <SyncStatus
              failed={vendorQuery.isError}
              updatedAt={vendorQuery.dataUpdatedAt}
              connection={vendorQuery.connection}
            />
          </div>
          <LeafletMap
            onReady={readyMap}
            onLocate={() => void requestCurrentLocation()}
            className="ui-map-canvas"
          />
        </section>

        <div className="min-w-0 space-y-3">
          <section aria-label="Pencarian pedagang">
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

          {wideLayout && selectedVendor && (
            <aside className="ui-surface p-4" aria-label="Detail toko pilihan">
              {vendorSummary}
            </aside>
          )}

          <section
            className="ui-surface p-3 sm:p-4"
            aria-label="Daftar pedagang online"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-900">Pedagang online</h2>
              <span className="text-xs text-slate-500">
                {onlineListVendors.length} toko
              </span>
            </div>
            <div className="divide-y divide-slate-100 lg:max-h-[min(48dvh,34rem)] lg:overflow-y-auto">
              {loading ? (
                <p role="status" className="py-6 text-sm text-slate-500">
                  Memuat pedagang...
                </p>
              ) : visibleOnlineListVendors.length === 0 ? (
                <p className="py-6 text-sm leading-6 text-slate-500">
                  {emptyVendorStateMessage}
                </p>
              ) : (
                visibleOnlineListVendors.map((vendor) => (
                  <button
                    key={vendor.id}
                    type="button"
                    onClick={() => focusVendor(vendor)}
                    aria-label={'Lihat toko ' + vendor.name}
                    aria-pressed={selectedVendor?.id === vendor.id}
                    className={
                      'flex w-full min-w-0 items-center gap-3 rounded-xl py-3 text-left transition-colors hover:bg-teal-50 ' +
                      (selectedVendor?.id === vendor.id
                        ? 'bg-teal-50 px-2'
                        : 'px-1')
                    }
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-teal-50 text-lg font-semibold text-teal-800">
                      {vendor.photo_url ? (
                        <img
                          src={vendor.photo_url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        (vendor.name || 'P')[0]
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {vendor.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {[
                          formatVendorCategoryLabel(getVendorCategory(vendor)),
                          formatDistanceLabel(
                            getVendorDistance(vendor, userLocation)
                          )
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {isVendorPromoActive(vendor) && (
                        <span className="mt-0.5 block text-xs font-medium text-amber-800">
                          Promo tersedia
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-slate-400"
                    />
                  </button>
                ))
              )}
            </div>
            {onlineListVendors.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllVendors((current) => !current)}
                className="ui-secondary mt-2 w-full"
              >
                {showAllVendors
                  ? 'Tampilkan lebih sedikit'
                  : 'Lihat ' + (onlineListVendors.length - 6) + ' toko lainnya'}
              </button>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={!!selectedVendor && !wideLayout}
        onClose={() => setSelectedVendor(null)}
        title="Detail toko"
        presentation="sheet"
      >
        {vendorSummary}
      </Modal>
    </div>
  )
}
