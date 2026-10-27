import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { PaymentMethod, Product } from '../../types/domain.types'
import { errorMessage } from '../../shared/lib/utils'
import { reportError } from '../../shared/lib/error-reporting'
import {
  getCartEntries,
  getCartTotals,
  getManagedStockNumber,
  isProductOrderable,
  type Cart
} from '../orders/cart'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../../shared/components/ToastProvider'
import { useAuth } from '../auth/AuthProvider'
import { useVendor } from './useVendor'
import ProductList from './ProductList'
import { useFavorites } from './useFavorites'
import { useCreatePickupOrder } from '../orders/useOrders'
import { formatMobility, validatePickupRequest } from '../../lib/pickup'
import {
  findOrCreateDirectChat,
  sendChatMessage
} from '../../lib/conversations'

import {
  buildOrderChatMessage,
  formatPriceLabel,
  formatPaymentMethodLabel,
  getFulfillmentTypeHint
} from '../../lib/orders'

import {
  createLocationPayload,
  formatVendorPromoExpiry,
  getVendorAvailablePaymentMethods,
  formatVendorCategoryLabel,
  getVendorPaymentMethodDetails,
  getVendorPaymentSetupSummary,
  formatVendorServiceRadius,
  getOperatingHoursText,
  getVendorPromoText,
  isVendorPresenceFresh,
  isVendorPromoActive
} from '../../lib/vendor'
import { formatReviewScore, getReviewSummary } from '../../lib/reviews'

function getStoreLocationStatus(location: unknown) {
  return location
    ? 'Lokasi aktif tersedia di peta pelanggan.'
    : 'Lokasi belum dibagikan.'
}

function getCurrentLocationSnapshot() {
  if (!navigator.geolocation) return Promise.resolve(null)

  return new Promise<ReturnType<typeof createLocationPayload>>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve(
          createLocationPayload({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          })
        )
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000
      }
    )
  })
}

export default function VendorStorePage() {
  const { id } = useParams()
  const { user } = useAuth()
  return <VendorStoreContent key={`${user?.id}:${id}`} id={id} />
}

