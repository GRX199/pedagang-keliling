import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import OrderReviewComposer from '../components/OrderReviewComposer'
import OrderStatusTimeline from '../components/OrderStatusTimeline'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import {
  formatFulfillmentTypeLabel,
  formatOrderTimingLabel,
  getBuyerPaymentActions,
  getPaymentGuidance,
  formatOrderStatusLabel,
  isSchemaCompatibilityError,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatPriceLabel,
  formatRequestedFulfillmentLabel,
  getOrderOperationalNotice,
  getVendorPaymentActions,
} from '../lib/orders'
import { canBuyerReviewOrder } from '../lib/reviews'
import { fetchDrivingRoute } from '../lib/routing'
import { supabase } from '../lib/supabase'
import { getVendorCoordinates, getVendorPaymentMethodDetails } from '../lib/vendor'

const DEFAULT_CENTER = [-2.5489, 118.0149]
const MAP_TILE_SOURCES = [
  {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
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

function formatDistance(distanceMeters) {
  if (typeof distanceMeters !== 'number') return 'Menunggu titik lokasi lengkap'
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`
  return `${(distanceMeters / 1000).toFixed(1)} km`
}

function estimateEtaMinutes(distanceMeters, status) {
  if (typeof distanceMeters !== 'number') return null

  let speedKmh = 12
  if (status === 'on_the_way') speedKmh = 18
  if (status === 'arrived') speedKmh = 4

  return Math.max(1, Math.round(distanceMeters / ((speedKmh * 1000) / 60)))
}

function formatEta(distanceMeters, status) {
  const minutes = estimateEtaMinutes(distanceMeters, status)
  if (minutes === null) return 'ETA menunggu dua titik lokasi'
  if (minutes < 60) return `${minutes} menit`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours} jam ${remainingMinutes} menit` : `${hours} jam`
}

function formatDurationFromSeconds(durationSeconds) {
  if (typeof durationSeconds !== 'number') return null

  const minutes = Math.max(1, Math.round(durationSeconds / 60))
  if (minutes < 60) return `${minutes} menit`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours} jam ${remainingMinutes} menit` : `${hours} jam`
}

function describeVendorPoint(hasLiveLocation, hasFallbackLocation) {
  if (hasLiveLocation) return 'Lokasi pedagang aktif tersedia'
  if (hasFallbackLocation) return 'Memakai lokasi terakhir pedagang'
  return 'Lokasi pedagang belum tersedia'
}

function describeCustomerPoint(hasCurrentViewerLocation, hasSavedLocation, meetingPointLabel) {
  if (hasCurrentViewerLocation) return 'Lokasi Anda saat ini'
  if (meetingPointLabel) return `Titik temu: ${meetingPointLabel}`
  if (hasSavedLocation) return 'Titik pelanggan tersimpan'
  return 'Titik pelanggan belum tersedia'
}

export default function OrderTrackingPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const [order, setOrder] = useState(null)
  const [vendor, setVendor] = useState(null)
  const [orderItems, setOrderItems] = useState([])
  const [review, setReview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userLocation, setUserLocation] = useState(null)
  const [mapNotice, setMapNotice] = useState('Menyiapkan peta tracking...')
  const [routeData, setRouteData] = useState(null)
  const [routeNotice, setRouteNotice] = useState('')
  const [showOrderItems, setShowOrderItems] = useState(false)
  const [showPaymentDetail, setShowPaymentDetail] = useState(false)

  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const vendorMarkerRef = useRef(null)
  const customerMarkerRef = useRef(null)
  const routeLineRef = useRef(null)
  const tileLayerRef = useRef(null)
  const lastRouteKeyRef = useRef('')
  const routeAbortRef = useRef(null)

  async function loadOrder({ background = false, silent = false } = {}) {
    if (!id) return

    if (background) setRefreshing(true)
    else setLoading(true)

    try {
      const { data: orderRow, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) throw error
      if (!orderRow) throw new Error('Pesanan tidak ditemukan')

      const [{ data: vendorRow, error: vendorError }, { data: orderItemRows, error: orderItemsError }, { data: reviewRow, error: reviewError }] = await Promise.all([
        supabase.from('vendors').select('*').eq('id', orderRow.vendor_id).maybeSingle(),
        supabase.from('order_items').select('*').eq('order_id', id).order('created_at', { ascending: true }),
        supabase.from('reviews').select('*').eq('order_id', id).maybeSingle(),
      ])

      if (vendorError) throw vendorError
      if (orderItemsError && !String(orderItemsError.message || '').toLowerCase().includes('does not exist')) {
        throw orderItemsError
      }
      if (reviewError && !isSchemaCompatibilityError(reviewError)) {
        throw reviewError
      }

      setOrder(orderRow)
      setVendor(vendorRow || null)
      setOrderItems(orderItemRows || [])
      setReview(reviewRow || null)
    } catch (error) {
      console.error('loadOrderTracking', error)
      if (!silent) {
        toast.push(error.message || 'Gagal memuat tracking pesanan', { type: 'error' })
      }
    } finally {
      if (background) setRefreshing(false)
      else setLoading(false)
    }
  }

  async function updatePaymentStatus(paymentStatus) {
    if (!order?.id) return

    try {
      const { error } = await supabase
        .from('orders')
        .update({ payment_status: paymentStatus })
        .eq('id', order.id)

      if (error) throw error
      toast.push('Status pembayaran diperbarui', { type: 'success' })
      void loadOrder({ background: true, silent: true })
    } catch (error) {
      console.error('updateTrackingPaymentStatus', error)
      toast.push(error.message || 'Gagal memperbarui status pembayaran', { type: 'error' })
    }
  }

  useEffect(() => {
    void loadOrder()

    const orderChannel = supabase
      .channel(`tracking-order-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, () => {
        void loadOrder({ background: true, silent: true })
      })
      .subscribe()

    const intervalId = window.setInterval(() => {
      void loadOrder({ background: true, silent: true })
    }, 10000)

    return () => {
      window.clearInterval(intervalId)
      try {
        supabase.removeChannel(orderChannel)
      } catch (error) {
        console.error('removeTrackingOrderChannel', error)
      }
    }
  }, [id])

  useEffect(() => {
    if (!order?.vendor_id) return undefined

    const vendorChannel = supabase
      .channel(`tracking-vendor-${order.vendor_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors', filter: `id=eq.${order.vendor_id}` }, () => {
        void loadOrder({ background: true, silent: true })
      })
      .subscribe()

    return () => {
      try {
        supabase.removeChannel(vendorChannel)
      } catch (error) {
        console.error('removeTrackingVendorChannel', error)
      }
    }
  }, [order?.vendor_id])

  useEffect(() => {
    if (loading || !order || !containerRef.current || mapRef.current) return undefined

    if (mapRef.current) {
      try {
        mapRef.current.remove()
      } catch (error) {
        console.error('removeExistingTrackingMap', error)
      }
    }

    const map = L.map(containerRef.current).setView(DEFAULT_CENTER, 5)
    mapRef.current = map

    let activeTileIndex = 0
    let tileErrorCount = 0

    function attachTileLayer(index) {
      const source = MAP_TILE_SOURCES[index]
      const layer = L.tileLayer(source.url, {
        maxZoom: 19,
        attribution: source.attribution,
      })

      layer.on('load', () => {
        setMapNotice('')
      })

      layer.on('tileerror', () => {
        tileErrorCount += 1

        if (tileErrorCount >= 3 && activeTileIndex < MAP_TILE_SOURCES.length - 1) {
          activeTileIndex += 1
          tileErrorCount = 0

          try {
            if (tileLayerRef.current) {
              map.removeLayer(tileLayerRef.current)
            }
          } catch (error) {
            console.error('removeBrokenTileLayer', error)
          }

          tileLayerRef.current = attachTileLayer(activeTileIndex)
          setMapNotice('Sumber peta utama gagal dimuat, sedang memakai peta cadangan.')
        } else if (activeTileIndex === MAP_TILE_SOURCES.length - 1) {
          setMapNotice('Peta belum berhasil dimuat. Coba buka ulang halaman ini.')
        }
      })

      layer.addTo(map)
      return layer
    }

    tileLayerRef.current = attachTileLayer(activeTileIndex)

    const invalidate = () => {
      try {
        map.invalidateSize()
      } catch (error) {
        console.error('invalidateTrackingMap', error)
      }
    }

    map.whenReady(() => {
      setMapNotice('')
      invalidate()
    })

    const frameId = window.requestAnimationFrame(invalidate)
    const timeoutId = window.setTimeout(invalidate, 300)
    const timeoutIdLate = window.setTimeout(invalidate, 1200)
    const timeoutIdLatest = window.setTimeout(invalidate, 2500)
    window.addEventListener('resize', invalidate)
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => invalidate())
      : null

    if (resizeObserver) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
      window.clearTimeout(timeoutIdLate)
      window.clearTimeout(timeoutIdLatest)
      window.removeEventListener('resize', invalidate)
      resizeObserver?.disconnect()

      try {
        map.remove()
      } catch (error) {
        console.error('removeTrackingMap', error)
      }
      mapRef.current = null
      tileLayerRef.current = null
      setMapNotice('Menyiapkan peta tracking...')
    }
  }, [loading])

  useEffect(() => {
    if (!navigator.geolocation) return undefined

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
      },
      (error) => {
        console.warn('trackUserLocation', error)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 12000,
      }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  const vendorCoordinates = useMemo(() => {
    return getVendorCoordinates(vendor?.location) || getVendorCoordinates(order?.vendor_location_snapshot)
  }, [order?.vendor_location_snapshot, vendor?.location])

  const vendorHasLiveLocation = Boolean(getVendorCoordinates(vendor?.location))
  const vendorHasFallbackLocation = Boolean(!vendorHasLiveLocation && getVendorCoordinates(order?.vendor_location_snapshot))

  const savedCustomerCoordinates = useMemo(() => {
    return getVendorCoordinates(order?.meeting_point_location) || getVendorCoordinates(order?.customer_location)
  }, [order?.customer_location, order?.meeting_point_location])

  const customerCoordinates = useMemo(() => {
    if (savedCustomerCoordinates) return savedCustomerCoordinates
    if (order?.buyer_id === user?.id && userLocation) return userLocation
    return null
  }, [order?.buyer_id, savedCustomerCoordinates, user?.id, userLocation])

  const customerLocationLabel = useMemo(() => {
    return describeCustomerPoint(
      order?.buyer_id === user?.id && Boolean(userLocation),
      Boolean(savedCustomerCoordinates),
      order?.meeting_point_label
    )
  }, [order?.buyer_id, order?.meeting_point_label, savedCustomerCoordinates, user?.id, userLocation])

  const vendorLocationLabel = useMemo(() => {
    return describeVendorPoint(vendorHasLiveLocation, vendorHasFallbackLocation)
  }, [vendorHasFallbackLocation, vendorHasLiveLocation])

  useEffect(() => {
    if (!vendorCoordinates || !customerCoordinates) {
      routeAbortRef.current?.abort()
      routeAbortRef.current = null
      lastRouteKeyRef.current = ''
      setRouteData(null)
      setRouteNotice('')
      return undefined
    }

    const routeKey = [
      vendorCoordinates.lat.toFixed(4),
      vendorCoordinates.lng.toFixed(4),
      customerCoordinates.lat.toFixed(4),
      customerCoordinates.lng.toFixed(4),
    ].join('|')

    if (lastRouteKeyRef.current === routeKey) {
      return undefined
    }

    lastRouteKeyRef.current = routeKey
    routeAbortRef.current?.abort()

    const abortController = new AbortController()
    routeAbortRef.current = abortController
    setRouteNotice('Menghitung rute jalan...')

    async function loadDrivingRoute() {
      try {
        const nextRoute = await fetchDrivingRoute({
          from: vendorCoordinates,
          to: customerCoordinates,
          signal: abortController.signal,
        })

        if (abortController.signal.aborted) return

        setRouteData({
          ...nextRoute,
          mode: 'road',
        })
        setRouteNotice('')
      } catch (error) {
        if (abortController.signal.aborted) return

        console.error('loadDrivingRoute', error)

        setRouteData({
          distanceMeters: haversineDistance(
            vendorCoordinates.lat,
            vendorCoordinates.lng,
            customerCoordinates.lat,
            customerCoordinates.lng
          ),
          durationSeconds: null,
          latLngs: [
            [vendorCoordinates.lat, vendorCoordinates.lng],
            [customerCoordinates.lat, customerCoordinates.lng],
          ],
          mode: 'fallback',
          provider: null,
        })
        setRouteNotice('Rute jalan belum tersedia, jadi sementara memakai garis lurus cadangan.')
      }
    }

    void loadDrivingRoute()

    return () => {
      abortController.abort()
    }
  }, [customerCoordinates, vendorCoordinates])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    window.requestAnimationFrame(() => {
      try {
        map.invalidateSize()
      } catch (error) {
        console.error('resizeTrackingMap', error)
      }
    })

    const points = []
    const routeLatLngs = routeData?.latLngs || (
      vendorCoordinates && customerCoordinates
        ? [
          [vendorCoordinates.lat, vendorCoordinates.lng],
          [customerCoordinates.lat, customerCoordinates.lng],
        ]
        : null
    )

    if (vendorCoordinates) {
      const latLng = [vendorCoordinates.lat, vendorCoordinates.lng]
      if (!vendorMarkerRef.current) {
        vendorMarkerRef.current = L.marker(latLng).addTo(map)
      } else {
        vendorMarkerRef.current.setLatLng(latLng)
      }
      vendorMarkerRef.current.bindPopup(`<strong>${vendor?.name || 'Pedagang'}</strong><br/>${vendorLocationLabel}`)
      points.push(latLng)
    } else if (vendorMarkerRef.current) {
      map.removeLayer(vendorMarkerRef.current)
      vendorMarkerRef.current = null
    }

    if (customerCoordinates) {
      const latLng = [customerCoordinates.lat, customerCoordinates.lng]
      if (!customerMarkerRef.current) {
        customerMarkerRef.current = L.circleMarker(latLng, {
          radius: 8,
          color: '#0ea5e9',
          fillColor: '#0ea5e9',
          fillOpacity: 0.95,
          weight: 2,
        }).addTo(map)
      } else {
        customerMarkerRef.current.setLatLng(latLng)
      }
      customerMarkerRef.current.bindPopup(`<strong>Pelanggan</strong><br/>${customerLocationLabel}`)
      points.push(latLng)
    } else if (customerMarkerRef.current) {
      map.removeLayer(customerMarkerRef.current)
      customerMarkerRef.current = null
    }

    if (routeLatLngs && routeLatLngs.length > 1) {
      if (!routeLineRef.current) {
        routeLineRef.current = L.polyline(routeLatLngs, {
          color: '#0f766e',
          weight: 4,
          opacity: 0.9,
          dashArray: routeData?.mode === 'road' ? null : '10 10',
        }).addTo(map)
      } else {
        routeLineRef.current.setLatLngs(routeLatLngs)
        routeLineRef.current.setStyle({
          dashArray: routeData?.mode === 'road' ? null : '10 10',
        })
      }
    } else if (routeLineRef.current) {
      map.removeLayer(routeLineRef.current)
      routeLineRef.current = null
    }

    if (routeLatLngs && routeLatLngs.length > 1) {
      map.fitBounds(routeLatLngs, { padding: [56, 56], maxZoom: 16 })
    } else if (points.length > 1) {
      map.fitBounds(points, { padding: [56, 56], maxZoom: 16 })
    } else if (points.length === 1) {
      map.setView(points[0], 15)
    } else {
      map.setView(DEFAULT_CENTER, 5)
    }
  }, [customerCoordinates, customerLocationLabel, routeData, vendorCoordinates, vendorLocationLabel, vendor?.name])

  const routeDistance = useMemo(() => {
    if (typeof routeData?.distanceMeters === 'number') return routeData.distanceMeters
    if (!vendorCoordinates || !customerCoordinates) return null
    return haversineDistance(vendorCoordinates.lat, vendorCoordinates.lng, customerCoordinates.lat, customerCoordinates.lng)
  }, [customerCoordinates, routeData?.distanceMeters, vendorCoordinates])

  const routeEtaLabel = useMemo(() => {
    const routedDuration = formatDurationFromSeconds(routeData?.durationSeconds)
    if (routedDuration) return routedDuration
    return formatEta(routeDistance, order?.status)
  }, [order?.status, routeData?.durationSeconds, routeDistance])

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Memuat tracking pesanan...</div>
  }

  if (!order) {
    return <div className="p-6 text-sm text-slate-500">Pesanan tidak ditemukan.</div>
  }

  const partnerId = order.buyer_id === user?.id ? order.vendor_id : order.buyer_id
  const isVendorViewer = user?.id === order.vendor_id
  const paymentGuidance = getPaymentGuidance(order, isVendorViewer ? 'vendor' : 'customer')
  const paymentActions = isVendorViewer ? getVendorPaymentActions(order) : getBuyerPaymentActions(order)
  const operationalNotice = getOrderOperationalNotice(order, isVendorViewer ? 'vendor' : 'customer')
  const paymentReferenceDetails = getVendorPaymentMethodDetails(vendor?.payment_details, order.payment_method)
  const canShowReviewComposer = canBuyerReviewOrder(order, user?.id)
  const routeReady = Boolean(vendorCoordinates && customerCoordinates)
  const isPreorder = order.order_timing === 'preorder'
  const visibleOrderItems = showOrderItems ? orderItems : orderItems.slice(0, 2)

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl space-y-4 overflow-x-hidden px-3 py-5 sm:px-4 sm:py-6">
        <section className="min-w-0 rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 sm:text-xs sm:tracking-[0.22em]">Tracking Pesanan</div>
              <h1 className="mt-1 text-xl font-semibold text-slate-900 sm:mt-2 sm:text-2xl">
                Pesanan #{String(order.id).slice(0, 8)}
              </h1>
              <p className="mt-2 hidden text-sm leading-6 text-slate-500 sm:block">
                Pantau status, peta, dan transaksi dari satu layar.
              </p>
            </div>

            <div className="flex w-full gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible">
              {paymentActions.map((action) => (
                <button
                  key={action.value}
                  onClick={() => updatePaymentStatus(action.value)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium leading-tight ${
                    action.tone === 'danger'
                      ? 'border border-red-200 bg-red-50 text-red-600'
                      : action.tone === 'success'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-900 text-white'
                  }`}
                >
                  {action.label}
                </button>
              ))}
              <button
                onClick={() => navigate(`/chat/${partnerId}?order=${order.id}`)}
                className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 px-4 py-2.5 text-sm font-medium leading-tight text-slate-700"
              >
                Chat
              </button>
              <button
                onClick={() => navigate('/dashboard?tab=orders')}
                className="shrink-0 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2.5 text-sm font-medium leading-tight text-white"
              >
                Pesanan
              </button>
            </div>
          </div>

          <div className="mt-2 text-xs text-slate-400 sm:mt-3">
            {refreshing ? 'Tracking diperbarui di background...' : 'Tracking aktif dan diperbarui di background'}
          </div>
        </section>

        <section className="grid min-w-0 grid-cols-3 gap-2 sm:gap-4">
          <div className="min-w-0 rounded-[18px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[24px] sm:p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.16em]">Status</div>
            <div className="mt-2 break-words text-base font-semibold leading-tight text-slate-900 sm:text-lg">{formatOrderStatusLabel(order.status)}</div>
            <div className="mt-1 hidden text-xs text-slate-500 sm:block">
              {routeReady
                ? (routeData?.mode === 'road' ? 'Peta dan rute jalan aktif diperbarui di background' : 'Tracking aktif dengan fallback garis lurus')
                : 'Tracking akan lengkap setelah kedua posisi tersedia'}
            </div>
          </div>
          <div className="min-w-0 rounded-[18px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[24px] sm:p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.16em]">Jarak</div>
            <div className="mt-2 break-words text-base font-semibold leading-tight text-slate-900 sm:text-lg">{formatDistance(routeDistance)}</div>
            <div className="mt-1 hidden text-xs text-slate-500 sm:block">{routeReady ? 'Dihitung dari dua titik aktif di peta' : 'Menunggu data lokasi lengkap'}</div>
          </div>
          <div className="min-w-0 rounded-[18px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[24px] sm:p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.16em]">ETA</div>
            <div className="mt-2 break-words text-base font-semibold leading-tight text-slate-900 sm:text-lg">{routeEtaLabel}</div>
            <div className="mt-1 hidden text-xs text-slate-500 sm:block">
              {order.status === 'on_the_way' ? 'Pedagang sedang menuju titik pelanggan' : 'Akan makin akurat saat pedagang bergerak'}
            </div>
          </div>
        </section>

        <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_360px]">
          <div className="min-w-0 space-y-4">
            <div className="overflow-hidden rounded-[22px] bg-white p-2 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px]">
              <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-1 text-xs text-slate-500">
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-emerald-500" />
                    Pedagang
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-sky-500" />
                    Pelanggan
                  </span>
                </div>
                <span className="hidden text-right sm:inline">
                  {routeReady
                    ? (routeData?.mode === 'road' ? 'Rute mengikuti jalan yang tersedia saat ini' : 'Menampilkan garis lurus cadangan')
                    : 'Menunggu dua titik lengkap'}
                </span>
              </div>
              <div className="relative">
                <div ref={containerRef} className="tracking-map h-[48vh] min-h-[300px] rounded-[18px] sm:h-[56vh] sm:min-h-[360px] sm:rounded-[22px]" />
              </div>
              {mapNotice && (
                <div className="px-3 pb-2 pt-3 text-xs text-slate-500">{mapNotice}</div>
              )}
              {routeNotice && (
                <div className="px-3 pb-2 text-xs text-slate-500">{routeNotice}</div>
              )}
            </div>

            <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
              <OrderStatusTimeline status={order.status} />
            </div>

            <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
              <h2 className="text-lg font-semibold text-slate-900">Item Pesanan</h2>
              <div className="mt-4 space-y-3">
                {orderItems.length > 0 ? (
                  visibleOrderItems.map((item) => (
                    <div key={item.id} className="min-w-0 rounded-2xl bg-slate-50 p-4">
                      <div className="break-words font-medium text-slate-900">{item.product_name_snapshot}</div>
                      <div className="mt-1 text-sm text-slate-500">Jumlah: {item.quantity}</div>
                      {item.item_note && <div className="mt-1 break-words text-sm text-slate-600">Catatan: {item.item_note}</div>}
                      <div className="mt-2 text-sm font-medium text-slate-700">
                        {formatPriceLabel(item.line_total || item.price_snapshot)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                    {order.items || 'Belum ada detail item.'}
                  </div>
                )}
              </div>
              {orderItems.length > 2 && (
                <button
                  type="button"
                  onClick={() => setShowOrderItems((current) => !current)}
                  className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {showOrderItems ? 'Tampilkan lebih sedikit' : `Lihat ${orderItems.length - 2} item lainnya`}
                </button>
              )}
            </div>

            {(canShowReviewComposer || review) && (
              <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
                <OrderReviewComposer
                  order={order}
                  existingReview={review}
                  viewerId={user?.id}
                  buyerName={user?.user_metadata?.full_name || user?.email || 'Pelanggan'}
                  compact
                  onSaved={setReview}
                />
              </div>
            )}
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
              <h2 className="text-lg font-semibold text-slate-900">Ringkasan</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Pedagang</div>
                  <div className="mt-1 break-words font-medium text-slate-900">{order.vendor_name || vendor?.name || 'Pedagang'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Status</div>
                  <div className="mt-1 break-words font-medium text-slate-900">{formatOrderStatusLabel(order.status)}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Pembayaran</div>
                  <div className="mt-1 break-words font-medium text-slate-900">
                    {formatPaymentMethodLabel(order.payment_method)} • {formatPaymentStatusLabel(order.payment_status)}
                  </div>
                  {paymentGuidance && (
                    <div className="mt-2 break-words text-sm leading-6 text-slate-500">{paymentGuidance}</div>
                  )}
                  {operationalNotice && (
                    <div className="mt-3 break-words rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {operationalNotice}
                    </div>
                  )}
                  {order.payment_method !== 'cod' && (
                    <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Detail bayar</div>
                        <button
                          type="button"
                          onClick={() => setShowPaymentDetail((current) => !current)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 sm:hidden"
                        >
                          {showPaymentDetail ? 'Tutup' : 'Buka'}
                        </button>
                      </div>
                      {paymentReferenceDetails.ready ? (
                        <div className={`${showPaymentDetail ? 'mt-2 block' : 'hidden'} space-y-3 sm:mt-2 sm:block`}>
                          <div className="break-words text-sm text-slate-600">{paymentReferenceDetails.description}</div>
                          {paymentReferenceDetails.imageUrl && (
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
                              <img
                                src={paymentReferenceDetails.imageUrl}
                                alt={paymentReferenceDetails.title}
                                className="h-44 w-full rounded-xl object-contain sm:h-56"
                              />
                            </div>
                          )}
                          {paymentReferenceDetails.rows.map((row) => (
                            <div key={row.label}>
                              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">{row.label}</div>
                              <div className="mt-1 break-words font-medium text-slate-900">{row.value}</div>
                            </div>
                          ))}
                          {paymentReferenceDetails.note && (
                            <div className="break-words rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                              Catatan pedagang: {paymentReferenceDetails.note}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 break-words text-sm text-slate-500">
                          Pedagang belum menyiapkan detail pembayaran untuk metode ini. Lanjutkan koordinasi lewat chat.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Serah terima</div>
                  <div className="mt-1 break-words font-medium text-slate-900">{formatFulfillmentTypeLabel(order.fulfillment_type)}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Mode pesanan</div>
                  <div className="mt-1 break-words font-medium text-slate-900">{formatOrderTimingLabel(order.order_timing)}</div>
                </div>
                {order.requested_fulfillment_at && (
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Jadwal</div>
                    <div className="mt-1 break-words font-medium text-slate-900">
                      {formatRequestedFulfillmentLabel(order.requested_fulfillment_at)}
                    </div>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    {isPreorder ? 'Area titip' : 'Titik temu'}
                  </div>
                  <div className="mt-1 break-words font-medium text-slate-900">{order.meeting_point_label || 'Belum diisi'}</div>
                </div>
                {order.customer_note && (
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Catatan</div>
                    <div className="mt-1 break-words text-slate-700">{order.customer_note}</div>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Total</div>
                  <div className="mt-1 break-words font-medium text-slate-900">
                    {Number(order.total_amount || 0) > 0 ? formatPriceLabel(order.total_amount) : 'Menyesuaikan harga produk'}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}
