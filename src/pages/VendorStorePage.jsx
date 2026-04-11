import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import { findOrCreateDirectChat, sendChatMessage } from '../lib/conversations'
import {
  buildOrderChatMessage,
  buildOrderItemsText,
  formatPriceLabel,
  getCartEntries,
  getCartTotals,
} from '../lib/orders'
import { supabase } from '../lib/supabase'
import { getVendorLocationLabel } from '../lib/vendor'

export default function VendorStorePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const [vendor, setVendor] = useState(null)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [cart, setCart] = useState({})
  const [submittingOrder, setSubmittingOrder] = useState(false)

  const isOwner = user?.id === id

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

        setVendor(vendorResult.data || null)
        setProducts(productsResult.data || [])
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

  const cartEntries = useMemo(() => getCartEntries(cart, products), [cart, products])
  const cartTotals = useMemo(() => getCartTotals(cartEntries), [cartEntries])

  function updateQuantity(productId, nextQuantity) {
    setCart((current) => {
      const quantity = Math.max(0, Number(nextQuantity) || 0)
      if (quantity === 0) {
        const { [productId]: _removed, ...rest } = current
        return rest
      }

      return {
        ...current,
        [productId]: {
          quantity,
          note: current[productId]?.note || '',
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

    setSubmittingOrder(true)
    try {
      const buyerName = user.user_metadata?.full_name || user.email || 'Pelanggan'
      const orderText = buildOrderItemsText(cartEntries)
      const directChat = await findOrCreateDirectChat(user.id, id)

      const { data: createdOrder, error } = await supabase
        .from('orders')
        .insert([{
          vendor_id: id,
          vendor_name: vendor?.name || 'Pedagang',
          buyer_id: user.id,
          buyer_name: buyerName,
          items: orderText,
          status: 'pending',
        }])
        .select()
        .single()

      if (error) throw error

      let successMessage = 'Pesanan berhasil dikirim dan chat dibuka untuk tindak lanjut'
      try {
        await sendChatMessage(directChat.id, user.id, buildOrderChatMessage({
          buyerName,
          entries: cartEntries,
          orderId: createdOrder?.id,
        }))
      } catch (messageError) {
        console.error('submitOrder.sendChatMessage', messageError)
        successMessage = 'Pesanan sudah masuk ke pedagang, tetapi ringkasan otomatis di chat belum terkirim.'
      }

      clearCart()
      toast.push(successMessage, { type: 'success' })
      navigate(`/chat/${vendor.id}`)
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
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:py-6">
        <section className="mb-4 overflow-hidden rounded-[28px] bg-slate-900 px-5 py-6 text-white shadow-xl shadow-slate-900/10 sm:px-6">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-slate-200">
              Profil Toko
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{vendor.name}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300 sm:text-base">
              Pilih produk yang tersedia, tambahkan catatan bila perlu, lalu kirim pesanan yang otomatis masuk ke chat dan panel pesanan pedagang.
            </p>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
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
                <span className={`mt-3 rounded-full px-3 py-1 text-xs font-medium ${
                  vendor.online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {vendor.online ? 'Sedang Online' : 'Sedang Offline'}
                </span>
              </div>
            </div>

            <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <h2 className="font-semibold text-slate-900">Info Toko</h2>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div>Lokasi: {getVendorLocationLabel(vendor.location)}</div>
                <div>Produk tersedia: {products.length}</div>
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
              <section id="order-summary" className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
                <h2 className="text-lg font-semibold text-slate-900">Ringkasan Pesanan</h2>
                <p className="mt-1 text-sm text-slate-500">Pilih produk di sebelah kanan, lalu kirim pesanan sekaligus buka chat.</p>

                {cartEntries.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                    Belum ada produk dipilih.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {cartEntries.map((entry) => (
                      <div key={entry.product.id} className="rounded-2xl bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-slate-900">{entry.product.name}</div>
                            <div className="text-sm text-slate-500">Jumlah: {entry.quantity}</div>
                            {entry.note && <div className="mt-1 text-sm text-slate-600">Catatan: {entry.note}</div>}
                          </div>
                          <div className="text-sm font-medium text-slate-700">{formatPriceLabel(entry.product.price)}</div>
                        </div>
                      </div>
                    ))}

                    <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
                      <div>{cartTotals.types} produk dipilih</div>
                      <div>{cartTotals.items} item total</div>
                      <div className="mt-1 font-medium text-slate-900">
                        Estimasi nilai menu: {cartTotals.estimatedTotal > 0 ? formatPriceLabel(cartTotals.estimatedTotal) : 'Menyesuaikan harga produk'}
                      </div>
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
                          disabled={submittingOrder}
                          className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:bg-emerald-300"
                        >
                          {submittingOrder ? 'Mengirim Pesanan...' : 'Kirim Pesanan & Buka Chat'}
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

          <main className="space-y-4">
            <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Menu Tersedia</h2>
                  <p className="mt-1 text-sm text-slate-500">Pilih dari produk yang memang tersedia agar order lebih mudah diproses oleh pedagang.</p>
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

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {products.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    Belum ada produk yang dipublikasikan.
                  </div>
                ) : (
                  products.map((product) => {
                    const quantity = cart[product.id]?.quantity || 0
                    const note = cart[product.id]?.note || ''

                    return (
                      <div key={product.id} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.name} className="h-44 w-full object-cover" />
                        ) : (
                          <div className="flex h-44 items-center justify-center bg-slate-100 text-sm text-slate-400">
                            Belum ada gambar
                          </div>
                        )}

                        <div className="space-y-3 p-4">
                          <div>
                            <div className="font-semibold text-slate-900">{product.name}</div>
                            <div className="mt-1 text-sm leading-6 text-slate-600">{product.description || 'Tanpa deskripsi'}</div>
                          </div>

                          <div className="text-sm font-medium text-slate-900">{formatPriceLabel(product.price)}</div>

                          {!isOwner && (
                            <div className="space-y-3 rounded-2xl bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-slate-700">Jumlah Pesanan</div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => updateQuantity(product.id, quantity - 1)}
                                    disabled={quantity === 0}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700 disabled:opacity-50"
                                  >
                                    -
                                  </button>
                                  <div className="min-w-8 text-center text-sm font-semibold text-slate-900">{quantity}</div>
                                  <button
                                    type="button"
                                    onClick={() => updateQuantity(product.id, quantity + 1)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {quantity > 0 && (
                                <textarea
                                  value={note}
                                  onChange={(event) => updateNote(product.id, event.target.value)}
                                  className="min-h-[88px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
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
          </main>
        </div>
      </div>

      {!isOwner && cartEntries.length > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-30 lg:hidden">
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
