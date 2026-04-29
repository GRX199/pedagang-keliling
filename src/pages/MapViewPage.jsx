import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import VendorProductsPreview from '../components/VendorProductsPreview'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import {
  formatFavoriteCountLabel,
  isFavoritesSchemaCompatibilityError,
  isVendorFavorited,
  normalizeFavoriteVendorIds,
} from '../lib/favorites'
import {
  getFriendlyFetchErrorMessage,
  getGeolocationErrorMessage,
  getServerOrigin,
} from '../lib/network'
import { formatReviewScore, getReviewSummary } from '../lib/reviews'
import { supabase } from '../lib/supabase'
import { buildVendorTerritoryInsights } from '../lib/territory'
import {
  createVendorLocationPayload,
  formatVendorCategoryLabel,
  formatVendorPromoExpiry,
  getVendorCoordinates,
  getVendorLocationUpdatedAtLabel,
  getVendorPromoText,
  isVendorPromoActive,
} from '../lib/vendor'

const DEFAULT_CENTER = [-2.5489, 118.0149]
const LOCATION_SYNC_DISTANCE_METERS = 20
const PRECISE_GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 25000,
  maximumAge: 30000,
}
const RELAXED_GEOLOCATION_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 18000,
  maximumAge: 120000,
}
const RATING_FILTER_OPTIONS = [
  { value: 'all', label: 'Semua rating' },
  { value: '4', label: '4.0+' },
  { value: '4.5', label: '4.5+' },
]

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
    return 'Belum aktif. Gunakan tombol lokasi pada peta agar jarak pedagang bisa dihitung otomatis.'
  }

  return 'Lokasi Anda aktif dan sudah dipakai untuk menghitung pedagang terdekat.'
}

function normalizeCategoryValue(value) {
  return String(value || '').trim().toLowerCase()
}

function getVendorCategory(vendor) {
  return String(vendor?.category_primary || vendor?.map_category || '').trim()
}

function getVendorSearchText(vendor) {
  return String(vendor?.map_search_text || '').trim().toLowerCase()
}

function getVendorAverageRating(vendor) {
  const rating = Number(vendor?.review_average)
  return Number.isFinite(rating) ? rating : 0
}

function getVendorReviewCount(vendor) {
  const count = Number(vendor?.review_count)
  return Number.isFinite(count) ? count : 0
}

function formatVendorRatingMeta(vendor) {
  const reviewCount = getVendorReviewCount(vendor)
  if (reviewCount <= 0) return 'Belum ada ulasan'
  return `${formatReviewScore(getVendorAverageRating(vendor))} • ${reviewCount} ulasan`
}

function getBrowserPosition(options) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Browser ini tidak mendukung akses lokasi'))
      return
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  })
}

async function getBrowserPositionWithFallback() {
  try {
    return await getBrowserPosition(PRECISE_GEOLOCATION_OPTIONS)
  } catch (error) {
    if (error?.code === 1) throw error
    return getBrowserPosition(RELAXED_GEOLOCATION_OPTIONS)
  }
}

function matchesRatingFilter(vendor, selectedRatingFilter) {
  if (selectedRatingFilter === 'all') return true

  const minimumRating = Number(selectedRatingFilter)
  if (!Number.isFinite(minimumRating)) return true
  if (getVendorReviewCount(vendor) <= 0) return false

  return getVendorAverageRating(vendor) >= minimumRating
}

function formatVendorPromoTeaser(vendor) {
  const promoText = getVendorPromoText(vendor)
  if (!promoText) return ''
  if (promoText.length <= 96) return promoText
  return `${promoText.slice(0, 93)}...`
}

function isOptionalDataError(error) {
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  return (
    message.includes('does not exist') ||
    message.includes('could not find') ||
    message.includes('schema cache') ||
    details.includes('does not exist')
  )
}

