import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/ToastProvider'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { getVendorLocationLabel } from '../lib/vendor'

function formatPrice(price) {
  if (price === null || typeof price === 'undefined') return 'Harga belum diatur'
  return `Rp ${Number(price).toLocaleString('id-ID')}`
}

export default function VendorStorePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const [vendor, setVendor] = useState(null)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [orderItems, setOrderItems] = useState('')
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

    return () => {
      active = false
    }
  }, [id, toast])

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

    if (!orderItems.trim()) {
      toast.push('Tulis detail pesanan terlebih dahulu', { type: 'error' })
      return
    }

    setSubmittingOrder(true)
    try {
      const payload = {
        vendor_id: id,
        vendor_name: vendor?.name || 'Pedagang',
        buyer_id: user.id,
        buyer_name: user.user_metadata?.full_name || user.email || 'Pelanggan',
        items: orderItems.trim(),
        status: 'pending',
      }

      const { error } = await supabase.from('orders').insert([payload])
      if (error) throw error

      setOrderItems('')
      toast.push('Pesanan berhasil dikirim ke pedagang', { type: 'success' })
      navigate('/dashboard?tab=orders')
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
      <div className="mx-auto max-w-5xl px-4 py-5 sm:py-6">
        <section className="mb-4 overflow-hidden rounded-[28px] bg-slate-900 px-5 py-6 text-white shadow-xl shadow-slate-900/10 sm:px-6">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-slate-200">
              Profil Toko
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{vendor.name}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300 sm:text-base">
              Lihat produk terbaru, cek status toko, lalu lanjutkan ke chat atau form pesanan tanpa perlu berpindah-pindah halaman.
            </p>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
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
                      onClick={() => document.getElementById('order')?.scrollIntoView({ behavior: 'smooth' })}
                      className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                    >
                      Buat Pesanan
                    </button>
                  </>
                )}
              </div>
            </div>
          </aside>

          <main className="space-y-4">
            <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
              <h2 className="text-xl font-semibold text-slate-900">Produk</h2>
              <p className="mt-1 text-sm text-slate-500">Daftar produk terbaru dari toko ini.</p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {products.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    Belum ada produk yang dipublikasikan.
                  </div>
                ) : (
                  products.map((product) => (
                    <div key={product.id} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="h-44 w-full object-cover" />
                      ) : (
                        <div className="flex h-44 items-center justify-center bg-slate-100 text-sm text-slate-400">
                          Belum ada gambar
                        </div>
                      )}

                      <div className="space-y-2 p-4">
                        <div className="font-semibold text-slate-900">{product.name}</div>
                        <div className="text-sm leading-6 text-slate-600">{product.description || 'Tanpa deskripsi'}</div>
                        <div className="text-sm font-medium text-slate-900">{formatPrice(product.price)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {!isOwner && (
              <section id="order" className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
                <h2 className="text-xl font-semibold text-slate-900">Buat Pesanan</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Tulis daftar barang atau catatan yang ingin Anda pesan.
                </p>

                {!user ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                    Anda perlu login terlebih dahulu untuk mengirim pesanan.
                  </div>
                ) : (
                  <form onSubmit={submitOrder} className="mt-4 space-y-3">
                    <textarea
                      className="min-h-[160px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                      value={orderItems}
                      onChange={(event) => setOrderItems(event.target.value)}
                      placeholder="Contoh: 2 nasi kuning, 1 es teh, kirim jam 7 malam"
                    />

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="submit"
                        disabled={submittingOrder}
                        className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:bg-emerald-300"
                      >
                        {submittingOrder ? 'Mengirim...' : 'Kirim Pesanan'}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/chat/${vendor.id}`)}
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                      >
                        Chat Dulu
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
