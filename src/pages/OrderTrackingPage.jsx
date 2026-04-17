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
import { supabase } from '../lib/supabase'
import { getVendorCoordinates, getVendorLocationLabel } from '../lib/vendor'

const DEFAULT_CENTER = [-2.5489, 118.0149]

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

function createRouteIcon(label, accentClass, haloClass) {
  return L.divIcon({
    className: '',
    html: `
      <div class="flex items-center gap-2">
        <span class="inline-flex h-4 w-4 rounded-full ${accentClass} ring-4 ${haloClass}"></span>
        <span class="rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">${label}</span>
      </div>
    `,
    iconAnchor: [10, 10],
  })
}

const vendorIcon = createRouteIcon('Pedagang', 'bg-emerald-500', 'ring-emerald-100')
const customerIcon = createRouteIcon('Pelanggan', 'bg-sky-500', 'ring-sky-100')

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

  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const vendorMarkerRef = useRef(null)
  const customerMarkerRef = useRef(null)
  const routeLineRef = useRef(null)

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
    if (!containerRef.current) return undefined

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView(DEFAULT_CENTER, 5)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    const invalidate = () => {
      try {
        map.invalidateSize()
      } catch (error) {
        console.error('invalidateTrackingMap', error)
      }
    }

    const frameId = window.requestAnimationFrame(invalidate)
    const timeoutId = window.setTimeout(invalidate, 300)
    window.addEventListener('resize', invalidate)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
      window.removeEventListener('resize', invalidate)

      try {
        map.remove()
      } catch (error) {
        console.error('removeTrackingMap', error)
      }
      mapRef.current = null
    }
  }, [])

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

  const savedCustomerCoordinates = useMemo(() => {
    return getVendorCoordinates(order?.meeting_point_location) || getVendorCoordinates(order?.customer_location)
  }, [order?.customer_location, order?.meeting_point_location])

  const customerCoordinates = useMemo(() => {
    if (order?.buyer_id === user?.id && userLocation) return userLocation
    return savedCustomerCoordinates
  }, [order?.buyer_id, savedCustomerCoordinates, user?.id, userLocation])

  const customerLocationLabel = useMemo(() => {
    if (order?.buyer_id === user?.id && userLocation) return 'Lokasi Anda saat ini'
    if (order?.meeting_point_label) return order.meeting_point_label
    if (savedCustomerCoordinates) return getVendorLocationLabel(order?.meeting_point_location || order?.customer_location)
    return 'Titik pelanggan belum tersedia'
  }, [order?.buyer_id, order?.customer_location, order?.meeting_point_label, order?.meeting_point_location, savedCustomerCoordinates, user?.id, userLocation])

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

    if (vendorCoordinates) {
      const latLng = [vendorCoordinates.lat, vendorCoordinates.lng]
      if (!vendorMarkerRef.current) {
        vendorMarkerRef.current = L.marker(latLng, { icon: vendorIcon }).addTo(map)
      } else {
        vendorMarkerRef.current.setLatLng(latLng)
      }
      vendorMarkerRef.current.bindPopup(`<strong>${vendor?.name || 'Pedagang'}</strong><br/>${formatOrderStatusLabel(order?.status)}`)
      points.push(latLng)
    } else if (vendorMarkerRef.current) {
      map.removeLayer(vendorMarkerRef.current)
      vendorMarkerRef.current = null
    }

    if (customerCoordinates) {
      const latLng = [customerCoordinates.lat, customerCoordinates.lng]
      if (!customerMarkerRef.current) {
        customerMarkerRef.current = L.marker(latLng, { icon: customerIcon }).addTo(map)
      } else {
        customerMarkerRef.current.setLatLng(latLng)
      }
      customerMarkerRef.current.bindPopup(`<strong>Pelanggan</strong><br/>${customerLocationLabel}`)
      points.push(latLng)
    } else if (customerMarkerRef.current) {
      map.removeLayer(customerMarkerRef.current)
      customerMarkerRef.current = null
    }

    if (vendorCoordinates && customerCoordinates) {
      const nextRoute = [
        [vendorCoordinates.lat, vendorCoordinates.lng],
        [customerCoordinates.lat, customerCoordinates.lng],
      ]

      if (!routeLineRef.current) {
        routeLineRef.current = L.polyline(nextRoute, {
          color: '#0f766e',
          weight: 4,
          opacity: 0.9,
          dashArray: order?.status === 'on_the_way' || order?.status === 'arrived' ? null : '10 10',
        }).addTo(map)
      } else {
        routeLineRef.current.setLatLngs(nextRoute)
        routeLineRef.current.setStyle({
          dashArray: order?.status === 'on_the_way' || order?.status === 'arrived' ? null : '10 10',
        })
      }
    } else if (routeLineRef.current) {
      map.removeLayer(routeLineRef.current)
      routeLineRef.current = null
    }

    if (points.length > 1) {
      map.fitBounds(points, { padding: [56, 56], maxZoom: 16 })
    } else if (points.length === 1) {
      map.setView(points[0], 15)
    } else {
      map.setView(DEFAULT_CENTER, 5)
    }
  }, [customerCoordinates, customerLocationLabel, order?.status, vendor?.name, vendorCoordinates])

  const routeDistance = useMemo(() => {
    if (!vendorCoordinates || !customerCoordinates) return null
    return haversineDistance(vendorCoordinates.lat, vendorCoordinates.lng, customerCoordinates.lat, customerCoordinates.lng)
  }, [customerCoordinates, vendorCoordinates])

  const routeEtaLabel = useMemo(() => formatEta(routeDistance, order?.status), [order?.status, routeDistance])

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

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Titik Pedagang</div>
            <div className="mt-2 text-sm font-medium text-slate-900">{getVendorLocationLabel(vendor?.location || order?.vendor_location_snapshot)}</div>
            <div className="mt-1 text-xs text-slate-500">{vendor?.online ? 'Posisi realtime pedagang aktif' : 'Memakai titik terakhir yang tersedia'}</div>
          </div>
          <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Titik Pelanggan</div>
            <div className="mt-2 text-sm font-medium text-slate-900">{customerLocationLabel}</div>
            <div className="mt-1 text-xs text-slate-500">
              {order?.buyer_id === user?.id && userLocation ? 'Mengikuti posisi Anda saat ini' : 'Memakai titik yang tersimpan saat checkout'}
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
                <span>{routeReady ? 'Garis menunjukkan jalur lurus saat ini' : 'Menunggu dua titik lengkap'}</span>
              </div>
              <div ref={containerRef} className="h-[56vh] min-h-[360px] rounded-[22px]" />
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
                <div>Lokasi pedagang: {getVendorLocationLabel(vendor?.location || order?.vendor_location_snapshot)}</div>
                <div>Lokasi pelanggan: {customerLocationLabel}</div>
                <div>Jarak rute: {formatDistance(routeDistance)}</div>
                <div>ETA: {routeEtaLabel}</div>
                <div>Status online pedagang: {vendor?.online ? 'Online' : 'Offline'}</div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}
