import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import OrderStatusTimeline from '../components/OrderStatusTimeline'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import {
  formatFulfillmentTypeLabel,
  formatOrderStatusLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatPriceLabel,
} from '../lib/orders'
import { fetchDrivingRoute } from '../lib/routing'
import { supabase } from '../lib/supabase'
import { getVendorCoordinates } from '../lib/vendor'

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
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userLocation, setUserLocation] = useState(null)
  const [mapNotice, setMapNotice] = useState('Menyiapkan peta tracking...')
  const [routeData, setRouteData] = useState(null)
  const [routeNotice, setRouteNotice] = useState('')

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

      const [{ data: vendorRow, error: vendorError }, { data: orderItemRows, error: orderItemsError }] = await Promise.all([
        supabase.from('vendors').select('*').eq('id', orderRow.vendor_id).maybeSingle(),
        supabase.from('order_items').select('*').eq('order_id', id).order('created_at', { ascending: true }),
      ])

      if (vendorError) throw vendorError
      if (orderItemsError && !String(orderItemsError.message || '').toLowerCase().includes('does not exist')) {
        throw orderItemsError
      }

      setOrder(orderRow)
      setVendor(vendorRow || null)
      setOrderItems(orderItemRows || [])
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
  }, [loading, order])

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
  const routeReady = Boolean(vendorCoordinates && customerCoordinates)

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:py-6">
        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Tracking Pesanan</div>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">
                Pesanan #{String(order.id).slice(0, 8)}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Pantau status, posisi pedagang, dan detail transaksi dari satu layar.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigate(`/chat/${partnerId}`)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
              >
                Buka Chat
              </button>
              <button
                onClick={() => navigate('/dashboard?tab=orders')}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
              >
                Kembali ke Pesanan
              </button>
            </div>
          </div>

          <div className="mt-4 text-xs text-slate-400">
            {refreshing ? 'Menyegarkan tracking di background...' : 'Tracking aktif dan terus diperbarui di background'}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Status Tracking</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{formatOrderStatusLabel(order.status)}</div>
            <div className="mt-1 text-xs text-slate-500">
              {routeReady
                ? (routeData?.mode === 'road' ? 'Peta dan rute jalan aktif diperbarui di background' : 'Tracking aktif dengan fallback garis lurus')
                : 'Tracking akan lengkap setelah kedua posisi tersedia'}
            </div>
          </div>
          <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Jarak Saat Ini</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{formatDistance(routeDistance)}</div>
            <div className="mt-1 text-xs text-slate-500">{routeReady ? 'Dihitung dari dua titik aktif di peta' : 'Menunggu data lokasi lengkap'}</div>
          </div>
          <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Estimasi Tiba</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{routeEtaLabel}</div>
            <div className="mt-1 text-xs text-slate-500">
              {order.status === 'on_the_way' ? 'Pedagang sedang menuju titik pelanggan' : 'Akan makin akurat saat pedagang bergerak'}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_360px]">
          <div className="space-y-4">
            <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <OrderStatusTimeline status={order.status} />
            </div>

            <div className="overflow-hidden rounded-[28px] bg-white p-2 shadow-sm ring-1 ring-slate-200/80">
              <div className="flex items-center justify-between px-3 pb-2 pt-1 text-xs text-slate-500">
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
                <span>
                  {routeReady
                    ? (routeData?.mode === 'road' ? 'Rute mengikuti jalan yang tersedia saat ini' : 'Menampilkan garis lurus cadangan')
                    : 'Menunggu dua titik lengkap'}
                </span>
              </div>
              <div className="relative">
                <div ref={containerRef} className="tracking-map h-[56vh] min-h-[360px] rounded-[22px]" />
              </div>
              {mapNotice && (
                <div className="px-3 pb-2 pt-3 text-xs text-slate-500">{mapNotice}</div>
              )}
              {routeNotice && (
                <div className="px-3 pb-2 text-xs text-slate-500">{routeNotice}</div>
              )}
            </div>

            <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <h2 className="text-lg font-semibold text-slate-900">Item Pesanan</h2>
              <div className="mt-4 space-y-3">
                {orderItems.length > 0 ? (
                  orderItems.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                      <div className="font-medium text-slate-900">{item.product_name_snapshot}</div>
                      <div className="mt-1 text-sm text-slate-500">Jumlah: {item.quantity}</div>
                      {item.item_note && <div className="mt-1 text-sm text-slate-600">Catatan: {item.item_note}</div>}
                      <div className="mt-2 text-sm font-medium text-slate-700">
                        {formatPriceLabel(item.line_total || item.price_snapshot)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 whitespace-pre-wrap">
                    {order.items || 'Belum ada detail item.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <h2 className="text-lg font-semibold text-slate-900">Ringkasan</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Pedagang</div>
                  <div className="mt-1 font-medium text-slate-900">{order.vendor_name || vendor?.name || 'Pedagang'}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Status</div>
                  <div className="mt-1 font-medium text-slate-900">{formatOrderStatusLabel(order.status)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Pembayaran</div>
                  <div className="mt-1 font-medium text-slate-900">
                    {formatPaymentMethodLabel(order.payment_method)} • {formatPaymentStatusLabel(order.payment_status)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Serah terima</div>
                  <div className="mt-1 font-medium text-slate-900">{formatFulfillmentTypeLabel(order.fulfillment_type)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Titik temu</div>
                  <div className="mt-1 font-medium text-slate-900">{order.meeting_point_label || 'Belum diisi'}</div>
                </div>
                {order.customer_note && (
                  <div>
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Catatan</div>
                    <div className="mt-1 text-slate-700">{order.customer_note}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Total</div>
                  <div className="mt-1 font-medium text-slate-900">
                    {Number(order.total_amount || 0) > 0 ? formatPriceLabel(order.total_amount) : 'Menyesuaikan harga produk'}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <h2 className="text-lg font-semibold text-slate-900">Status Rute</h2>
              <div className="mt-4 space-y-2 text-sm text-slate-600">
                <div>Jarak rute: {formatDistance(routeDistance)}</div>
                <div>ETA: {routeEtaLabel}</div>
                <div>Status online pedagang: {vendor?.online ? 'Online' : 'Offline'}</div>
                <div>
                  {routeReady
                    ? (routeData?.mode === 'road'
                      ? 'Rute mengikuti jalan yang tersedia dari layanan routing.'
                      : 'Rute jalan belum tersedia, jadi sementara memakai garis lurus.')
                    : 'Tracking akan lebih akurat setelah data lokasi lengkap.'}
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}
