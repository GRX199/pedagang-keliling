import React, { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ChatWorkspace from '../components/ChatWorkspace'
import OrderStatusTimeline from '../components/OrderStatusTimeline'
import VendorProductsManager from '../components/VendorProductsManager'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import { uploadImageFile } from '../lib/media'
import { getGeolocationErrorMessage } from '../lib/network'
import {
  formatOrderStatusLabel,
  formatFulfillmentTypeLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatPriceLabel,
  getNextVendorStatusActions,
  getOrderStatusTone,
  isActiveOrderStatus,
  isHistoryOrderStatus,
  isSchemaCompatibilityError,
} from '../lib/orders'
import { syncCurrentProfile } from '../lib/profiles'
import { supabase } from '../lib/supabase'
import {
  buildOperatingHoursPayload,
  formatVendorCategoryLabel,
  formatVendorServiceMode,
  formatVendorServiceRadius,
  createVendorLocationPayload,
  getDisplayName,
  getOperatingHoursText,
  getVendorLocationLabel,
  getVendorLocationUpdatedAtLabel,
} from '../lib/vendor'

function TabButton({ id, active, onClick, children }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-medium transition ${
        active ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function OrdersSummaryCard({ label, value, hint, tone = 'default' }) {
  const toneClass = tone === 'primary'
    ? 'bg-slate-900 text-white'
    : tone === 'success'
      ? 'bg-emerald-50 text-slate-900 ring-1 ring-emerald-100'
      : 'bg-slate-50 text-slate-900 ring-1 ring-slate-200'

  const hintClass = tone === 'primary' ? 'text-slate-300' : 'text-slate-500'

  return (
    <div className={`rounded-[24px] p-4 ${toneClass}`}>
      <div className="text-xs font-medium uppercase tracking-[0.16em] opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className={`mt-1 text-sm ${hintClass}`}>{hint}</div>
    </div>
  )
}

function OrdersPanel({ currentUser, role }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const isVendor = role === 'vendor'
  const customerName = currentUser?.user_metadata?.full_name || currentUser?.email || 'Pelanggan'

  async function fetchOrders({ background = false, silent = false } = {}) {
    if (!currentUser || !role) return

    if (background) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    try {
      let query = supabase.from('orders').select('*').order('created_at', { ascending: false })
      query = role === 'vendor'
        ? query.eq('vendor_id', currentUser.id)
        : query.eq('buyer_id', currentUser.id)

      const { data, error } = await query
      if (error) throw error

      let nextOrders = data || []
      try {
        const orderIds = nextOrders.map((order) => order.id).filter(Boolean)
        if (orderIds.length > 0) {
          const { data: orderItems, error: orderItemsError } = await supabase
            .from('order_items')
            .select('*')
            .in('order_id', orderIds)
            .order('created_at', { ascending: true })

          if (orderItemsError) throw orderItemsError

          const itemsMap = (orderItems || []).reduce((accumulator, item) => {
            if (!accumulator[item.order_id]) accumulator[item.order_id] = []
            accumulator[item.order_id].push(item)
            return accumulator
          }, {})

          nextOrders = nextOrders.map((order) => ({
            ...order,
            order_items: itemsMap[order.id] || [],
          }))
        }
      } catch (orderItemsError) {
        if (!isSchemaCompatibilityError(orderItemsError)) {
          console.error('fetchOrders.orderItems', orderItemsError)
        }
      }

      setOrders(nextOrders)
    } catch (error) {
      console.error('fetchOrders', error)
      if (!silent) {
        toast.push(error.message || 'Gagal memuat pesanan', { type: 'error' })
      }
    } finally {
      if (background) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!currentUser || !role) return undefined

    void fetchOrders()

    const filter = role === 'vendor'
      ? `vendor_id=eq.${currentUser.id}`
      : `buyer_id=eq.${currentUser.id}`

    const channel = supabase
      .channel(`orders-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter }, () => {
        void fetchOrders({ background: true, silent: true })
      })
      .subscribe()

    const intervalId = window.setInterval(() => {
      void fetchOrders({ background: true, silent: true })
    }, 8000)

    return () => {
      window.clearInterval(intervalId)
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeOrdersChannel', error)
      }
    }
  }, [currentUser, role])

  async function updateStatus(orderId, status) {
    try {
      const { error } = await supabase.from('orders').update({ status }).eq('id', orderId)
      if (error) throw error
      toast.push('Status pesanan diperbarui', { type: 'success' })
      void fetchOrders({ background: true, silent: true })
    } catch (error) {
      console.error('updateStatus', error)
      if (isSchemaCompatibilityError(error)) {
        toast.push('Database belum memakai workflow status terbaru. Jalankan migration foundation terlebih dahulu.', { type: 'error' })
        return
      }
      toast.push(error.message || 'Gagal mengubah status pesanan', { type: 'error' })
    }
  }

  function renderOrderItems(order) {
    if (Array.isArray(order.order_items) && order.order_items.length > 0) {
      return (
        <div className="mt-2 space-y-1 text-sm text-slate-600">
          {order.order_items.map((item) => (
            <div key={item.id}>
              {item.product_name_snapshot} x{item.quantity}
              {item.item_note ? ` • ${item.item_note}` : ''}
            </div>
          ))}
        </div>
      )
    }

    return (
      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{order.items || '-'}</div>
    )
  }

  function renderOrderCard(order, variant = 'active') {
    const title = isVendor ? (order.buyer_name || 'Pelanggan') : (order.vendor_name || 'Pedagang')
    const isHighlighted = variant === 'active'

    return (
      <div
        key={order.id}
        className={`rounded-[24px] border p-4 transition ${
          isHighlighted
            ? 'border-slate-900/10 bg-white shadow-sm'
            : 'border-slate-200 bg-slate-50/70'
        }`}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium text-slate-900">{title}</div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide ${getOrderStatusTone(order.status)}`}>
                {formatOrderStatusLabel(order.status)}
              </span>
            </div>

            {renderOrderItems(order)}

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {formatPaymentMethodLabel(order.payment_method)}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {formatPaymentStatusLabel(order.payment_status)}
              </span>
              {order.fulfillment_type && (
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {formatFulfillmentTypeLabel(order.fulfillment_type)}
                </span>
              )}
            </div>

            {isHighlighted && (
              <div className="mt-3">
                <OrderStatusTimeline status={order.status} />
              </div>
            )}

            {(order.meeting_point_label || order.customer_note || Number(order.total_amount || 0) > 0) && (
              <div className="mt-3 space-y-1 text-sm text-slate-500">
                {order.meeting_point_label && <div>Titik temu: {order.meeting_point_label}</div>}
                {order.customer_note && <div>Catatan: {order.customer_note}</div>}
                {Number(order.total_amount || 0) > 0 && (
                  <div className="font-medium text-slate-700">
                    Total: {formatPriceLabel(order.total_amount)}
                  </div>
                )}
              </div>
            )}

            <div className="mt-2 text-xs text-slate-400">
              {order.created_at ? new Date(order.created_at).toLocaleString('id-ID') : '-'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigate(`/orders/${order.id}`)}
              className={`rounded-2xl px-3 py-2 text-sm font-medium ${
                isHighlighted
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              Lacak
            </button>
            <button
              onClick={() => navigate(`/chat/${isVendor ? order.buyer_id : order.vendor_id}?order=${order.id}`)}
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Buka Chat
            </button>

            {isVendor && getNextVendorStatusActions(order.status).map((action) => (
              <button
                key={action.value}
                onClick={() => updateStatus(order.id, action.value)}
                className={`rounded-2xl px-3 py-2 text-sm font-medium ${
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

            {!isVendor && order.status === 'pending' && (
              <button
                onClick={() => updateStatus(order.id, 'cancelled')}
                className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600"
              >
                Batalkan
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="rounded-[28px] bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/80">Memuat pesanan...</div>
  }

  const activeOrders = orders.filter((order) => isActiveOrderStatus(order.status))
  const historyOrders = orders.filter((order) => isHistoryOrderStatus(order.status))
  const pendingOrders = orders.filter((order) => order.status === 'pending')
  const completedOrders = orders.filter((order) => order.status === 'completed')
  const spotlightOrder = activeOrders[0] || orders[0] || null

  return (
    <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
      {!isVendor && (
        <section className="mb-5 overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-300">Beranda Pelanggan</div>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight">
                {`Halo, ${customerName.split('@')[0]}. Lanjutkan pesanan Anda tanpa kehilangan jejak.`}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Dashboard ini sekarang difokuskan untuk membantu Anda melihat order aktif lebih cepat, buka tracking saat dibutuhkan, lalu kembali ke peta saat ingin pesan lagi.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => navigate('/map')}
                  className="rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
                >
                  Buka Peta Pedagang
                </button>
                <button
                  onClick={() => navigate(spotlightOrder ? `/chat/${spotlightOrder.vendor_id}?order=${spotlightOrder.id}` : '/chat')}
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                >
                  {spotlightOrder ? 'Buka Chat Terakhir' : 'Buka Chat'}
                </button>
                <button
                  onClick={() => navigate('/dashboard?tab=profile')}
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                >
                  Profil Saya
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:w-[360px] lg:grid-cols-1">
              <div className="rounded-[22px] bg-white/10 p-4 ring-1 ring-white/10">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Aktif</div>
                <div className="mt-2 text-3xl font-semibold">{activeOrders.length}</div>
                <div className="mt-1 text-sm text-slate-300">Pesanan yang masih bisa dilacak atau dilanjutkan.</div>
              </div>
              <div className="rounded-[22px] bg-white/10 p-4 ring-1 ring-white/10">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Menunggu</div>
                <div className="mt-2 text-3xl font-semibold">{pendingOrders.length}</div>
                <div className="mt-1 text-sm text-slate-300">Order yang belum dikonfirmasi pedagang.</div>
              </div>
              <div className="rounded-[22px] bg-white/10 p-4 ring-1 ring-white/10">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Selesai</div>
                <div className="mt-2 text-3xl font-semibold">{completedOrders.length}</div>
                <div className="mt-1 text-sm text-slate-300">Riwayat pesanan yang sudah tuntas.</div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] bg-white/10 p-4 ring-1 ring-white/10">
            {spotlightOrder ? (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-300">Pesanan Terbaru</div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {spotlightOrder.vendor_name || 'Pedagang'}
                  </div>
                  <div className="mt-1 text-sm text-slate-200">
                    {formatOrderStatusLabel(spotlightOrder.status)}
                    {Number(spotlightOrder.total_amount || 0) > 0 ? ` • ${formatPriceLabel(spotlightOrder.total_amount)}` : ''}
                    {spotlightOrder.created_at ? ` • ${new Date(spotlightOrder.created_at).toLocaleString('id-ID')}` : ''}
                  </div>
                  <div className="mt-1 text-sm text-slate-300">
                    {spotlightOrder.meeting_point_label || 'Siap dibuka untuk tracking atau komunikasi lanjutan.'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => navigate(`/orders/${spotlightOrder.id}`)}
                    className="rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
                  >
                    Lacak Sekarang
                  </button>
                  <button
                    onClick={() => navigate(`/chat/${spotlightOrder.vendor_id}?order=${spotlightOrder.id}`)}
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                  >
                    Chat Pedagang
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-lg font-semibold text-white">Belum ada pesanan untuk dilanjutkan.</div>
                  <div className="mt-1 text-sm text-slate-300">
                    Mulai dari peta agar Anda bisa melihat pedagang yang online dan paling dekat lebih dulu.
                  </div>
                </div>
                <button
                  onClick={() => navigate('/map')}
                  className="rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
                >
                  Cari Pedagang
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="mb-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Pesanan</h3>
            <p className="text-sm text-slate-500">
              {isVendor
                ? 'Pantau order masuk, lanjutkan status, dan buka chat dari satu tempat.'
                : 'Pantau pesanan aktif lebih cepat, lalu buka tracking atau chat saat dibutuhkan.'}
            </p>
          </div>
          <div className="text-xs text-slate-400">
            {refreshing ? 'Menyegarkan data...' : 'Update berjalan di background'}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <OrdersSummaryCard
          label={isVendor ? 'Aktif Sekarang' : 'Pesanan Aktif'}
          value={activeOrders.length}
          hint={isVendor ? 'Perlu dipantau atau dilanjutkan statusnya.' : 'Masih berjalan dan siap dilacak.'}
          tone="primary"
        />
        <OrdersSummaryCard
          label={isVendor ? 'Menunggu Respon' : 'Menunggu Konfirmasi'}
          value={pendingOrders.length}
          hint={isVendor ? 'Segera cek agar pelanggan tidak menunggu lama.' : 'Pedagang belum memberi keputusan akhir.'}
          tone="default"
        />
        <OrdersSummaryCard
          label="Riwayat Selesai"
          value={completedOrders.length}
          hint={isVendor ? 'Order yang sudah selesai ditutup.' : 'Pesanan yang berhasil diselesaikan.'}
          tone="success"
        />
      </div>

      {orders.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
          <div>Belum ada pesanan.</div>
          <button
            onClick={() => navigate('/map')}
            className="mt-4 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
          >
            Buka Peta Pedagang
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {isVendor ? 'Order Aktif' : 'Pesanan Aktif'}
                </h4>
                <p className="text-sm text-slate-500">
                  {isVendor
                    ? 'Bagian ini diprioritaskan untuk order yang sedang berjalan.'
                    : 'Fokus ke order yang masih butuh tracking, chat, atau keputusan lanjutan.'}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {activeOrders.length} aktif
              </span>
            </div>

            {activeOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                {isVendor ? 'Tidak ada order aktif saat ini.' : 'Tidak ada pesanan aktif saat ini.'}
              </div>
            ) : (
              <div className="space-y-3">
                {activeOrders.map((order) => renderOrderCard(order, 'active'))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Riwayat</h4>
                <p className="text-sm text-slate-500">
                  {isVendor
                    ? 'Order yang selesai, dibatalkan, atau ditolak tetap bisa dibuka kembali saat diperlukan.'
                    : 'Riwayat membantu Anda melihat transaksi yang sudah selesai atau tidak lanjut.'}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {historyOrders.length} riwayat
              </span>
            </div>

            {historyOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                Belum ada riwayat pesanan.
              </div>
            ) : (
              <div className="space-y-3">
                {historyOrders.map((order) => renderOrderCard(order, 'history'))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function ProfilePanel({ currentUser, role, onVendorProfileSaved }) {
  const { refreshAuth } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingLocation, setSavingLocation] = useState(false)
  const [photoFile, setPhotoFile] = useState(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    photo_url: '',
    category_primary: '',
    service_radius_km: '',
    operating_hours_text: '',
    service_mode: 'meetup',
  })

  useEffect(() => {
    if (!currentUser) return undefined

    let active = true

    async function loadProfile() {
      try {
        if (role === 'vendor') {
          const { data, error } = await supabase.from('vendors').select('*').eq('id', currentUser.id).maybeSingle()
          if (error) throw error
          if (!active) return

          const nextProfile = data || null
          setProfile(nextProfile)
          setForm({
            name: nextProfile?.name || '',
            description: nextProfile?.description || '',
            photo_url: nextProfile?.photo_url || '',
            category_primary: nextProfile?.category_primary || '',
            service_radius_km: nextProfile?.service_radius_km ?? '',
            operating_hours_text: getOperatingHoursText(nextProfile?.operating_hours) === 'Belum diatur'
              ? ''
              : getOperatingHoursText(nextProfile?.operating_hours),
            service_mode: nextProfile?.service_mode || 'meetup',
          })
          onVendorProfileSaved?.(nextProfile)
          return
        }

        if (!active) return

        const nextProfile = {
          id: currentUser.id,
          name: currentUser.user_metadata?.full_name || '',
          email: currentUser.email,
          photo_url: currentUser.user_metadata?.avatar_url || '',
          description: '',
        }

        setProfile(nextProfile)
        setForm({
          name: nextProfile.name,
          description: '',
          photo_url: nextProfile.photo_url,
          category_primary: '',
          service_radius_km: '',
          operating_hours_text: '',
          service_mode: 'meetup',
        })
      } catch (error) {
        console.error('loadProfile', error)
        toast.push(error.message || 'Gagal memuat profil', { type: 'error' })
      }
    }

    loadProfile()

    return () => {
      active = false
    }
  }, [currentUser, onVendorProfileSaved, role, toast])

  async function saveProfile() {
    if (!currentUser) return

    setSaving(true)
    try {
      let photoUrl = form.photo_url
      if (photoFile) {
        photoUrl = await uploadImageFile({
          file: photoFile,
          vendorId: currentUser.id,
          folder: 'profiles',
        })
      }

      if (role === 'vendor') {
        const payload = {
          name: form.name.trim() || 'Pedagang',
          description: form.description.trim() || null,
          photo_url: photoUrl,
          category_primary: form.category_primary.trim() || null,
          service_radius_km: form.service_radius_km === '' ? null : Number(form.service_radius_km),
          operating_hours: buildOperatingHoursPayload(form.operating_hours_text),
          service_mode: form.service_mode || 'meetup',
        }

        const { data, error } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', currentUser.id)
          .select()
          .maybeSingle()

        if (error) throw error
        setProfile(data || null)
        onVendorProfileSaved?.(data || null)
      } else {
        const { error } = await supabase.auth.updateUser({
          data: {
            full_name: form.name.trim(),
            avatar_url: photoUrl,
          },
        })

        if (error) throw error
        await syncCurrentProfile({
          ...currentUser,
          user_metadata: {
            ...currentUser.user_metadata,
            full_name: form.name.trim(),
            avatar_url: photoUrl,
          },
        }, 'customer')
        await refreshAuth()
        setProfile((current) => ({ ...current, name: form.name.trim(), photo_url: photoUrl }))
      }

      toast.push('Profil berhasil diperbarui', { type: 'success' })
      setEditing(false)
      setPhotoFile(null)
      setForm((current) => ({ ...current, photo_url: photoUrl }))
    } catch (error) {
      console.error('saveProfile', error)
      if (role === 'vendor' && isSchemaCompatibilityError(error)) {
        toast.push('Database belum memuat field operasional toko terbaru. Jalankan phase1-foundation.sql lalu coba lagi.', { type: 'error' })
        return
      }
      toast.push(error.message || 'Gagal menyimpan profil', { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function saveCurrentLocation() {
    if (!currentUser || role !== 'vendor') return
    if (!navigator.geolocation) {
      toast.push('Browser ini tidak mendukung akses lokasi', { type: 'error' })
      return
    }

    setSavingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const payload = createVendorLocationPayload({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          })

          const { data, error } = await supabase
            .from('vendors')
            .update({ location: payload })
            .eq('id', currentUser.id)
            .select('*')
            .maybeSingle()

          if (error) throw error

          setProfile(data || null)
          onVendorProfileSaved?.(data || null)
          toast.push('Lokasi toko berhasil diperbarui', { type: 'success' })
        } catch (error) {
          console.error('saveCurrentLocation', error)
          toast.push(error.message || 'Gagal menyimpan lokasi toko', { type: 'error' })
        } finally {
          setSavingLocation(false)
        }
      },
      (error) => {
        setSavingLocation(false)
        toast.push(getGeolocationErrorMessage(error), { type: 'error' })
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
      }
    )
  }

  if (!profile) {
    return <div className="rounded-2xl bg-white p-4 text-sm text-gray-500 shadow-sm ring-1 ring-gray-100">Memuat profil...</div>
  }

  return (
    <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-slate-100">
          {profile.photo_url ? (
            <img src={profile.photo_url} alt="avatar" className="h-full w-full object-cover" />
          ) : (
            <div className="text-xl font-semibold text-slate-500">{(profile.name || 'U')[0]}</div>
          )}
        </div>

        <div>
          <div className="font-semibold text-slate-900">{profile.name || profile.email}</div>
          <div className="text-sm text-slate-500">{role === 'vendor' ? 'Pedagang' : 'Pelanggan'}</div>
        </div>
      </div>

      <div className="mt-4">
        {!editing ? (
          <>
            <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              {profile.description || 'Belum ada deskripsi profil.'}
            </div>

            {role === 'vendor' && (
              <div className="mt-4 rounded-2xl bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-4 ring-1 ring-emerald-100">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Lokasi Toko</div>
                    <div className="mt-1 text-sm text-slate-600">{getVendorLocationLabel(profile.location)}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Sinkron terakhir: {getVendorLocationUpdatedAtLabel(profile.location)}
                    </div>
                  </div>
                  <button
                    onClick={saveCurrentLocation}
                    disabled={savingLocation}
                    className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-70"
                  >
                    {savingLocation ? 'Memperbarui...' : 'Gunakan Lokasi Saat Ini'}
                  </button>
                </div>

                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={() => navigate('/map')}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Buka Peta
                  </button>
                  <button
                    onClick={() => navigate('/dashboard?tab=products')}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Lihat Produk
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Verifikasi</div>
                    <div className="mt-1 font-medium text-slate-900">{profile.is_verified ? 'Terverifikasi' : 'Belum diverifikasi'}</div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Kategori Utama</div>
                    <div className="mt-1 font-medium text-slate-900">{formatVendorCategoryLabel(profile.category_primary)}</div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Area Layanan</div>
                    <div className="mt-1 font-medium text-slate-900">{formatVendorServiceRadius(profile.service_radius_km)}</div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Metode Layanan</div>
                    <div className="mt-1 font-medium text-slate-900">{formatVendorServiceMode(profile.service_mode)}</div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Jam Operasional</div>
                    <div className="mt-1 text-sm leading-6 text-slate-700">{getOperatingHoursText(profile.operating_hours)}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4">
              <button
                onClick={() => setEditing(true)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Edit Profil
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nama toko atau nama pengguna"
            />

            {role === 'vendor' && (
              <>
                <textarea
                  className="min-h-[120px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Deskripsi singkat toko"
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    value={form.category_primary}
                    onChange={(event) => setForm((current) => ({ ...current, category_primary: event.target.value }))}
                    placeholder="Kategori utama, misalnya bakso atau sayur"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    value={form.service_radius_km}
                    onChange={(event) => setForm((current) => ({ ...current, service_radius_km: event.target.value }))}
                    placeholder="Radius layanan (km)"
                  />
                </div>

                <select
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={form.service_mode}
                  onChange={(event) => setForm((current) => ({ ...current, service_mode: event.target.value }))}
                >
                  <option value="meetup">Titik temu</option>
                  <option value="delivery">Antar ke pelanggan</option>
                  <option value="both">Antar dan titik temu</option>
                </select>

                <textarea
                  className="min-h-[96px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={form.operating_hours_text}
                  onChange={(event) => setForm((current) => ({ ...current, operating_hours_text: event.target.value }))}
                  placeholder="Contoh: Senin-Sabtu 07.00-12.00, Minggu libur"
                />
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700">Ganti Foto</label>
              <input
                type="file"
                accept="image/*"
                className="mt-2"
                onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                disabled={saving}
                onClick={saveProfile}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-400"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setPhotoFile(null)
                  setForm({
                    name: profile.name || '',
                    description: profile.description || '',
                    photo_url: profile.photo_url || '',
                    category_primary: profile.category_primary || '',
                    service_radius_km: profile.service_radius_km ?? '',
                    operating_hours_text: getOperatingHoursText(profile.operating_hours) === 'Belum diatur'
                      ? ''
                      : getOperatingHoursText(profile.operating_hours),
                    service_mode: profile.service_mode || 'meetup',
                  })
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DashboardScreen() {
  const { user, role, loading } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState('products')
  const [vendorProfile, setVendorProfile] = useState(null)

  const isVendor = role === 'vendor' || user?.user_metadata?.is_vendor === true
  const handleVendorProfileSaved = useCallback((profile) => {
    setVendorProfile(profile)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const requestedTab = params.get('tab')
    const allowedTabs = isVendor
      ? ['products', 'chats', 'orders', 'profile']
      : ['chats', 'orders', 'profile']

    if (requestedTab && allowedTabs.includes(requestedTab)) {
      setActiveTab(requestedTab)
      return
    }

    if (!requestedTab) {
      setActiveTab(isVendor ? 'products' : 'orders')
    }
  }, [isVendor, location.search])

  useEffect(() => {
    if (!user || !isVendor) {
      setVendorProfile(null)
      return undefined
    }

    let active = true

    async function loadVendorProfile() {
      try {
        const { data, error } = await supabase.from('vendors').select('*').eq('id', user.id).maybeSingle()
        if (error) throw error
        if (active) setVendorProfile(data || null)
      } catch (error) {
        console.error('loadVendorProfile', error)
        if (active) toast.push(error.message || 'Gagal memuat profil toko', { type: 'error' })
      }
    }

    loadVendorProfile()

    return () => {
      active = false
    }
  }, [isVendor, toast, user])

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Memuat dashboard...</div>
  }

  const displayName = isVendor
    ? getDisplayName(vendorProfile?.name || user?.user_metadata?.full_name || user?.email, 'Pedagang')
    : getDisplayName(user?.user_metadata?.full_name || user?.email, 'Pelanggan')

  const avatarUrl = isVendor
    ? (vendorProfile?.photo_url || user?.user_metadata?.avatar_url)
    : user?.user_metadata?.avatar_url

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:py-6">
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xl">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
                  ) : (
                    <div className="font-semibold text-slate-500">{displayName[0]}</div>
                  )}
                </div>

                <div>
                  <div className="font-semibold text-slate-900">{displayName}</div>
                  <div className="text-xs text-slate-500">{user?.email}</div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  isVendor ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'
                }`}>
                  {isVendor ? 'Mode Pedagang' : 'Mode Pelanggan'}
                </span>
              </div>
            </div>

            <nav className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {isVendor && <TabButton id="products" active={activeTab === 'products'} onClick={setActiveTab}>Produk</TabButton>}
                <TabButton id="chats" active={activeTab === 'chats'} onClick={setActiveTab}>Chat</TabButton>
                <TabButton id="orders" active={activeTab === 'orders'} onClick={setActiveTab}>Pesanan</TabButton>
                <TabButton id="profile" active={activeTab === 'profile'} onClick={setActiveTab}>Profil</TabButton>
              </div>

              <p className="mt-3 text-sm leading-6 text-slate-500">Gunakan menu ini untuk berpindah antar fitur dengan cepat.</p>
            </nav>
          </aside>

          <main className="space-y-4">
            <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold text-slate-900">
                    {activeTab === 'products' && 'Produk Saya'}
                    {activeTab === 'chats' && 'Percakapan'}
                    {activeTab === 'orders' && 'Pesanan'}
                    {activeTab === 'profile' && 'Profil Saya'}
                  </h1>
                  <p className="text-sm leading-6 text-slate-500">
                    {activeTab === 'products' && 'Kelola katalog produk dan foto dagangan Anda.'}
                    {activeTab === 'chats' && 'Balas pesan dari pelanggan atau pedagang lain.'}
                    {activeTab === 'orders' && 'Pantau transaksi terbaru dan ubah statusnya.'}
                    {activeTab === 'profile' && 'Perbarui identitas akun dan tampilan profil.'}
                  </p>
                </div>
              </div>
            </div>

            {activeTab === 'products' && isVendor && <VendorProductsManager />}
            {activeTab === 'chats' && <ChatWorkspace embedded />}
            {activeTab === 'orders' && <OrdersPanel currentUser={user} role={role} />}
            {activeTab === 'profile' && (
              <ProfilePanel currentUser={user} role={role} onVendorProfileSaved={handleVendorProfileSaved} />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