function VendorStoreContent({ id }: { id: string | undefined }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const { mutateAsync: createPickupOrder } = useCreatePickupOrder()

  const storeQuery = useVendor(id)
  const { vendor, products, reviews } = storeQuery
  const loading = storeQuery.isPending
  const [cart, setCart] = useState<Cart>({})
  const [submittingOrder, setSubmittingOrder] = useState(false)
  const submitLock = useRef(false)
  const summaryRef = useRef<HTMLElement>(null)
  const lifecycle = useRef(0)
  useEffect(() => {
    lifecycle.current++
    return () => {
      lifecycle.current++
    }
  }, [])
  const [summaryVisible, setSummaryVisible] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod')
  const [fulfillmentType, setFulfillmentType] = useState('self_pickup')
  const [pickupContact, setPickupContact] = useState('')
  const [courierConsent, setCourierConsent] = useState(false)
  const [customerNote, setCustomerNote] = useState('')
  const favoritesQuery = useFavorites()
  const favoriteFeatureEnabled = favoritesQuery.available
  const favoriteBusy = favoritesQuery.busyVendorId === id
  const [showCustomerNote, setShowCustomerNote] = useState(false)
  const [showAllReviews, setShowAllReviews] = useState(false)
  const [showAllCartItems, setShowAllCartItems] = useState(false)
  const [expandedProductNoteIds, setExpandedProductNoteIds] = useState<
    Record<string, boolean>
  >({})

  const isOwner = user?.id === id
  useEffect(() => {
    setPickupContact(user?.user_metadata?.full_name || '')
  }, [user?.id])
  const isFavorite = !!id && favoritesQuery.ids.includes(id)
  const hasActivePromo = isVendorPromoActive(vendor)

  useEffect(() => {
    const summary = summaryRef.current
    if (
      loading ||
      isOwner ||
      !summary ||
      typeof IntersectionObserver === 'undefined'
    )
      return undefined
    const observer = new IntersectionObserver(
      ([entry]) => setSummaryVisible(entry.isIntersecting),
      {
        rootMargin: '-72px 0px -96px 0px'
      }
    )
    observer.observe(summary)
    return () => observer.disconnect()
  }, [id, isOwner, loading])

  useEffect(() => {
    setCart((current) => {
      let changed = false
      const nextCart: Cart = {}

      for (const product of products) {
        const currentEntry = current[product.id]
        if (!currentEntry?.quantity) continue
        if (!isProductOrderable(product)) {
          changed = true
          continue
        }

        const numericStock = getManagedStockNumber(product)
        const maxQuantity =
          numericStock !== null && numericStock > 0
            ? numericStock
            : currentEntry.quantity
        const safeQuantity = Math.min(currentEntry.quantity, maxQuantity)
        if (safeQuantity !== currentEntry.quantity) {
          changed = true
        }

        nextCart[product.id] = {
          ...currentEntry,
          quantity: safeQuantity
        }
      }

      return changed ? nextCart : current
    })
  }, [products])

  const cartEntries = useMemo(
    () => getCartEntries(cart, products),
    [cart, products]
  )
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
    () =>
      getVendorPaymentSetupSummary(vendor?.payment_details).filter(
        (entry) => entry.ready
      ),
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
  const visibleCartEntries = showAllCartItems
    ? cartEntries
    : cartEntries.slice(0, 3)

  useEffect(() => {
    if (availablePaymentMethods.length === 0) return
    if (!availablePaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(availablePaymentMethods[0])
    }
  }, [availablePaymentMethods, paymentMethod])

  function updateQuantity(product: Product, nextQuantity: number) {
    if (product && (Number(nextQuantity) || 0) <= 0) {
      setExpandedProductNoteIds((current) => {
        const { [product.id]: _removed, ...rest } = current
        return rest
      })
    }

    setCart((current) => {
      if (!product) return current

      if (!isProductOrderable(product)) {
        const { [product.id]: _removed, ...rest } = current
        return rest
      }

      const numericStock = getManagedStockNumber(product)
      const maxQuantity =
        numericStock !== null && numericStock > 0
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
          note: current[product.id]?.note || ''
        }
      }
    })
  }

  function updateNote(productId: string, note: string) {
    setCart((current) => ({
      ...current,
      [productId]: {
        quantity: current[productId]?.quantity || 1,
        note
      }
    }))
  }

  function toggleProductNote(productId: string, isExpanded = false) {
    setExpandedProductNoteIds((current) => ({
      ...current,
      [productId]: !isExpanded
    }))
  }

  function clearCart() {
    setCart({})
    setCustomerNote('')
    setShowCustomerNote(false)
    setShowAllCartItems(false)
    setExpandedProductNoteIds({})
  }

  async function toggleFavoriteVendor() {
    if (!id || isOwner || !favoriteFeatureEnabled) return
    try {
      const saved = await favoritesQuery.setFavorite(id, !isFavorite)
      if (saved)
        toast.push(
          isFavorite
            ? 'Pedagang dihapus dari favorit'
            : 'Pedagang disimpan ke favorit',
          {
            type: 'success'
          }
        )
    } catch {
      toast.push('Favorit belum dapat diperbarui. Coba lagi.', {
        type: 'error'
      })
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitLock.current || !id) return
    if (storeQuery.isError) {
      toast.push('Perbarui informasi toko sebelum mengirim pesanan.', {
        type: 'error'
      })
      return
    }

    if (!user) {
      toast.push('Silakan login terlebih dahulu untuk memesan', {
        type: 'info'
      })
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
      toast.push(
        'Ada produk yang sudah tidak tersedia. Periksa kembali pilihan Anda.',
        {
          type: 'error'
        }
      )
      return
    }

    if (!availablePaymentMethods.includes(paymentMethod)) {
      toast.push(
        'Metode pembayaran ini belum disiapkan oleh pedagang. Pilih metode lain yang tersedia.',
        { type: 'error' }
      )
      return
    }

    const invalidPickup = validatePickupRequest({
      method: fulfillmentType,
      point:
        fulfillmentType === 'self_pickup'
          ? 'Lokasi pelanggan saat pengambilan'
          : 'Kurir mengambil di lokasi pedagang',
      collector: pickupContact,
      courierConsent
    })
    if (invalidPickup) {
      toast.push(invalidPickup, { type: 'error' })
      return
    }
    const version = lifecycle.current
    submitLock.current = true
    setSubmittingOrder(true)
    try {
      const buyerName =
        user.user_metadata?.full_name || user.email || 'Pelanggan'
      const currentLocation =
        fulfillmentType === 'self_pickup'
          ? await getCurrentLocationSnapshot()
          : null
      if (version !== lifecycle.current) return
      const resolvedMeetingPointLabel =
        fulfillmentType === 'customer_courier'
          ? 'Kurir mengambil di lokasi pedagang'
          : currentLocation
            ? 'Lokasi pelanggan saat memesan; pelanggan mengambil ke pedagang'
            : 'Pelanggan mengambil ke pedagang; koordinasikan melalui chat'
      if (fulfillmentType === 'self_pickup' && !currentLocation) {
        toast.push(
          'Lokasi belum terbaca. Pesanan tetap dikirim; koordinasikan pengambilan melalui chat.',
          { type: 'info' }
        )
      }
      const createdOrder = await createPickupOrder({
        target_vendor_id: id,
        target_payment_method: paymentMethod,
        target_fulfillment_type: fulfillmentType,
        target_order_timing: 'asap',
        target_requested_fulfillment_at: null,
        target_meeting_point_label: resolvedMeetingPointLabel,
        target_meeting_point_location: currentLocation,
        target_customer_note: customerNote.trim() || null,
        target_customer_location: null,
        target_pickup_contact_name: pickupContact.trim(),
        target_courier_consent: courierConsent,
        target_items: cartEntries.map((entry) => ({
          product_id: entry.product.id,
          quantity: entry.quantity,
          note: entry.note || null
        }))
      })
      const notes = []
      let directChat = null

      let successMessage = 'Permintaan dikirim. Tunggu konfirmasi pedagang.'
      try {
        directChat = await findOrCreateDirectChat(user.id, id)
        await sendChatMessage(
          directChat.id,
          user.id,
          buildOrderChatMessage({
            buyerName,
            entries: cartEntries,
            orderId: createdOrder?.id,
            paymentMethod,
            fulfillmentType,
            orderTiming: 'asap',
            requestedFulfillmentAt: null,
            meetingPointLabel: resolvedMeetingPointLabel,
            customerNote
          })
        )
      } catch (messageError) {
        void reportError(messageError, 'chat')
        notes.push(
          'Pesanan tersimpan, tetapi ringkasan otomatis di chat belum terkirim.'
        )
      }

      if (version !== lifecycle.current) return
      clearCart()
      if (notes.length > 0) {
        successMessage = `${successMessage} ${notes.join(' ')}`
      }
      toast.push(successMessage, {
        type: notes.length > 0 ? 'info' : 'success'
      })
      navigate(`/orders/${createdOrder.id}`)
    } catch (error) {
      void reportError(error, 'orders')
      if (version === lifecycle.current)
        toast.push(errorMessage(error) || 'Gagal mengirim pesanan', {
          type: 'error'
        })
    } finally {
      submitLock.current = false
      setSubmittingOrder(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500">Memuat profil pedagang...</div>
    )
  }

  if (!vendor) {
    return (
      <div
        className="p-6 text-sm text-gray-500"
        role={storeQuery.error ? 'alert' : undefined}
      >
        {storeQuery.error ? (
          <>
            Toko belum termuat.{' '}
            <button
              type="button"
              onClick={() => {
                void storeQuery.refetch()
              }}
            >
              Coba lagi
            </button>
          </>
        ) : (
          'Pedagang tidak ditemukan.'
        )}
      </div>
    )
  }

  const vendorIsOnline = isVendorPresenceFresh(vendor)

  return (
    <div>
      <div className="ui-page max-w-6xl">
        {storeQuery.isError ? (
          <p role="alert" className="mb-3 text-sm text-amber-800">
            Informasi toko belum diperbarui.{' '}
            <button
              type="button"
              onClick={() => {
                void storeQuery.refetch()
              }}
            >
              Coba lagi
            </button>
          </p>
        ) : null}
        <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="order-2 min-w-0 space-y-3 lg:order-1 lg:sticky lg:top-24 lg:self-start lg:space-y-4">
            <div className="hidden rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80 lg:block">
              <div className="flex flex-col items-center text-center">
                <div className="h-28 w-28 overflow-hidden rounded-full bg-slate-100">
                  {vendor.photo_url ? (
                    <img
                      src={vendor.photo_url}
                      alt={vendor.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-3xl font-semibold text-slate-500">
                      {(vendor.name || 'P')[0]}
                    </div>
                  )}
                </div>

                <h1 className="mt-4 text-2xl font-semibold text-slate-900">
                  {vendor.name}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {vendor.description || 'Pedagang lokal siap melayani Anda.'}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      vendorIsOnline
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {vendorIsOnline ? 'Sedang Online' : 'Sedang Offline'}
                  </span>
                  {reviewSummary.count > 0 && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                      Rating {formatReviewScore(reviewSummary.average)} •{' '}
                      {reviewSummary.count} ulasan
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
                <div>
                  Kategori: {formatVendorCategoryLabel(vendor.category_primary)}
                </div>
                <div>Pengambilan di titik disepakati</div>
                <div>{formatMobility(vendor.mobility_type)}</div>
                {vendor.service_area && (
                  <div className="break-words">Area: {vendor.service_area}</div>
                )}
                {vendor.route_description && (
                  <div className="break-words">
                    Rute: {vendor.route_description}
                  </div>
                )}
                {vendor.stopping_points && (
                  <div className="break-words">
                    Titik berhenti: {vendor.stopping_points}
                  </div>
                )}
                <div>
                  Area layanan:{' '}
                  {formatVendorServiceRadius(vendor.service_radius_km)}
                </div>
                <div>
                  Jam operasional:{' '}
                  {getOperatingHoursText(vendor.operating_hours)}
                </div>
                <div>Lokasi: {getStoreLocationStatus(vendor.location)}</div>
                <div>Produk siap dipesan: {availableProductsCount}</div>
                <div>
                  Rating pelanggan:{' '}
                  {reviewSummary.count > 0
                    ? `${formatReviewScore(reviewSummary.average)} dari ${reviewSummary.count} ulasan`
                    : 'Belum ada ulasan'}
                </div>
                <div>
                  Promo:{' '}
                  {hasActivePromo ? 'Sedang aktif' : 'Tidak ada promo aktif'}
                </div>
                <div>
                  Pembayaran non-tunai:{' '}
                  {nonCashPaymentMethods.length > 0
                    ? nonCashPaymentMethods
                        .map((entry) => entry.label)
                        .join(', ')
                    : 'Belum disiapkan'}
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {isOwner ? (
                  <>
                    <button
                      onClick={() => navigate('/dashboard?tab=products')}
                      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-teal-800"
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
                        {favoriteBusy
                          ? 'Menyimpan...'
                          : isFavorite
                            ? 'Tersimpan di Favorit'
                            : 'Simpan ke Favorit'}
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/chat/${vendor.id}`)}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Chat Pedagang
                    </button>
                    <button
                      onClick={() =>
                        document
                          .getElementById('order-summary')
                          ?.scrollIntoView({ behavior: 'smooth' })
                      }
                      className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-teal-800"
                    >
                      Lihat Ringkasan Pesanan
                    </button>
                  </>
                )}
              </div>
            </div>

            {!isOwner && (
              <section
                ref={summaryRef}
                id="order-summary"
                className="scroll-mt-24 rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-slate-900">
                      Ringkasan Pesanan
                    </h2>
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
                  <div className="mt-3 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                    Pilih produk dari menu.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2.5 sm:space-y-3">
                    {visibleCartEntries.map((entry) => (
                      <div
                        key={entry.product.id}
                        className="min-w-0 rounded-2xl bg-slate-50 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="break-words font-medium text-slate-900">
                              {entry.product.name}
                            </div>
                            <div className="text-sm text-slate-500">
                              Jumlah: {entry.quantity}
                            </div>
                            {entry.note && (
                              <div className="mt-1 line-clamp-2 break-words text-sm text-slate-600">
                                Catatan: {entry.note}
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 text-right text-sm font-medium text-slate-700">
                            {formatPriceLabel(entry.product.price)}
                          </div>
                        </div>
                      </div>
                    ))}
                    {cartEntries.length > 3 && (
                      <button
                        type="button"
                        onClick={() =>
                          setShowAllCartItems((current) => !current)
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {showAllCartItems
                          ? 'Ringkas Item'
                          : `Lihat ${cartEntries.length - 3} item lainnya`}
                      </button>
                    )}

                    <div className="rounded-2xl border border-slate-200 p-3 text-sm text-slate-600 sm:p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          {cartTotals.types} produk, {cartTotals.items} item
                        </div>
                      </div>
                      <div className="mt-1 font-medium text-slate-900 sm:mt-2">
                        Total:{' '}
                        {cartTotals.estimatedTotal > 0
                          ? formatPriceLabel(cartTotals.estimatedTotal)
                          : 'Menyesuaikan harga'}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                      <div className="text-sm font-medium text-slate-900">
                        Pembayaran
                      </div>
                      <div
                        className={`mt-3 grid grid-cols-2 gap-2 ${
                          availablePaymentMethods.length >= 4
                            ? 'sm:grid-cols-2'
                            : availablePaymentMethods.length === 3
                              ? 'sm:grid-cols-3'
                              : availablePaymentMethods.length === 2
                                ? 'sm:grid-cols-2'
                                : 'sm:grid-cols-1'
                        }`}
                      >
                        {availablePaymentMethods.map((method) => (
                          <button
                            key={method}
                            type="button"
                            disabled={submittingOrder}
                            onClick={() => setPaymentMethod(method)}
                            className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${
                              paymentMethod === method
                                ? 'bg-teal-700 text-white'
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
                        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                          <div className="text-sm font-medium text-slate-900">
                            {selectedPaymentDetails.title}
                          </div>
                          {selectedPaymentDetails.ready ? (
                            <>
                              {selectedPaymentDetails.imageUrl && (
                                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
                                  <img
                                    src={selectedPaymentDetails.imageUrl}
                                    alt={selectedPaymentDetails.title}
                                    className="h-36 w-full rounded-xl object-contain sm:h-56"
                                  />
                                </div>
                              )}

                              {selectedPaymentDetails.rows.length > 0 && (
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  {selectedPaymentDetails.rows.map((row) => (
                                    <div
                                      key={row.label}
                                      className="rounded-2xl bg-slate-50 px-4 py-2.5 sm:py-3"
                                    >
                                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                                        {row.label}
                                      </div>
                                      <div className="mt-1 text-sm font-medium text-slate-900">
                                        {row.value}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {selectedPaymentDetails.note && (
                                <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                  {selectedPaymentDetails.note}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="mt-2 text-sm text-slate-500">
                              Detail metode ini belum tersedia.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                      <div className="text-sm font-medium text-slate-900">
                        Pengambilan
                      </div>
                      <div className="mt-2 text-sm text-slate-500">
                        {getFulfillmentTypeHint(fulfillmentType)}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFulfillmentType('self_pickup')}
                          disabled={submittingOrder}
                          className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${
                            fulfillmentType === 'self_pickup'
                              ? 'bg-teal-700 text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Ambil sendiri
                        </button>
                        <button
                          type="button"
                          onClick={() => setFulfillmentType('customer_courier')}
                          disabled={submittingOrder}
                          className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${
                            fulfillmentType === 'customer_courier'
                              ? 'bg-teal-700 text-white'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Kurir pelanggan
                        </button>
                      </div>

                      <label className="mt-3 block text-sm text-slate-700">
                        Nama pelanggan yang mengatur pengambilan
                        <input
                          value={pickupContact}
                          disabled={submittingOrder}
                          maxLength={100}
                          onChange={(event) =>
                            setPickupContact(event.target.value)
                          }
                          className="mt-1 w-full rounded-xl border p-3"
                          autoComplete="name"
                        />
                      </label>
                      {fulfillmentType === 'customer_courier' && (
                        <label className="mt-3 flex items-start gap-2 text-sm text-slate-600">
                          <input
                            type="checkbox"
                            checked={courierConsent}
                            disabled={submittingOrder}
                            onChange={(event) =>
                              setCourierConsent(event.target.checked)
                            }
                            className="mt-1"
                          />
                          <span>
                            Saya memesan dan membayar kurir di aplikasi lain
                            setelah barang siap. Kelilingku tidak menyediakan
                            kurir atau tarifnya.
                          </span>
                        </label>
                      )}
                      {fulfillmentType === 'self_pickup' && (
                        <p className="mt-3 text-sm text-slate-500">
                          Lokasi Anda saat ini dibaca saat memesan untuk
                          koordinasi pengambilan. Izinkan akses lokasi; Anda
                          tetap mengambil barang ke pedagang.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-medium text-slate-900">
                          Catatan Pesanan
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setShowCustomerNote((current) => !current)
                          }
                          disabled={submittingOrder}
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                        >
                          {showCustomerNote || customerNote
                            ? 'Tutup'
                            : 'Tambah'}
                        </button>
                      </div>
                      {showCustomerNote || customerNote ? (
                        <textarea
                          value={customerNote}
                          disabled={submittingOrder}
                          onChange={(event) =>
                            setCustomerNote(event.target.value)
                          }
                          maxLength={180}
                          rows={3}
                          className="mt-3 min-h-[84px] w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                          placeholder="Contoh: tunggu di depan rumah, tidak pedas, hubungi saat dekat"
                        />
                      ) : null}
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
                        <button
                          type="submit"
                          disabled={submittingOrder || storeQuery.isError}
                          className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:bg-emerald-300"
                        >
                          {submittingOrder
                            ? 'Mengirim Pesanan...'
                            : 'Kirim permintaan'}
                        </button>
                        <button
                          type="button"
                          onClick={clearCart}
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                        >
                          Kosongkan
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </section>
            )}
          </aside>

          <main className="order-1 min-w-0 space-y-3 lg:order-2 lg:space-y-4">
            <section className="rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5 lg:hidden">
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100 sm:h-16 sm:w-16">
                  {vendor.photo_url ? (
                    <img
                      src={vendor.photo_url}
                      alt={vendor.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xl font-semibold text-slate-500">
                      {(vendor.name || 'P')[0]}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h1 className="break-words text-xl font-semibold text-slate-900">
                    {vendor.name}
                  </h1>
                  <p className="mt-1 line-clamp-1 text-sm leading-6 text-slate-600 sm:line-clamp-2">
                    {vendor.description || 'Pedagang lokal siap melayani Anda.'}
                  </p>
                </div>
              </div>

              <details className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  {formatMobility(vendor.mobility_type)}
                  {vendor.service_area ? ` · ${vendor.service_area}` : ''}
                </summary>
                <p className="mt-2 break-words">
                  Rute:{' '}
                  {vendor.route_description || 'Koordinasikan melalui chat'}
                </p>
                <p className="mt-1 break-words">
                  Titik berhenti:{' '}
                  {vendor.stopping_points ||
                    'Usulkan titik sesuai rute pedagang'}
                </p>
              </details>
              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    vendorIsOnline
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {vendorIsOnline ? 'Sedang Online' : 'Sedang Offline'}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {formatVendorCategoryLabel(vendor.category_primary)}
                </span>
                {reviewSummary.count > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById('store-reviews')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                    className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
                  >
                    {formatReviewScore(reviewSummary.average)} •{' '}
                    {reviewSummary.count} ulasan
                  </button>
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
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => navigate('/dashboard?tab=products')}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-teal-800"
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
                <div className="mt-3 grid grid-cols-2 gap-2">
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
                      {favoriteBusy
                        ? 'Menyimpan...'
                        : isFavorite
                          ? 'Tersimpan'
                          : 'Favorit'}
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/chat/${vendor.id}`)}
                    className={`rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 ${
                      favoriteFeatureEnabled ? '' : 'col-span-2'
                    }`}
                  >
                    Chat
                  </button>
                </div>
              )}
            </section>

            {hasActivePromo && (
              <section className="rounded-[22px] border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-3 shadow-sm sm:rounded-[28px] sm:p-5">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-amber-700">
                  Promo
                </div>
                <div className="mt-1 line-clamp-2 text-base font-semibold text-slate-900 sm:mt-2 sm:line-clamp-none sm:text-lg">
                  {getVendorPromoText(vendor)}
                </div>
                <div className="mt-1 text-xs text-slate-600 sm:text-sm">
                  Berlaku sampai {formatVendorPromoExpiry(vendor)}
                </div>
              </section>
            )}

            <section className="rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">
                    Menu
                  </h2>
                  <p className="mt-1 hidden text-sm text-slate-500 sm:block">
                    Pilih dari produk yang memang tersedia agar order lebih
                    mudah diproses oleh pedagang.
                  </p>
                </div>
                {!isOwner && cartEntries.length > 0 && (
                  <button
                    onClick={() =>
                      document
                        .getElementById('order-summary')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                    className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700"
                  >
                    Lihat {cartTotals.items} Item Dipilih
                  </button>
                )}
              </div>

              <ProductList
                products={productCards}
                cart={cart}
                isOwner={isOwner}
                submittingOrder={submittingOrder}
                expandedProductNoteIds={expandedProductNoteIds}
                updateQuantity={updateQuantity}
                toggleProductNote={toggleProductNote}
                updateNote={updateNote}
              />
            </section>

            <section
              id="store-reviews"
              className="scroll-mt-24 rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">
                    Ulasan Pelanggan
                  </h2>
                  <p className="mt-1 hidden text-sm text-slate-500 sm:block">
                    Bagian ini membantu pelanggan baru melihat pengalaman
                    transaksi yang sudah selesai.
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:rounded-2xl sm:px-4 sm:py-3">
                  {reviewSummary.count > 0
                    ? `${formatReviewScore(reviewSummary.average)} dari ${reviewSummary.count} ulasan`
                    : 'Belum ada ulasan'}
                </div>
              </div>

              {storeQuery.data?.reviewsUnavailable ? (
                <p role="status" className="mt-3 text-sm text-slate-500">
                  Ulasan belum diperbarui. Data terakhir tetap ditampilkan jika
                  tersedia.
                </p>
              ) : null}
              {reviews.length === 0 && !storeQuery.data?.reviewsUnavailable ? (
                <div className="mt-3 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 sm:mt-4 sm:py-8">
                  Ulasan akan muncul setelah pelanggan menyelesaikan pesanan dan
                  memberi penilaian.
                </div>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {visibleReviews.map((review) => (
                    <article
                      key={review.id}
                      className="rounded-[20px] border border-slate-200 bg-slate-50 p-3 sm:rounded-[24px] sm:p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">
                            {review.buyer_name || 'Pelanggan'}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            Rating {formatReviewScore(review.rating)} •{' '}
                            {new Date(review.created_at).toLocaleDateString(
                              'id-ID',
                              {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric'
                              }
                            )}
                          </div>
                        </div>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                          {review.rating}/5
                        </span>
                      </div>

                      <div className="mt-3 line-clamp-4 text-sm leading-6 text-slate-600 sm:line-clamp-none">
                        {review.comment ||
                          'Pelanggan tidak menambahkan komentar tertulis.'}
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
                  {showAllReviews
                    ? 'Tampilkan lebih sedikit'
                    : `Lihat ${reviews.length - 2} ulasan lainnya`}
                </button>
              )}
            </section>
          </main>
        </div>
      </div>

      {!isOwner && cartEntries.length > 0 && !summaryVisible && (
        <div className="fixed inset-x-3 bottom-[calc(var(--bottom-nav-space)+0.5rem)] z-30 lg:hidden">
          <button
            aria-label="Buka ringkasan pesanan"
            onClick={() =>
              document
                .getElementById('order-summary')
                ?.scrollIntoView({ behavior: 'smooth' })
            }
            className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-teal-800 px-4 py-3 text-left text-white shadow-lg shadow-teal-900/15"
          >
            <span>
              <span className="block text-sm font-semibold">
                {cartTotals.items} item dipilih
              </span>
              <span className="block text-xs text-slate-300">
                Lihat ringkasan pesanan
              </span>
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
