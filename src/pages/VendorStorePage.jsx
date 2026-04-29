import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import { findOrCreateDirectChat, sendChatMessage } from '../lib/conversations'
import {
  isFavoritesSchemaCompatibilityError,
  isVendorFavorited,
  normalizeFavoriteVendorIds,
} from '../lib/favorites'
import {
  buildOrderChatMessage,
  buildOrderInsertPayload,
  buildOrderItemRows,
  buildOrderItemsText,
  formatOrderTimingLabel,
  formatPriceLabel,
  formatPaymentMethodLabel,
  getFulfillmentTypeHint,
  getCartEntries,
  getCartTotals,
  getMeetingPointPlaceholder,
  getMeetingPointPresetOptions,
  getOrderTimingHint,
  isSchemaCompatibilityError,
} from '../lib/orders'
import { supabase } from '../lib/supabase'
import {
  createLocationPayload,
  formatVendorPromoExpiry,
  getVendorAvailablePaymentMethods,
  formatVendorCategoryLabel,
  getVendorPaymentMethodDetails,
  getVendorPaymentSetupSummary,
  formatVendorServiceMode,
  formatVendorServiceRadius,
  getOperatingHoursText,
  getVendorPromoText,
  isVendorPromoActive,
} from '../lib/vendor'
import { formatReviewScore, getReviewSummary } from '../lib/reviews'

function hasManagedStock(product) {
  return product?.stock !== null && typeof product?.stock !== 'undefined' && product?.stock !== ''
}

function getManagedStockNumber(product) {
  if (!hasManagedStock(product)) return null
  const stock = Number(product.stock)
  return Number.isFinite(stock) ? stock : null
}

function getProductStockLabel(product) {
  const stock = getManagedStockNumber(product)
  if (stock !== null) return stock <= 0 ? 'Stok habis' : `Stok ${stock}`

  return 'Stok fleksibel'
}

function isProductOrderable(product) {
  const stock = getManagedStockNumber(product)
  if (product?.is_available === false) return false
  if (stock !== null && stock <= 0) return false
  return true
}

function getStoreLocationStatus(location) {
  return location ? 'Lokasi aktif tersedia di peta pelanggan.' : 'Lokasi belum dibagikan.'
}

function getCurrentLocationSnapshot() {
  if (!navigator.geolocation) return Promise.resolve(null)

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve(createLocationPayload({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }))
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      }
    )
  })
}

