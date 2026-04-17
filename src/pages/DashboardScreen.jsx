import React, { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ChatWorkspace from '../components/ChatWorkspace'
import VendorProductsManager from '../components/VendorProductsManager'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import { uploadImageFile } from '../lib/media'
import { getGeolocationErrorMessage } from '../lib/network'
import {
  formatOrderStatusLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatPriceLabel,
  getNextVendorStatusActions,
  getOrderStatusTone,
  isSchemaCompatibilityError,
} from '../lib/orders'
import { syncCurrentProfile } from '../lib/profiles'
import { supabase } from '../lib/supabase'
import {
  createVendorLocationPayload,
  getDisplayName,
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

function OrdersPanel({ currentUser, role }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)

  async function fetchOrders() {
    if (!currentUser || !role) return

    setLoading(true)
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
      toast.push(error.message || 'Gagal memuat pesanan', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!currentUser || !role) return undefined

    fetchOrders()

    const filter = role === 'vendor'
      ? `vendor_id=eq.${currentUser.id}`
      : `buyer_id=eq.${currentUser.id}`

    const channel = supabase
      .channel(`orders-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter }, () => {
        fetchOrders()
      })
      .subscribe()

    const intervalId = window.setInterval(() => {
      void fetchOrders()
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
      fetchOrders()
    } catch (error) {
      console.error('updateStatus', error)
      if (isSchemaCompatibilityError(error)) {
        toast.push('Database belum memakai workflow status terbaru. Jalankan migration foundation terlebih dahulu.', { type: 'error' })
        return
      }
      toast.push(error.message || 'Gagal mengubah status pesanan', { type: 'error' })
    }
  }

  if (loading) {
    return <div className="rounded-[28px] bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/80">Memuat pesanan...</div>
  }

  return (
    <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
      <div className="mb-4">
        <div>
          <h3 className="font-semibold text-slate-900">Pesanan</h3>
          <p className="text-sm text-slate-500">Pantau transaksi terbaru Anda dan lanjutkan komunikasi dari sini.</p>
        </div>
      </div>

      <div className="space-y-3">
        {orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Belum ada pesanan.
          </div>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="rounded-[24px] border border-slate-200 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium text-slate-900">
                    {role === 'vendor' ? (order.buyer_name || 'Pelanggan') : (order.vendor_name || 'Pedagang')}
                  </div>
                  {Array.isArray(order.order_items) && order.order_items.length > 0 ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-600">
                      {order.order_items.map((item) => (
                        <div key={item.id}>
                          {item.product_name_snapshot} x{item.quantity}
                          {item.item_note ? ` • ${item.item_note}` : ''}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{order.items || '-'}</div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-3 py-1">
                      {formatPaymentMethodLabel(order.payment_method)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1">
                      {formatPaymentStatusLabel(order.payment_status)}
                    </span>
                    {order.fulfillment_type && (
                      <span className="rounded-full bg-slate-100 px-3 py-1">
                        {order.fulfillment_type === 'delivery' ? 'Antar' : 'Titik temu'}
                      </span>
                    )}
                  </div>

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
                  <span className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide ${getOrderStatusTone(order.status)}`}>
                    {formatOrderStatusLabel(order.status)}
                  </span>

                  <button
                    onClick={() => navigate(`/chat/${role === 'vendor' ? order.buyer_id : order.vendor_id}`)}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
                  >
                    Buka Chat
                  </button>

                  {role === 'vendor' && getNextVendorStatusActions(order.status).map((action) => (
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

                  {role === 'customer' && order.status === 'pending' && (
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
          ))
        )}
      </div>
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
  const [form, setForm] = useState({ name: '', description: '', photo_url: '' })

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
              <textarea
                className="min-h-[120px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Deskripsi singkat toko"
              />
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
    const allowedTabs = ['products', 'chats', 'orders', 'profile']

    if (requestedTab && allowedTabs.includes(requestedTab)) {
      setActiveTab(requestedTab)
    }
  }, [location.search])

  useEffect(() => {
    if (!isVendor && activeTab === 'products') {
      setActiveTab('chats')
    }
  }, [activeTab, isVendor])

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