function isVendorModeratedOut(vendor) {
  return vendor?.account_status === 'suspended' || vendor?.account_status === 'blocked'
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

  const vendorCategory = getVendorCategory(vendor)
  if (vendorCategory) {
    const category = document.createElement('div')
    category.style.fontSize = '12px'
    category.style.marginTop = '6px'
    category.style.color = '#475569'
    category.textContent = `Kategori: ${formatVendorCategoryLabel(vendorCategory)}`
    wrapper.appendChild(category)
  }

  const reviewCount = getVendorReviewCount(vendor)
  if (reviewCount > 0) {
    const rating = document.createElement('div')
    rating.style.fontSize = '12px'
    rating.style.marginTop = '6px'
    rating.style.color = '#92400e'
    rating.textContent = `Rating: ${formatVendorRatingMeta(vendor)}`
    wrapper.appendChild(rating)
  }

  if (isVendorPromoActive(vendor)) {
    const promo = document.createElement('div')
    promo.style.fontSize = '12px'
    promo.style.marginTop = '6px'
    promo.style.color = '#b45309'
    promo.textContent = `Promo: ${formatVendorPromoTeaser(vendor)}`
    wrapper.appendChild(promo)

    const promoExpiry = document.createElement('div')
    promoExpiry.style.fontSize = '11px'
    promoExpiry.style.marginTop = '2px'
    promoExpiry.style.color = '#a16207'
    promoExpiry.textContent = `Berlaku sampai ${formatVendorPromoExpiry(vendor)}`
    wrapper.appendChild(promoExpiry)
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
  actionsRow.style.flexWrap = 'wrap'
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
  const location = useLocation()
  const navigate = useNavigate()
  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const clusterRef = useRef(null)
  const heatmapLayerRef = useRef(null)
  const autoLocateAttemptedRef = useRef(false)
  const suppressNextFitBoundsRef = useRef(false)
  const lastSyncedLocationRef = useRef(null)

  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedRatingFilter, setSelectedRatingFilter] = useState('all')
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [userLocation, setUserLocation] = useState(null)
  const [radiusKm, setRadiusKm] = useState(2.5)
  const [onlyWithinRadius, setOnlyWithinRadius] = useState(false)
  const [syncingStoreLocation, setSyncingStoreLocation] = useState(false)
  const [favoriteVendorIds, setFavoriteVendorIds] = useState([])
  const [favoriteFeatureEnabled, setFavoriteFeatureEnabled] = useState(true)
  const [onlyFavoriteVendors, setOnlyFavoriteVendors] = useState(false)
  const [onlyPromoVendors, setOnlyPromoVendors] = useState(false)
  const [favoriteBusyVendorId, setFavoriteBusyVendorId] = useState(null)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [demandOrders, setDemandOrders] = useState([])
  const [showDemandHeatmap, setShowDemandHeatmap] = useState(true)

  const serverOrigin = getServerOrigin()
  const isAdmin = role === 'admin'
  const isVendor = role === 'vendor' || user?.user_metadata?.is_vendor === true
  const isCustomerViewer = Boolean(user?.id) && !isVendor && !isAdmin
  const myVendorId = user?.id
  const clusterEnabled = true
  const favoriteVendorIdSet = useMemo(() => new Set(favoriteVendorIds), [favoriteVendorIds])
  const requestFavoriteView = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('favorites') === '1'
  }, [location.search])

  const applyViewerLocation = useCallback((lat, lng, options = {}) => {
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

    if (options.focus) {
      map.flyTo([lat, lng], options.zoom || 16, {
        animate: true,
        duration: options.duration || 0.6,
      })
    }
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

  const syncStoreLocationNow = useCallback(async () => {
    if (!isVendor || !myVendorId) return
    if (!navigator.geolocation) {
      toast.push('Browser ini tidak mendukung akses lokasi', { type: 'error' })
      return
    }

    try {
      const position = await getBrowserPositionWithFallback()
      const lat = position.coords.latitude
      const lng = position.coords.longitude

      suppressNextFitBoundsRef.current = true
      applyViewerLocation(lat, lng, { focus: true, zoom: 16 })

      await syncMyVendorLocation({
        lat,
        lng,
        accuracy: position.coords.accuracy,
      }, { force: true })
    } catch (error) {
      suppressNextFitBoundsRef.current = false
      toast.push(getGeolocationErrorMessage(error), { type: 'error' })
    }
  }, [applyViewerLocation, isVendor, myVendorId, syncMyVendorLocation, toast])

  async function requestCurrentLocation(options = {}) {
    if (!mapRef.current) return
    if (!navigator.geolocation) {
      toast.push('Browser ini tidak mendukung akses lokasi', { type: 'error' })
      return
    }

    suppressNextFitBoundsRef.current = true
    if (options.clearSelection !== false) {
      setSelectedVendor(null)
    }

    try {
      const position = await getBrowserPositionWithFallback()
      const lat = position.coords.latitude
      const lng = position.coords.longitude

      suppressNextFitBoundsRef.current = true
      applyViewerLocation(lat, lng, {
        focus: true,
        zoom: options.maxZoom || 16,
      })
    } catch (error) {
      suppressNextFitBoundsRef.current = false
      toast.push(getGeolocationErrorMessage(error), { type: 'error' })
    }
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

  useEffect(() => {
    if (!isCustomerViewer || !user?.id) {
      setFavoriteVendorIds([])
      setOnlyFavoriteVendors(false)
      return undefined
    }

    let active = true

    async function loadFavoriteVendors() {
      try {
        const { data, error } = await supabase
          .from('favorites')
          .select('vendor_id')
          .eq('buyer_id', user.id)
          .order('created_at', { ascending: false })

        if (error) throw error
        if (!active) return

        setFavoriteVendorIds(normalizeFavoriteVendorIds(data))
        setFavoriteFeatureEnabled(true)
      } catch (error) {
        console.error('loadFavoriteVendors', error)
        if (!active) return

        if (isFavoritesSchemaCompatibilityError(error)) {
          setFavoriteFeatureEnabled(false)
          setFavoriteVendorIds([])
          setOnlyFavoriteVendors(false)
          return
        }

        toast.push(error.message || 'Gagal memuat pedagang favorit', { type: 'error' })
      }
    }

    void loadFavoriteVendors()

    const channel = supabase
      .channel(`favorites-map-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'favorites', filter: `buyer_id=eq.${user.id}` }, () => {
        void loadFavoriteVendors()
      })
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeFavoritesMapChannel', error)
      }
    }
  }, [isCustomerViewer, toast, user?.id])

  useEffect(() => {
    if (!isCustomerViewer || !favoriteFeatureEnabled) {
      setOnlyFavoriteVendors(false)
      return
    }

    setOnlyFavoriteVendors(requestFavoriteView)
  }, [favoriteFeatureEnabled, isCustomerViewer, requestFavoriteView])

  useEffect(() => {
    if (!isVendor || !myVendorId) {
      setDemandOrders([])
      return undefined
    }

    let active = true

    async function loadDemandOrders() {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, status, order_timing, fulfillment_type, meeting_point_label, meeting_point_location, customer_location, requested_fulfillment_at, total_amount, created_at, updated_at')
          .eq('vendor_id', myVendorId)
          .order('created_at', { ascending: false })
          .limit(200)

        if (error) throw error
        if (active) setDemandOrders(data || [])
      } catch (error) {
        console.error('loadDemandOrders', error)
        if (active && !isOptionalDataError(error)) {
          toast.push(error.message || 'Gagal memuat area permintaan', { type: 'error' })
        }
      }
    }

    void loadDemandOrders()

    const channel = supabase
      .channel(`vendor-demand-map-${myVendorId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `vendor_id=eq.${myVendorId}` }, () => {
        void loadDemandOrders()
      })
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeDemandOrdersChannel', error)
      }
    }
  }, [isVendor, myVendorId, toast])

  const toggleVendorFavorite = useCallback(async (vendor) => {
    const vendorId = vendor?.id
    if (!vendorId || !isCustomerViewer || !user?.id) return

    if (!favoriteFeatureEnabled) {
      toast.push('Fitur favorit belum aktif di database. Jalankan migration favorit terlebih dahulu.', { type: 'info' })
      return
    }

    const nextFavoriteState = !favoriteVendorIdSet.has(vendorId)
    setFavoriteBusyVendorId(vendorId)
    setFavoriteVendorIds((current) => (
      nextFavoriteState
        ? normalizeFavoriteVendorIds([...current.map((currentVendorId) => ({ vendor_id: currentVendorId })), { vendor_id: vendorId }])
        : current.filter((currentVendorId) => currentVendorId !== vendorId)
    ))

    try {
      if (nextFavoriteState) {
        const { error } = await supabase.from('favorites').insert([{ buyer_id: user.id, vendor_id: vendorId }])
        if (error) throw error
        toast.push(`${vendor.name || 'Pedagang'} disimpan ke favorit Anda`, { type: 'success' })
      } else {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('buyer_id', user.id)
          .eq('vendor_id', vendorId)

        if (error) throw error
        toast.push(`${vendor.name || 'Pedagang'} dihapus dari favorit Anda`, { type: 'success' })
      }
    } catch (error) {
      console.error('toggleVendorFavorite', error)
      setFavoriteVendorIds((current) => (
        nextFavoriteState
          ? current.filter((currentVendorId) => currentVendorId !== vendorId)
          : normalizeFavoriteVendorIds([...current.map((currentVendorId) => ({ vendor_id: currentVendorId })), { vendor_id: vendorId }])
      ))

      if (isFavoritesSchemaCompatibilityError(error)) {
        setFavoriteFeatureEnabled(false)
        setOnlyFavoriteVendors(false)
        toast.push('Fitur favorit belum aktif di database. Jalankan migration favorit terlebih dahulu.', { type: 'info' })
        return
      }

      toast.push(error.message || 'Gagal memperbarui pedagang favorit', { type: 'error' })
    } finally {
      setFavoriteBusyVendorId(null)
    }
  }, [favoriteFeatureEnabled, favoriteVendorIdSet, isCustomerViewer, toast, user?.id])

  async function loadVendors() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')

      if (error) throw error

      const vendorRows = data || []
      const vendorIds = vendorRows.map((vendor) => vendor.id).filter(Boolean)

      const productCategoryMap = {}
      const productSearchMap = {}
      if (vendorIds.length > 0) {
        try {
          const { data: productRows, error: productError } = await supabase
            .from('products')
            .select('vendor_id, name, category_name, created_at')
            .in('vendor_id', vendorIds)
            .order('created_at', { ascending: false })

          if (productError) throw productError

          for (const product of productRows || []) {
            const categoryName = String(product?.category_name || '').trim()
            if (categoryName && !productCategoryMap[product.vendor_id]) {
              productCategoryMap[product.vendor_id] = categoryName
            }

            const productName = String(product?.name || '').trim()
            if (!productName) continue
            if (!productSearchMap[product.vendor_id]) {
              productSearchMap[product.vendor_id] = []
            }
            if (!productSearchMap[product.vendor_id].includes(productName)) {
              productSearchMap[product.vendor_id].push(productName)
            }
          }
        } catch (productError) {
          console.warn('loadVendorProductsMeta', productError)
        }
      }

      const profileStatusMap = {}
      if (vendorIds.length > 0) {
        try {
          const { data: profileRows, error: profileError } = await supabase
            .from('profiles')
            .select('id, account_status')
            .in('id', vendorIds)

          if (profileError) throw profileError

          for (const profile of profileRows || []) {
            profileStatusMap[profile.id] = profile.account_status || 'active'
          }
        } catch (profileError) {
          const message = String(profileError?.message || '').toLowerCase()
          if (!message.includes('account_status')) {
            console.warn('loadVendorAccountStatuses', profileError)
          }
        }
      }

      const reviewSummaryMap = {}
      if (vendorIds.length > 0) {
        try {
          const { data: reviewRows, error: reviewError } = await supabase
            .from('reviews')
            .select('vendor_id, rating')
            .in('vendor_id', vendorIds)

          if (reviewError) throw reviewError

          const groupedReviews = {}
          for (const review of reviewRows || []) {
            if (!groupedReviews[review.vendor_id]) {
              groupedReviews[review.vendor_id] = []
            }
            groupedReviews[review.vendor_id].push(review)
          }

          Object.entries(groupedReviews).forEach(([vendorId, grouped]) => {
            reviewSummaryMap[vendorId] = getReviewSummary(grouped)
          })
        } catch (reviewError) {
          if (!isOptionalDataError(reviewError)) {
            console.warn('loadVendorReviews', reviewError)
          }
        }
      }

      setVendors(vendorRows.map((vendor) => ({
        ...vendor,
        map_category: productCategoryMap[vendor.id] || null,
        map_search_text: (productSearchMap[vendor.id] || []).join(' '),
        account_status: profileStatusMap[vendor.id] || 'active',
        review_average: reviewSummaryMap[vendor.id]?.average || 0,
        review_count: reviewSummaryMap[vendor.id]?.count || 0,
      })))
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
      element.textContent = 'Lokasi Saya'
      element.style.background = 'white'
      element.style.padding = '8px'
      element.style.cursor = 'pointer'
      element.style.border = 'none'
      element.style.fontWeight = '700'
      element.title = 'Fokus ke lokasi saya'
      L.DomEvent.disableClickPropagation(element)
      L.DomEvent.on(element, 'click', (event) => {
        L.DomEvent.preventDefault(event)
        void requestCurrentLocation({ clearSelection: true })
      })
      return element
    }
    locateControl.addTo(map)

    map.on('locationfound', (event) => {
      const { lat, lng } = event.latlng
      suppressNextFitBoundsRef.current = true
      applyViewerLocation(lat, lng, { focus: true, zoom: 16 })
    })

    map.on('locationerror', (error) => {
      suppressNextFitBoundsRef.current = false
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => {
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
    void syncStoreLocationNow()
  }, [isVendor, myVendorId, syncStoreLocationNow, toast, vendors])

  const filteredVendors = useMemo(() => {
    return vendors.filter((vendor) => {
      const coordinates = getVendorCoordinates(vendor.location)
      if (!vendor.online || !coordinates || isVendorModeratedOut(vendor)) return false

      const vendorCategory = getVendorCategory(vendor)
      if (selectedCategory !== 'all') {
        if (normalizeCategoryValue(vendorCategory) !== selectedCategory) return false
      }

      if (!matchesRatingFilter(vendor, selectedRatingFilter)) return false
      if (onlyFavoriteVendors && !favoriteVendorIdSet.has(vendor.id)) return false
      if (onlyPromoVendors && !isVendorPromoActive(vendor)) return false

      if (debouncedQuery) {
        const haystack = `${vendor.name || ''} ${vendor.description || ''} ${vendorCategory} ${getVendorSearchText(vendor)} ${getVendorPromoText(vendor)}`.toLowerCase()
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
    selectedCategory,
    selectedRatingFilter,
    userLocation,
    vendors,
  ])

  const onlineVendors = useMemo(
    () => vendors.filter((vendor) => vendor.online && !isVendorModeratedOut(vendor) && getVendorCoordinates(vendor.location)),
    [vendors]
  )

  const categoryOptions = useMemo(() => {
    const categoryMap = new Map()

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

  const demandInsights = useMemo(
    () => buildVendorTerritoryInsights(demandOrders),
    [demandOrders]
  )

  useEffect(() => {
    if (!selectedVendor) return
    if (filteredVendors.some((vendor) => vendor.id === selectedVendor.id)) return
    setSelectedVendor(null)
  }, [filteredVendors, selectedVendor])

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
          ...(isCustomerViewer && favoriteFeatureEnabled ? [{
            label: favoriteBusyVendorId === vendor.id
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
          }] : []),
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

    if (bounds.length > 0 && !suppressNextFitBoundsRef.current) {
      try {
        map.fitBounds(bounds, { padding: [48, 48] })
      } catch (error) {
        console.error('fitBounds', error)
      }
    }
    suppressNextFitBoundsRef.current = false

    return () => {
      try {
        map.removeLayer(group)
      } catch (error) {
        console.error('removeMarkerGroup', error)
      }
      clusterRef.current = null
    }
  }, [
    clusterEnabled,
    favoriteBusyVendorId,
    favoriteFeatureEnabled,
    favoriteVendorIdSet,
    filteredVendors,
    focusVendor,
    isCustomerViewer,
    isVendor,
    myVendorId,
    navigate,
    toggleVendorFavorite,
  ])

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

      const radius = 120 + (hotspot.intensity * 95)
      const fillOpacity = 0.1 + (hotspot.intensity * 0.08)
      const circle = L.circle([hotspot.lat, hotspot.lng], {
        radius,
        color: '#f97316',
        weight: 1,
        opacity: 0.45,
        fillColor: '#f59e0b',
        fillOpacity,
      })

      circle.bindTooltip(
        `${hotspot.label}: ${hotspot.orderCount} permintaan`,
        { direction: 'top', opacity: 0.92 }
      )

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
  }, [demandInsights, isVendor, showDemandHeatmap])

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
  const favoriteVendorCount = favoriteVendorIds.length
  const promoVendorCount = onlineVendors.filter((vendor) => isVendorPromoActive(vendor)).length
  const selectedVendorDistance = getVendorDistance(selectedVendor, userLocation)
  const selectedVendorIsMine = isVendor && selectedVendor?.id === myVendorId
  const selectedVendorIsFavorite = selectedVendor ? favoriteVendorIdSet.has(selectedVendor.id) : false
  const selectedVendorHasPromo = selectedVendor ? isVendorPromoActive(selectedVendor) : false
  const selectedCategoryLabel = categoryOptions.find((option) => option.value === selectedCategory)?.label || 'Semua kategori'
  const selectedRatingFilterLabel = RATING_FILTER_OPTIONS.find((option) => option.value === selectedRatingFilter)?.label || 'Semua rating'
  const emptyVendorStateMessage = onlyFavoriteVendors && onlyPromoVendors
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
  const activeFilterSummary = onlyFavoriteVendors && onlyPromoVendors
    ? 'Difokuskan ke pedagang favorit dengan promo aktif.'
    : onlyFavoriteVendors
      ? `Difokuskan ke ${formatFavoriteCountLabel(favoriteVendorCount)} yang Anda simpan.`
      : onlyPromoVendors
        ? `Menampilkan ${promoVendorCount} toko dengan promo aktif.`
        : selectedCategory !== 'all'
          ? `Difokuskan ke kategori ${formatVendorCategoryLabel(selectedCategoryLabel)}.`
          : selectedRatingFilter !== 'all'
            ? `Menampilkan toko dengan rating ${selectedRatingFilterLabel}.`
            : 'Sesuai pencarian, status toko, dan filter radius yang aktif.'
  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:py-6">
        {isVendor ? (
          <section className="order-1 rounded-[24px] bg-slate-950 p-3 text-white shadow-lg shadow-slate-200/60 ring-1 ring-slate-800 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">Kontrol pedagang</h2>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                    myVendorRow?.online ? 'bg-emerald-400 text-emerald-950' : 'bg-white/10 text-slate-200'
                  }`}>
                    {myVendorRow?.online ? 'Online' : 'Offline'}
                  </span>
                  {demandInsights.hotspotCount > 0 ? (
                    <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-medium text-amber-950">
                      {demandInsights.hotspotCount} area ramai
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-300">
                  {myVendorRow?.online
                    ? `Toko tampil ke pelanggan. Sinkron terakhir ${getVendorLocationUpdatedAtLabel(myVendorLocation)}.`
                    : 'Aktifkan online agar toko dan lokasi Anda muncul di peta pelanggan.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                <button
                  onClick={toggleMyOnlineStatus}
                  className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400"
                >
                  {myVendorRow?.__updating ? 'Menyimpan...' : toggleLabel}
                </button>
                <button
                  onClick={syncStoreLocationNow}
                  className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                >
                  {syncingStoreLocation ? 'Sinkron...' : 'Sinkron Lokasi'}
                </button>
                <button
                  onClick={() => setShowDemandHeatmap((current) => !current)}
                  disabled={!demandInsights.hotspotCount}
                  className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                    showDemandHeatmap && demandInsights.hotspotCount
                      ? 'bg-amber-400 text-amber-950'
                      : 'border border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-50'
                  }`}
                >
                  {showDemandHeatmap && demandInsights.hotspotCount ? 'Heatmap Aktif' : 'Heatmap'}
                </button>
                <button
                  onClick={() => navigate('/dashboard?tab=products')}
                  className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                >
                  Produk
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="order-3 rounded-[24px] bg-white/95 p-3 shadow-sm ring-1 ring-slate-200/80 backdrop-blur sm:p-4 xl:order-3">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <label className="min-w-0">
              <span className="sr-only">Cari pedagang atau produk</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari pedagang atau produk..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
              />
            </label>

            <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
              <button
                onClick={() => setOnlyWithinRadius((current) => !current)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                  onlyWithinRadius
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {onlyWithinRadius ? 'Radius aktif' : 'Radius'}
              </button>
              {isCustomerViewer && (
                <button
                  onClick={() => setOnlyPromoVendors((current) => !current)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                    onlyPromoVendors
                      ? 'bg-amber-500 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {onlyPromoVendors ? 'Promo aktif' : 'Promo'}
                </button>
              )}
              {isCustomerViewer && favoriteFeatureEnabled && (
                <button
                  onClick={() => setOnlyFavoriteVendors((current) => !current)}
                  disabled={favoriteVendorCount === 0 && !onlyFavoriteVendors}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                    onlyFavoriteVendors
                      ? 'bg-rose-500 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300'
                  }`}
                >
                  {onlyFavoriteVendors ? 'Favorit aktif' : 'Favorit'}
                </button>
              )}
              <button
                onClick={() => setShowAdvancedFilters((current) => !current)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                  showAdvancedFilters
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {showAdvancedFilters ? 'Tutup' : 'Filter'}
              </button>
              <button
                onClick={() => {
                  setQuery('')
                  setSelectedCategory('all')
                  setSelectedRatingFilter('all')
                  setOnlyFavoriteVendors(false)
                  setOnlyPromoVendors(false)
                  setOnlyWithinRadius(false)
                  setShowAdvancedFilters(false)
                }}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">{filteredVendorCount} tampil</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">{onlineVendorCount} online</span>
            {userLocation ? (
              <span className="rounded-full bg-sky-50 px-3 py-1 font-medium text-sky-700">{onlineVendorsWithinRadius.length} dalam {radiusKm} km</span>
            ) : null}
            <span className="hidden min-w-0 break-words sm:inline">{activeFilterSummary}</span>
          </div>

          {showAdvancedFilters && (
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-medium text-slate-800">Kategori</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      selectedCategory === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Semua
                  </button>
                  {categoryOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setSelectedCategory(option.value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        selectedCategory === option.value
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {formatVendorCategoryLabel(option.label)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-medium text-slate-800">Rating</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {RATING_FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setSelectedRatingFilter(option.value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        selectedRatingFilter === option.value
                          ? 'bg-amber-500 text-white'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-medium text-slate-800">Radius pencarian</div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={radiusKm}
                    onChange={(event) => setRadiusKm(Number(event.target.value || 0))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
                  />
                  <span className="text-xs text-slate-500">km</span>
                </div>
                <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                  {getViewerLocationStatus(userLocation)}
                </div>
              </label>
            </div>
          )}
        </section>

        <section className="order-4 grid gap-4 xl:order-4 xl:grid-cols-[minmax(0,1.35fr)_380px]">
          <div className="rounded-[30px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Pedagang online sekarang</h2>
                <p className="text-sm leading-6 text-slate-500">
                  Pilih toko, lanjut chat, lalu pesan dari menu yang tersedia.
                </p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {onlineListVendors.length} toko cocok dengan filter
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {onlineListVendors.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  {emptyVendorStateMessage}
                </div>
              ) : (
                onlineListVendors.map((vendor) => {
                  const vendorDistance = getVendorDistance(vendor, userLocation)
                  const active = selectedVendor?.id === vendor.id
                  const isOwnVendor = isVendor && vendor.id === myVendorId
                  const isFavorite = favoriteVendorIdSet.has(vendor.id)
                  const hasPromo = isVendorPromoActive(vendor)

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
                      className={`cursor-pointer rounded-[24px] border p-4 transition ${
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
                            {getVendorCategory(vendor) ? (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                {formatVendorCategoryLabel(getVendorCategory(vendor))}
                              </span>
                            ) : null}
                            {getVendorReviewCount(vendor) > 0 ? (
                              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                {formatVendorRatingMeta(vendor)}
                              </span>
                            ) : null}
                            {hasPromo ? (
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                                Promo Aktif
                              </span>
                            ) : null}
                            {isCustomerViewer && isFavorite ? (
                              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                                Favorit
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">{formatDistanceLabel(vendorDistance)}</div>
                          <div className="mt-2 text-sm leading-6 text-slate-600">
                            {vendor.description ? String(vendor.description).slice(0, 96) : 'Belum ada deskripsi toko.'}
                          </div>
                          {hasPromo ? (
                            <div className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-800">
                              {formatVendorPromoTeaser(vendor)}
                            </div>
                          ) : null}
                          {getVendorReviewCount(vendor) === 0 ? (
                            <div className="mt-2 text-xs text-slate-400">Belum ada ulasan transaksi selesai.</div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
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
                              className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
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
            <div className="hidden rounded-[30px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80 xl:block">
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
                      <div className="mt-1 text-xs text-amber-700">
                        {formatVendorRatingMeta(selectedVendor)}
                      </div>
                      {selectedVendorHasPromo ? (
                        <div className="mt-1 text-xs font-medium text-amber-700">Promo aktif tersedia di toko ini</div>
                      ) : null}
                      {isCustomerViewer && selectedVendorIsFavorite ? (
                        <div className="mt-1 text-xs font-medium text-rose-700">Sudah tersimpan di favorit Anda</div>
                      ) : null}
                    </div>
                  </div>

                  {selectedVendorHasPromo ? (
                    <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Promo Aktif</div>
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
                    <div className="mt-1">{getStoreLocationStatus(selectedVendor.location, { owner: selectedVendorIsMine })}</div>
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

        <section className="order-2 space-y-3 xl:order-2">
          <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/80">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Peta pedagang sekitar</h2>
              </div>
              <div className="text-sm text-slate-500">
                {loading ? 'Memuat pedagang...' : `${filteredVendorCount} toko tampil di peta`}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] bg-white p-2 shadow-lg shadow-slate-200/50 ring-1 ring-slate-200/70">
            <div ref={containerRef} className="h-[52vh] rounded-[24px] sm:h-[60vh] lg:h-[68vh]" />
          </div>

          {selectedVendor ? (
            <div className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 xl:hidden">
              <div className="flex items-start gap-3">
                <div className="h-14 w-14 overflow-hidden rounded-2xl bg-slate-100">
                  {selectedVendor.photo_url ? (
                    <img src={selectedVendor.photo_url} alt={selectedVendor.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-lg font-semibold text-slate-500">
                      {(selectedVendor.name || 'P')[0]}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-slate-900">{selectedVendor.name}</div>
                      <div className="mt-1 text-sm text-slate-500">{formatDistanceLabel(selectedVendorDistance)}</div>
                    </div>
                    <button
                      onClick={() => setSelectedVendor(null)}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50"
                    >
                      Tutup
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      selectedVendor.online ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {selectedVendor.online ? 'Online' : 'Offline'}
                    </span>
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
                    {myVendorRow?.__updating ? 'Menyimpan...' : toggleLabel}
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