export default function VendorStorePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const [vendor, setVendor] = useState(null)
  const [products, setProducts] = useState([])
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [cart, setCart] = useState({})
  const [submittingOrder, setSubmittingOrder] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cod')
  const [fulfillmentType, setFulfillmentType] = useState('meetup')
  const [orderTiming, setOrderTiming] = useState('asap')
  const [requestedFulfillmentAt, setRequestedFulfillmentAt] = useState('')
  const [meetingPointLabel, setMeetingPointLabel] = useState('')
  const [meetingPointLocation, setMeetingPointLocation] = useState(null)
  const [capturingMeetingPoint, setCapturingMeetingPoint] = useState(false)
  const [customerNote, setCustomerNote] = useState('')
  const [favoriteVendorIds, setFavoriteVendorIds] = useState([])
  const [favoriteFeatureEnabled, setFavoriteFeatureEnabled] = useState(true)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [showCustomerNote, setShowCustomerNote] = useState(false)
  const [showAllReviews, setShowAllReviews] = useState(false)
  const [showAllCartItems, setShowAllCartItems] = useState(false)

  const isOwner = user?.id === id
  const isFavorite = isVendorFavorited(favoriteVendorIds, id)
  const hasActivePromo = isVendorPromoActive(vendor)

  useEffect(() => {
    if (!id) return undefined

    let active = true

    async function loadVendorStore() {
      setLoading(true)
      try {
        const [vendorResult, productsResult] = await Promise.all([
          supabase.from('vendors').select('*').eq('id', id).maybeSingle(),
          supabase.from('products').select('*').eq('vendor_id', id).order('created_at', { ascending: false }),
        ])

        if (vendorResult.error) throw vendorResult.error
        if (productsResult.error) throw productsResult.error
        if (!active) return

        let nextReviews = []
        try {
          const { data: reviewsData, error: reviewsError } = await supabase
            .from('reviews')
            .select('id, order_id, rating, comment, buyer_name, created_at')
            .eq('vendor_id', id)
            .order('created_at', { ascending: false })
            .limit(6)

          if (reviewsError) throw reviewsError
          nextReviews = reviewsData || []
        } catch (reviewsError) {
          if (!isSchemaCompatibilityError(reviewsError)) {
            throw reviewsError
          }
        }

        setVendor(vendorResult.data || null)
        setProducts(productsResult.data || [])
        setReviews(nextReviews)
      } catch (error) {
        console.error('loadVendorStore', error)
        if (active) toast.push(error.message || 'Gagal memuat profil pedagang', { type: 'error' })
      } finally {
        if (active) setLoading(false)
      }
    }

    loadVendorStore()

    const vendorChannel = supabase
      .channel(`vendor-store-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors', filter: `id=eq.${id}` }, () => {
        loadVendorStore()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `vendor_id=eq.${id}` }, () => {
        loadVendorStore()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `vendor_id=eq.${id}` }, () => {
        loadVendorStore()
      })
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(vendorChannel)
      } catch (error) {
        console.error('removeVendorStoreChannel', error)
      }
    }
  }, [id, toast])

  useEffect(() => {
    if (!id || !user?.id || isOwner) {
      setFavoriteVendorIds([])
      return undefined
    }

    let active = true

    async function loadFavoriteState() {
      try {
        const { data, error } = await supabase
          .from('favorites')
          .select('vendor_id')
          .eq('buyer_id', user.id)
          .eq('vendor_id', id)

        if (error) throw error
        if (!active) return

        setFavoriteVendorIds(normalizeFavoriteVendorIds(data))
        setFavoriteFeatureEnabled(true)
      } catch (error) {
        console.error('loadFavoriteState', error)
        if (!active) return

        if (isFavoritesSchemaCompatibilityError(error)) {
          setFavoriteFeatureEnabled(false)
          setFavoriteVendorIds([])
          return
        }

        toast.push(error.message || 'Gagal memuat status favorit toko', { type: 'error' })
      }
    }

    void loadFavoriteState()

    return () => {
      active = false
    }
  }, [id, isOwner, toast, user?.id])

  useEffect(() => {
    setCart((current) => {
      let changed = false
      const nextCart = {}

      for (const product of products) {
        const currentEntry = current[product.id]
        if (!currentEntry?.quantity) continue
        if (!isProductOrderable(product)) {
          changed = true
          continue
        }

        const numericStock = getManagedStockNumber(product)
        const maxQuantity = numericStock !== null && numericStock > 0
          ? numericStock
          : currentEntry.quantity
        const safeQuantity = Math.min(currentEntry.quantity, maxQuantity)
        if (safeQuantity !== currentEntry.quantity) {
          changed = true
        }

        nextCart[product.id] = {
          ...currentEntry,
          quantity: safeQuantity,
        }
      }

      return changed ? nextCart : current
    })
  }, [products])

  const cartEntries = useMemo(() => getCartEntries(cart, products), [cart, products])
  const cartTotals = useMemo(() => getCartTotals(cartEntries), [cartEntries])
  const availableProductsCount = useMemo(
    () => products.filter((product) => isProductOrderable(product)).length,
    [products]
  )
  const reviewSummary = useMemo(() => getReviewSummary(reviews), [reviews])
  const availablePaymentMethods = useMemo(
    () => getVendorAvailablePaymentMethods(vendor?.payment_details),
    [vendor?.payment_details]
  )
  const nonCashPaymentMethods = useMemo(
    () => getVendorPaymentSetupSummary(vendor?.payment_details).filter((entry) => entry.ready),
    [vendor?.payment_details]
  )
  const selectedPaymentDetails = useMemo(
    () => getVendorPaymentMethodDetails(vendor?.payment_details, paymentMethod),
    [paymentMethod, vendor?.payment_details]
  )
  const productCards = useMemo(() => {
    if (isOwner) return products

    return [...products].sort((left, right) => {
      const leftOrderable = isProductOrderable(left)
      const rightOrderable = isProductOrderable(right)

      if (leftOrderable !== rightOrderable) {
        return leftOrderable ? -1 : 1
      }

      return (left.name || '').localeCompare(right.name || '', 'id')
    })
  }, [isOwner, products])
  const visibleReviews = showAllReviews ? reviews : reviews.slice(0, 2)
  const visibleCartEntries = showAllCartItems ? cartEntries : cartEntries.slice(0, 3)

  useEffect(() => {
    if (availablePaymentMethods.length === 0) return
    if (!availablePaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(availablePaymentMethods[0])
    }
  }, [availablePaymentMethods, paymentMethod])

  function updateQuantity(product, nextQuantity) {
    setCart((current) => {
      if (!product) return current

      if (!isProductOrderable(product)) {
        const { [product.id]: _removed, ...rest } = current
        return rest
      }

      const numericStock = getManagedStockNumber(product)
      const maxQuantity = numericStock !== null && numericStock > 0
        ? numericStock
        : Number.POSITIVE_INFINITY
      const quantity = Math.max(0, Number(nextQuantity) || 0)
      const safeQuantity = Math.min(quantity, maxQuantity)
      if (quantity === 0) {
        const { [product.id]: _removed, ...rest } = current
        return rest
      }

      return {
        ...current,
        [product.id]: {
          quantity: safeQuantity,
          note: current[product.id]?.note || '',
        },
      }
    })
  }

  function updateNote(productId, note) {
    setCart((current) => ({
      ...current,
      [productId]: {
        quantity: current[productId]?.quantity || 1,
        note,
      },
    }))
  }

  function clearCart() {
    setCart({})
    setOrderTiming('asap')
    setRequestedFulfillmentAt('')
    setMeetingPointLabel('')
    setMeetingPointLocation(null)
    setCustomerNote('')
    setShowCustomerNote(false)
    setShowAllCartItems(false)
  }

  async function applyMeetingPointPreset(preset) {
    if (!preset) return

    if (preset.usesCurrentLocation) {
      setCapturingMeetingPoint(true)
      const currentLocation = await getCurrentLocationSnapshot()
      setCapturingMeetingPoint(false)

      if (!currentLocation) {
        toast.push('Lokasi saat ini belum bisa dibaca. Anda tetap bisa menulis titik temu secara manual.', { type: 'info' })
        return
      }

      setMeetingPointLocation(currentLocation)
      setMeetingPointLabel(fulfillmentType === 'delivery' ? 'Antar ke lokasi saya saat ini' : 'Lokasi saya saat ini')
      toast.push('Lokasi saat ini dipakai sebagai titik temu pintar', { type: 'success' })
      return
    }

    setMeetingPointLabel(preset.label)
  }

  async function toggleFavoriteVendor() {
    if (isOwner) return

    if (!user) {
      toast.push('Login terlebih dahulu untuk menyimpan pedagang favorit', { type: 'info' })
      navigate('/login')
      return
    }

    if (!favoriteFeatureEnabled) {
      toast.push('Fitur favorit belum aktif di database. Jalankan migration favorit terlebih dahulu.', { type: 'info' })
      return
    }

    const nextFavoriteState = !isFavorite
    setFavoriteBusy(true)
    setFavoriteVendorIds((current) => (
      nextFavoriteState
        ? normalizeFavoriteVendorIds([...current.map((vendorId) => ({ vendor_id: vendorId })), { vendor_id: id }])
        : current.filter((vendorId) => vendorId !== id)
    ))

    try {
      if (nextFavoriteState) {
        const { error } = await supabase.from('favorites').insert([{ buyer_id: user.id, vendor_id: id }])
        if (error) throw error
        toast.push('Pedagang disimpan ke favorit Anda', { type: 'success' })
      } else {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('buyer_id', user.id)
          .eq('vendor_id', id)

        if (error) throw error
        toast.push('Pedagang dihapus dari favorit Anda', { type: 'success' })
      }
    } catch (error) {
      console.error('toggleFavoriteVendor', error)
      setFavoriteVendorIds((current) => (
        nextFavoriteState
          ? current.filter((vendorId) => vendorId !== id)
          : normalizeFavoriteVendorIds([...current.map((vendorId) => ({ vendor_id: vendorId })), { vendor_id: id }])
      ))

      if (isFavoritesSchemaCompatibilityError(error)) {
        setFavoriteFeatureEnabled(false)
        toast.push('Fitur favorit belum aktif di database. Jalankan migration favorit terlebih dahulu.', { type: 'info' })
        return
      }

      toast.push(error.message || 'Gagal memperbarui favorit toko', { type: 'error' })
    } finally {
      setFavoriteBusy(false)
    }
  }

  async function submitOrder(event) {
    event.preventDefault()

    if (!user) {
      toast.push('Silakan login terlebih dahulu untuk memesan', { type: 'info' })
      navigate('/login')
      return
    }

    if (isOwner) {
      toast.push('Anda tidak bisa memesan dari toko sendiri', { type: 'error' })
      return
    }

    if (cartEntries.length === 0) {
      toast.push('Pilih minimal satu produk terlebih dahulu', { type: 'error' })
      return
    }

    if (cartEntries.some((entry) => !isProductOrderable(entry.product))) {
      toast.push('Ada produk yang sudah tidak tersedia. Periksa kembali pilihan Anda.', { type: 'error' })
      return
    }

    if (!availablePaymentMethods.includes(paymentMethod)) {
      toast.push('Metode pembayaran ini belum disiapkan oleh pedagang. Pilih metode lain yang tersedia.', { type: 'error' })
      return
    }

    if (orderTiming === 'preorder' && !requestedFulfillmentAt) {
      toast.push('Isi waktu titip pesanan agar pedagang tahu kapan harus menyiapkan pesanan ini.', { type: 'error' })
      return
    }

    setSubmittingOrder(true)
    try {
      const buyerName = user.user_metadata?.full_name || user.email || 'Pelanggan'
      const customerLocation = await getCurrentLocationSnapshot()
      const scheduleTimestamp = requestedFulfillmentAt
        ? new Date(requestedFulfillmentAt).toISOString()
        : null
      const resolvedMeetingPointLocation = meetingPointLocation || customerLocation
      const resolvedMeetingPointLabel = meetingPointLabel.trim() || (
        fulfillmentType === 'delivery'
          ? 'Lokasi pelanggan'
          : 'Titik temu akan dikonfirmasi'
      )

      if (
        orderTiming === 'preorder' &&
        !meetingPointLabel.trim() &&
        !meetingPointLocation &&
        !customerLocation
      ) {
        toast.push('Untuk titip pesanan, isi area atau titik temu agar pedagang tahu rute tujuan Anda.', { type: 'error' })
        setSubmittingOrder(false)
        return
      }

      const directChat = await findOrCreateDirectChat(user.id, id)
      const orderPayload = buildOrderInsertPayload({
        vendorId: id,
        vendorName: vendor?.name || 'Pedagang',
        buyerId: user.id,
        buyerName,
        entries: cartEntries,
        paymentMethod,
        fulfillmentType,
        orderTiming,
        requestedFulfillmentAt: scheduleTimestamp,
        meetingPointLabel: resolvedMeetingPointLabel,
        customerNote,
        meetingPointLocation: resolvedMeetingPointLocation,
        customerLocation,
        vendorLocationSnapshot: vendor?.location || null,
      })

      let createdOrder = null
      let structuredOrderSaved = true
      const notes = []

      try {
        const { data, error } = await supabase
          .from('orders')
          .insert([orderPayload])
          .select()
          .single()

        if (error) throw error
        createdOrder = data
      } catch (error) {
        if (!isSchemaCompatibilityError(error)) throw error
        if (orderTiming === 'preorder') {
          throw new Error('Database belum memuat field pre-order. Jalankan migration pre-order terlebih dahulu agar titip pesanan bisa dipakai.')
        }
        try {
          const compatibilityPayload = { ...orderPayload }
          delete compatibilityPayload.customer_location
          delete compatibilityPayload.vendor_location_snapshot
          delete compatibilityPayload.order_timing
          delete compatibilityPayload.requested_fulfillment_at

          const { data, error: compatibilityError } = await supabase
            .from('orders')
            .insert([compatibilityPayload])
            .select()
            .single()

          if (compatibilityError) throw compatibilityError
          createdOrder = data
          notes.push('Tracking dua titik akan aktif penuh setelah migration tracking terbaru dijalankan.')
        } catch (compatibilityError) {
          if (!isSchemaCompatibilityError(compatibilityError)) throw compatibilityError

          structuredOrderSaved = false
          const { data, error: fallbackError } = await supabase
            .from('orders')
            .insert([{
              vendor_id: id,
              vendor_name: vendor?.name || 'Pedagang',
              buyer_id: user.id,
              buyer_name: buyerName,
              items: buildOrderItemsText(cartEntries),
              status: 'pending',
            }])
            .select()
            .single()

          if (fallbackError) throw fallbackError
          createdOrder = data
          notes.push('Database masih memakai model order lama, jadi detail pembayaran dan titik temu belum tersimpan penuh.')
        }
      }

      if (createdOrder?.id) {
        try {
          const orderItemsPayload = buildOrderItemRows({
            orderId: createdOrder.id,
            vendorId: id,
            entries: cartEntries,
          })

          if (orderItemsPayload.length > 0) {
            const { error: itemsError } = await supabase.from('order_items').insert(orderItemsPayload)
            if (itemsError) throw itemsError
          }
        } catch (itemsError) {
          console.error('submitOrder.orderItems', itemsError)
          if (!isSchemaCompatibilityError(itemsError)) {
            notes.push('Pesanan masuk, tetapi item order terstruktur belum tersimpan sempurna.')
          }
        }
      }

      let successMessage = 'Pesanan berhasil dikirim dan chat dibuka untuk tindak lanjut.'
      try {
        await sendChatMessage(directChat.id, user.id, buildOrderChatMessage({
          buyerName,
          entries: cartEntries,
          orderId: createdOrder?.id,
          paymentMethod,
          fulfillmentType,
          orderTiming,
          requestedFulfillmentAt: scheduleTimestamp,
          meetingPointLabel: resolvedMeetingPointLabel,
          customerNote,
        }))
      } catch (messageError) {
        console.error('submitOrder.sendChatMessage', messageError)
        notes.push('Ringkasan otomatis di chat belum terkirim.')
      }

      clearCart()
      if (!structuredOrderSaved) {
        setPaymentMethod('cod')
        setFulfillmentType('meetup')
      }
      if (!customerLocation) {
        notes.push('Lokasi pelanggan belum ikut tersimpan, jadi tracking peta hanya akan memakai data yang tersedia saat ini.')
      }
      if (orderTiming === 'preorder') {
        notes.push('Pesanan ini dicatat sebagai titip untuk nanti, jadi pedagang bisa menyesuaikan area dan waktu yang Anda minta lewat chat.')
      }
      if (paymentMethod !== 'cod') {
        notes.push('Buka chat atau detail pesanan untuk mengirim konfirmasi pembayaran setelah pembayaran non-tunai dilakukan.')
      }
      if (notes.length > 0) {
        successMessage = `${successMessage} ${notes.join(' ')}`
      }
      toast.push(successMessage, { type: notes.length > 0 ? 'info' : 'success' })
      navigate(createdOrder?.id ? `/chat/${vendor.id}?order=${createdOrder.id}` : `/chat/${vendor.id}`)
    } catch (error) {
      console.error('submitOrder', error)
      toast.push(error.message || 'Gagal mengirim pesanan', { type: 'error' })
    } finally {
      setSubmittingOrder(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Memuat profil pedagang...</div>
  }

  if (!vendor) {
    return <div className="p-6 text-sm text-gray-500">Pedagang tidak ditemukan.</div>
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-transparent">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
        <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="order-2 min-w-0 space-y-4 lg:order-1 lg:sticky lg:top-24 lg:self-start">
            <div className="hidden rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80 lg:block">
              <div className="flex flex-col items-center text-center">
                <div className="h-28 w-28 overflow-hidden rounded-full bg-slate-100">
                  {vendor.photo_url ? (
                    <img src={vendor.photo_url} alt={vendor.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-3xl font-semibold text-slate-500">
                      {(vendor.name || 'P')[0]}
                    </div>
                  )}
                </div>

                <h1 className="mt-4 text-2xl font-semibold text-slate-900">{vendor.name}</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">{vendor.description || 'Pedagang lokal siap melayani Anda.'}</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                    vendor.online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {vendor.online ? 'Sedang Online' : 'Sedang Offline'}
                  </span>
                  {reviewSummary.count > 0 && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                      Rating {formatReviewScore(reviewSummary.average)} • {reviewSummary.count} ulasan
                    </span>
                  )}
                  {vendor.is_verified && (
                    <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                      Terverifikasi
                    </span>
                  )}
                  {!isOwner && favoriteFeatureEnabled && isFavorite && (
                    <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">
                      Favorit Anda
                    </span>
                  )}
                  {hasActivePromo && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                      Promo Aktif
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="hidden rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80 lg:block">
              <h2 className="font-semibold text-slate-900">Info Toko</h2>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div>Kategori: {formatVendorCategoryLabel(vendor.category_primary)}</div>
                <div>Mode layanan: {formatVendorServiceMode(vendor.service_mode)}</div>
                <div>Area layanan: {formatVendorServiceRadius(vendor.service_radius_km)}</div>
                <div>Jam operasional: {getOperatingHoursText(vendor.operating_hours)}</div>
                <div>Lokasi: {getStoreLocationStatus(vendor.location)}</div>
                <div>Produk siap dipesan: {availableProductsCount}</div>
                <div>Rating pelanggan: {reviewSummary.count > 0 ? `${formatReviewScore(reviewSummary.average)} dari ${reviewSummary.count} ulasan` : 'Belum ada ulasan'}</div>
                <div>Promo: {hasActivePromo ? 'Sedang aktif' : 'Tidak ada promo aktif'}</div>
                <div>
                  Pembayaran non-tunai: {nonCashPaymentMethods.length > 0
                    ? nonCashPaymentMethods.map((entry) => entry.label).join(', ')
                    : 'Belum disiapkan'}
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {isOwner ? (
                  <>
                    <button
                      onClick={() => navigate('/dashboard?tab=products')}
                      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
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
                    {favoriteFeatureEnabled && (
                      <button
                        onClick={() => void toggleFavoriteVendor()}
                        disabled={favoriteBusy}
                        className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                          isFavorite
                            ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70'
                            : 'border border-slate-200 px-4 py-3 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70'
                        }`}
                      >
                        {favoriteBusy ? 'Menyimpan...' : isFavorite ? 'Tersimpan di Favorit' : 'Simpan ke Favorit'}
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/chat/${vendor.id}`)}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Chat Pedagang
                    </button>
                    <button
                      onClick={() => document.getElementById('order-summary')?.scrollIntoView({ behavior: 'smooth' })}
                      className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                    >
                      Lihat Ringkasan Pesanan
                    </button>
                  </>
                )}
              </div>
            </div>

            {!isOwner && (
              <section id="order-summary" className="scroll-mt-24 rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-slate-900">Ringkasan Pesanan</h2>
                    <p className="mt-1 hidden text-sm text-slate-500 sm:block sm:leading-6">
                      Kirim pesanan lalu lanjut koordinasi lewat chat.
                    </p>
                  </div>
                  {cartEntries.length > 0 && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      {cartTotals.items} item
                    </span>
                  )}
                </div>

                {cartEntries.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                    Belum ada produk dipilih.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {visibleCartEntries.map((entry) => (
                      <div key={entry.product.id} className="min-w-0 rounded-2xl bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="break-words font-medium text-slate-900">{entry.product.name}</div>
                            <div className="text-sm text-slate-500">Jumlah: {entry.quantity}</div>
                            {entry.note && <div className="mt-1 line-clamp-2 break-words text-sm text-slate-600">Catatan: {entry.note}</div>}
                          </div>
                          <div className="shrink-0 text-right text-sm font-medium text-slate-700">{formatPriceLabel(entry.product.price)}</div>
                        </div>
                      </div>
                    ))}
                    {cartEntries.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setShowAllCartItems((current) => !current)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {showAllCartItems ? 'Ringkas Item' : `Lihat ${cartEntries.length - 3} item lainnya`}
                      </button>
                    )}

                    <div className="rounded-2xl border border-slate-200 p-3 text-sm text-slate-600 sm:p-4">
                      <div className="grid grid-cols-2 gap-2">
                        <div>{cartTotals.types} produk</div>
                        <div>{cartTotals.items} item</div>
                      </div>
                      <div className="mt-2 font-medium text-slate-900">
                        Total: {cartTotals.estimatedTotal > 0 ? formatPriceLabel(cartTotals.estimatedTotal) : 'Menyesuaikan harga'}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                      <div className="text-sm font-medium text-slate-900">Waktu Pesanan</div>
                      <div className="mt-2 hidden text-sm text-slate-500 sm:block">
                        {getOrderTimingHint(orderTiming)}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setOrderTiming('asap')}
                          className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${
                            orderTiming === 'asap'
                              ? 'bg-slate-900 text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Pesan Sekarang
                        </button>
                        <button
                          type="button"
                          onClick={() => setOrderTiming('preorder')}
                          className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${
                            orderTiming === 'preorder'
                              ? 'bg-slate-900 text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Titip untuk Nanti
                        </button>
                      </div>
                      {orderTiming === 'preorder' && (
                        <>
                          <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            Pilih waktu perkiraan agar pedagang bisa menyesuaikan rute.
                          </div>
                          <input
                            type="datetime-local"
                            value={requestedFulfillmentAt}
                            onChange={(event) => setRequestedFulfillmentAt(event.target.value)}
                            className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                          />
                        </>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                      <div className="text-sm font-medium text-slate-900">Metode Pembayaran</div>
                      <div className={`mt-3 grid grid-cols-2 gap-2 ${
                        availablePaymentMethods.length >= 4
                          ? 'sm:grid-cols-2'
                          : availablePaymentMethods.length === 3
                            ? 'sm:grid-cols-3'
                            : availablePaymentMethods.length === 2
                              ? 'sm:grid-cols-2'
                              : 'sm:grid-cols-1'
                      }`}>
                        {availablePaymentMethods.map((method) => (
                          <button
                            key={method}
                            type="button"
                            onClick={() => setPaymentMethod(method)}
                            className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${
                              paymentMethod === method
                                ? 'bg-slate-900 text-white'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {formatPaymentMethodLabel(method)}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 hidden rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 sm:block">
                        {paymentMethod === 'cod'
                          ? 'Pembayaran dilakukan saat bertemu pedagang. Cocok untuk transaksi yang ingin diselesaikan langsung di titik temu atau saat pesanan tiba.'
                          : `${formatPaymentMethodLabel(paymentMethod)} akan menampilkan detail pembayaran milik pedagang di bawah. Setelah membayar, kirim konfirmasi dari chat atau halaman pesanan agar pedagang bisa memeriksa.`}
                      </div>

                      {paymentMethod !== 'cod' && (
                        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-sm font-medium text-slate-900">{selectedPaymentDetails.title}</div>
                          {selectedPaymentDetails.ready ? (
                            <>
                              <div className="mt-2 text-sm leading-6 text-slate-600">{selectedPaymentDetails.description}</div>

                              {selectedPaymentDetails.imageUrl && (
                                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
                                  <img
                                    src={selectedPaymentDetails.imageUrl}
                                    alt={selectedPaymentDetails.title}
                                    className="h-44 w-full rounded-xl object-contain sm:h-56"
                                  />
                                </div>
                              )}

                              {selectedPaymentDetails.rows.length > 0 && (
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                  {selectedPaymentDetails.rows.map((row) => (
                                    <div key={row.label} className="rounded-2xl bg-slate-50 px-4 py-3">
                                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{row.label}</div>
                                      <div className="mt-1 text-sm font-medium text-slate-900">{row.value}</div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {selectedPaymentDetails.note && (
                                <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                  Catatan pedagang: {selectedPaymentDetails.note}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="mt-2 text-sm text-slate-500">
                              Pedagang belum menyiapkan detail untuk metode ini. Gunakan metode lain atau klarifikasi lewat chat.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                      <div className="text-sm font-medium text-slate-900">Metode Serah Terima</div>
                      <div className="mt-2 hidden text-sm text-slate-500 sm:block">
                        {getFulfillmentTypeHint(fulfillmentType)}
                      </div>
                      {orderTiming === 'preorder' && (
                        <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          Untuk titip pesanan, isi area tujuan atau titik temu utama agar pedagang tahu ke mana pesanan ini perlu diarahkan.
                        </div>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFulfillmentType('meetup')}
                          className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${
                            fulfillmentType === 'meetup'
                              ? 'bg-emerald-600 text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Titik Temu
                        </button>
                        <button
                          type="button"
                          onClick={() => setFulfillmentType('delivery')}
                          className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${
                            fulfillmentType === 'delivery'
                              ? 'bg-emerald-600 text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Antar
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {getMeetingPointPresetOptions(fulfillmentType).map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            disabled={capturingMeetingPoint && preset.usesCurrentLocation}
                            onClick={() => void applyMeetingPointPreset(preset)}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {capturingMeetingPoint && preset.usesCurrentLocation ? 'Membaca lokasi...' : preset.label}
                          </button>
                        ))}
                      </div>

                      <input
                        value={meetingPointLabel}
                        onChange={(event) => setMeetingPointLabel(event.target.value)}
                        className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                        placeholder={
                          orderTiming === 'preorder'
                            ? 'Contoh: area kampus, perumahan bukit hijau, depan minimarket utama'
                            : getMeetingPointPlaceholder(fulfillmentType)
                        }
                      />
                      {meetingPointLocation && (
                        <div className="mt-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                          Lokasi saat ini sudah disimpan untuk membantu pedagang menemukan titik {fulfillmentType === 'delivery' ? 'antar' : 'temu'}.
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-medium text-slate-900">Catatan Pesanan</label>
                        <button
                          type="button"
                          onClick={() => setShowCustomerNote((current) => !current)}
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                        >
                          {showCustomerNote || customerNote ? 'Tutup' : 'Tambah'}
                        </button>
                      </div>
                      {(showCustomerNote || customerNote) ? (
                        <textarea
                          value={customerNote}
                          onChange={(event) => setCustomerNote(event.target.value)}
                          maxLength={180}
                          rows={3}
                          className="mt-3 min-h-[84px] w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                          placeholder="Contoh: tunggu di depan rumah, tidak pedas, hubungi saat dekat"
                        />
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">
                          Opsional. Tambahkan kalau ada instruksi khusus untuk pedagang.
                        </div>
                      )}
                    </div>

                    {!user ? (
                      <button
                        onClick={() => navigate('/login')}
                        className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
                      >
                        Login Untuk Memesan
                      </button>
                    ) : (
                      <form onSubmit={submitOrder} className="space-y-2">
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          {formatOrderTimingLabel(orderTiming)}
                          {orderTiming === 'preorder' && requestedFulfillmentAt
                            ? ` • sekitar ${new Date(requestedFulfillmentAt).toLocaleString('id-ID', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}`
                            : ''}
                        </div>
                        <button
                          type="submit"
                          disabled={submittingOrder}
                          className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:bg-emerald-300"
                        >
                          {submittingOrder
                            ? 'Mengirim Pesanan...'
                            : orderTiming === 'preorder'
                              ? 'Titip Pesanan & Buka Chat'
                              : 'Kirim Pesanan & Buka Chat'}
                        </button>
                        <button
                          type="button"
                          onClick={clearCart}
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                        >
                          Kosongkan Pilihan
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </section>
            )}
          </aside>

          <main className="order-1 min-w-0 space-y-4 lg:order-2">
            <section className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5 lg:hidden">
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100 sm:h-16 sm:w-16">
                  {vendor.photo_url ? (
                    <img src={vendor.photo_url} alt={vendor.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xl font-semibold text-slate-500">
                      {(vendor.name || 'P')[0]}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h1 className="break-words text-xl font-semibold text-slate-900">{vendor.name}</h1>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">
                    {vendor.description || 'Pedagang lokal siap melayani Anda.'}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  vendor.online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {vendor.online ? 'Sedang Online' : 'Sedang Offline'}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {formatVendorCategoryLabel(vendor.category_primary)}
                </span>
                {reviewSummary.count > 0 && (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    {formatReviewScore(reviewSummary.average)} • {reviewSummary.count} ulasan
                  </span>
                )}
                {vendor.is_verified && (
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                    Terverifikasi
                  </span>
                )}
                {hasActivePromo && (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                    Promo Aktif
                  </span>
                )}
              </div>

              {isOwner ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => navigate('/dashboard?tab=products')}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
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
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {favoriteFeatureEnabled && (
                    <button
                      onClick={() => void toggleFavoriteVendor()}
                      disabled={favoriteBusy}
                      className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                        isFavorite
                          ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70'
                      }`}
                    >
                      {favoriteBusy ? 'Menyimpan...' : isFavorite ? 'Tersimpan di Favorit' : 'Simpan ke Favorit'}
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/chat/${vendor.id}`)}
                    className={`rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 ${
                      favoriteFeatureEnabled ? '' : 'col-span-2'
                    }`}
                  >
                    Chat Pedagang
                  </button>
                </div>
              )}
            </section>

            {hasActivePromo && (
              <section className="rounded-[24px] border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-4 shadow-sm sm:rounded-[28px] sm:p-5">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-700">Promo Aktif</div>
                <div className="mt-2 line-clamp-2 text-lg font-semibold text-slate-900 sm:line-clamp-none">{getVendorPromoText(vendor)}</div>
                <div className="mt-1 text-sm text-slate-600">
                  Berlaku sampai {formatVendorPromoExpiry(vendor)}
                </div>
              </section>
            )}

            <section className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold text-slate-900">Menu Tersedia</h2>
                  <p className="mt-1 hidden text-sm text-slate-500 sm:block">Pilih dari produk yang memang tersedia agar order lebih mudah diproses oleh pedagang.</p>
                </div>
                {!isOwner && cartEntries.length > 0 && (
                  <button
                    onClick={() => document.getElementById('order-summary')?.scrollIntoView({ behavior: 'smooth' })}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                  >
                    Lihat {cartTotals.items} Item Dipilih
                  </button>
                )}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:gap-4">
                {productCards.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    Belum ada produk yang dipublikasikan.
                  </div>
                ) : (
                  productCards.map((product) => {
                    const quantity = cart[product.id]?.quantity || 0
                    const note = cart[product.id]?.note || ''
                    const orderable = isOwner || isProductOrderable(product)

                    return (
                      <div key={product.id} className={`min-w-0 overflow-hidden rounded-[22px] border bg-white shadow-sm sm:rounded-[24px] ${
                        orderable ? 'border-slate-200' : 'border-slate-200/70 opacity-80'
                      }`}>
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.name} className="h-28 w-full object-cover sm:h-44" />
                        ) : (
                          <div className="flex h-28 items-center justify-center bg-slate-100 text-sm text-slate-400 sm:h-44">
                            Belum ada gambar
                          </div>
                        )}

                        <div className="space-y-3 p-3 sm:p-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="break-words font-semibold text-slate-900">{product.name}</div>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                orderable
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-rose-50 text-rose-700'
                              }`}>
                                {orderable ? 'Siap dipesan' : 'Belum tersedia'}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-2 break-words text-sm leading-6 text-slate-600">{product.description || 'Tanpa deskripsi'}</div>
                          </div>

                          <div className="flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                              {formatPriceLabel(product.price)}
                            </span>
                            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                              {getProductStockLabel(product)}
                            </span>
                            {product.category_name && (
                              <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                                {product.category_name}
                              </span>
                            )}
                          </div>

                          {!isOwner && (
                            <div className="space-y-3 rounded-2xl bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-slate-700">Jumlah Pesanan</div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => updateQuantity(product, quantity - 1)}
                                    disabled={quantity === 0}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700 disabled:opacity-50"
                                  >
                                    -
                                  </button>
                                  <div className="min-w-8 text-center text-sm font-semibold text-slate-900">{quantity}</div>
                                  <button
                                    type="button"
                                    onClick={() => updateQuantity(product, quantity + 1)}
                                    disabled={!orderable}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700 disabled:opacity-50"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {!orderable && (
                                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                                  Produk ini sedang tidak tersedia untuk dipesan. Anda masih bisa chat pedagang untuk klarifikasi.
                                </div>
                              )}

                              {quantity > 0 && orderable && (
                                <textarea
                                  value={note}
                                  onChange={(event) => updateNote(product.id, event.target.value)}
                                  maxLength={140}
                                  rows={2}
                                  className="min-h-[72px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                                  placeholder="Catatan opsional, misalnya: tidak pedas, sayur dipisah, kirim sore hari"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </section>

            <section className="hidden rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:block">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Ulasan Pelanggan</h2>
                  <p className="mt-1 hidden text-sm text-slate-500 sm:block">
                    Bagian ini membantu pelanggan baru melihat pengalaman transaksi yang sudah selesai.
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {reviewSummary.count > 0
                    ? `${formatReviewScore(reviewSummary.average)} dari ${reviewSummary.count} ulasan`
                    : 'Belum ada ulasan'}
                </div>
              </div>

              {reviews.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  Ulasan akan muncul setelah pelanggan menyelesaikan pesanan dan memberi penilaian.
                </div>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {visibleReviews.map((review) => (
                    <article key={review.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-slate-900">{review.buyer_name || 'Pelanggan'}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            Rating {formatReviewScore(review.rating)} • {new Date(review.created_at).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </div>
                        </div>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                          {review.rating}/5
                        </span>
                      </div>

                      <div className="mt-3 text-sm leading-6 text-slate-600">
                        {review.comment || 'Pelanggan tidak menambahkan komentar tertulis.'}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {reviews.length > 2 && (
                <button
                  type="button"
                  onClick={() => setShowAllReviews((current) => !current)}
                  className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {showAllReviews ? 'Tampilkan lebih sedikit' : `Lihat ${reviews.length - 2} ulasan lainnya`}
                </button>
              )}
            </section>
          </main>
        </div>
      </div>

      {!isOwner && cartEntries.length > 0 && (
        <div className="fixed inset-x-4 bottom-24 z-30 lg:hidden">
          <button
            onClick={() => document.getElementById('order-summary')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex w-full items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-left text-white shadow-xl shadow-slate-900/20"
          >
            <span>
              <span className="block text-sm font-semibold">{cartTotals.items} item dipilih</span>
              <span className="block text-xs text-slate-300">Lihat ringkasan pesanan</span>
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
              Pesan
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
