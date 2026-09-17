import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/ToastProvider'
import { supabase } from '../lib/supabase'
import { saveOrderChange } from '../lib/order-mutations'
import { formatFulfillmentTypeLabel, formatOrderStatusLabel, formatPaymentMethodLabel, formatPaymentStatusLabel, formatPriceLabel, formatRequestedFulfillmentLabel, getBuyerPaymentActions, getNextVendorStatusActions, getOrderOperationalNotice, getOrderPaymentDetails, getPaymentGuidance, getVendorPaymentActions } from '../lib/orders'
import { getVendorPaymentMethodDetails } from '../lib/vendor'
import OrderStatusTimeline from '../components/OrderStatusTimeline'
import OrderReviewComposer from '../components/OrderReviewComposer'
import PickupLocationMap from '../components/PickupLocationMap'

const panel = 'min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4'
const button = 'min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium disabled:opacity-50'

export default function PickupTrackingPage({ initialOrder }) {
  const { user } = useAuth()
  const toast = useToast()
  const [order, setOrder] = useState(initialOrder)
  const [vendor, setVendor] = useState(null)
  const [review, setReview] = useState(null)
  const [items, setItems] = useState([])
  const [code, setCode] = useState('')
  const [enteredCode, setEnteredCode] = useState('')
  const [pointDraft, setPointDraft] = useState(null)
  const [collectorDraft, setCollectorDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const lock = useRef(false)
  const request = useRef(0)
  const mounted = useRef(true)
  const buyer = order.buyer_id === user?.id
  const merchant = order.vendor_id === user?.id
  const active = ['pending', 'accepted', 'ready'].includes(order.status)
  const payment = getVendorPaymentMethodDetails(getOrderPaymentDetails(order, vendor), order.payment_method)

  async function refresh() {
    const version = ++request.current
    try {
      const [o, v, i, r, secret] = await Promise.all([
        supabase.from('orders').select('*').eq('id', initialOrder.id).single(),
        supabase.from('vendors').select('*').eq('id', initialOrder.vendor_id).maybeSingle(),
        supabase.from('order_items').select('*').eq('order_id', initialOrder.id).order('created_at'),
        supabase.from('reviews').select('*').eq('order_id', initialOrder.id).maybeSingle(),
        buyer ? supabase.from('pickup_codes').select('code').eq('order_id', initialOrder.id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      if (!mounted.current || version !== request.current) return
      for (const result of [o, v, i, r, secret]) if (result.error) throw result.error
      setOrder(o.data); setVendor(v.data); setItems(i.data || []); setReview(r.data); setCode(secret.data?.code || '')
      setLoadError('')
    } catch {
      if (mounted.current && version === request.current) {
        setLoadError('Pembaruan tertunda. Periksa koneksi sebelum melakukan aksi.')
        setVendor(null)
      }
    }
  }

  useEffect(() => {
    mounted.current = true
    void refresh()
    const channel = supabase.channel(`pickup-${initialOrder.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${initialOrder.id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors', filter: `id=eq.${initialOrder.vendor_id}` }, () => void refresh())
      .subscribe()
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void refresh() }
    const timer = window.setInterval(visibleRefresh, 15000)
    document.addEventListener('visibilitychange', visibleRefresh)
    return () => { mounted.current = false; request.current += 1; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibleRefresh); void supabase.removeChannel(channel) }
  }, [initialOrder.id, user?.id])

  async function run(action) {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try {
      const updated = await action()
      if (!mounted.current) return
      request.current += 1
      setOrder(updated)
      setPointDraft(null); setCollectorDraft(null); setEnteredCode('')
      toast.push('Pesanan diperbarui', { type: 'success' })
    } catch (error) {
      if (mounted.current) toast.push(error.message || 'Perubahan belum tersimpan.', { type: 'error' })
    } finally {
      if (mounted.current) { await refresh(); setBusy(false) }
      lock.current = false
    }
  }

  function change(field, value) { return run(() => saveOrderChange(supabase, order, field, value, user?.id)) }
  async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, { target_order_id: order.id, ...args })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    const updated = data?.order || data
    if (!updated?.id) throw new Error('Perubahan belum terkonfirmasi. Periksa status pesanan.')
    return updated
  }

  return <main className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-5">
    <header className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-xs text-slate-500">Pengambilan #{order.id.slice(0, 8)}</p><h1 className="break-words text-xl font-semibold">{formatOrderStatusLabel(order)}</h1><p className="break-words text-sm text-slate-600">{buyer ? order.vendor_name : order.buyer_name}</p></div>
      <Link className={button} to="/dashboard?tab=orders">Pesanan</Link>
    </header>
    {loadError && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">{loadError}</p>}
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <section className={panel}>
          <OrderStatusTimeline status={order.status} serviceFlow={order.service_flow} />
          {active && <p className="text-sm text-slate-600">{getOrderOperationalNotice(order, merchant ? 'vendor' : 'customer')}</p>}
          <div className="flex flex-wrap gap-2">
            {merchant && getNextVendorStatusActions(order).map(action => <button key={action.value} className={`${button} ${action.value === 'rejected' ? 'text-rose-700' : 'bg-teal-700 text-white'}`} disabled={busy || !!loadError} onClick={() => change('status', action.value)}>{action.label}</button>)}
            {buyer && order.status === 'pending' && <button className={`${button} text-rose-700`} disabled={busy || !!loadError} onClick={() => change('status', 'cancelled')}>Batalkan permintaan</button>}
            {active && <Link className={button} to={`/chat/${buyer ? order.vendor_id : order.buyer_id}?order=${order.id}`}>Chat {buyer ? 'pedagang' : 'pelanggan'}</Link>}
          </div>
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{order.status === 'pending' ? 'Usulan titik pengambilan' : 'Titik pengambilan'}</h2>
          <p className="break-words">{order.meeting_point_label}</p>
          <p className="text-sm text-slate-600">{formatFulfillmentTypeLabel(order.fulfillment_type)}{order.point_confirmed_at ? ' · Disetujui pedagang' : ''}</p>
          {order.requested_fulfillment_at && <p className="text-sm">Waktu usulan: {formatRequestedFulfillmentLabel(order.requested_fulfillment_at)}</p>}
          {buyer && order.status === 'pending' && <details><summary className="cursor-pointer py-2 text-sm text-teal-800">Ubah usulan titik</summary>
            <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void run(() => rpc('update_pickup_details', { target_point: pointDraft ?? order.meeting_point_label, expected_point: order.meeting_point_label })) }}>
              <label className="block text-sm">Patokan titik<input required maxLength={240} value={pointDraft ?? order.meeting_point_label} onChange={event => setPointDraft(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label>
              <p className="text-xs text-slate-500">Mengubah patokan menghapus pin lama. Pilih titik yang sesuai rute pedagang.</p><button className={button} disabled={busy || !!loadError}>Simpan usulan</button>
            </form>
          </details>}
          {['accepted', 'ready'].includes(order.status) && <p className="text-xs text-slate-500">Titik dikunci setelah persetujuan. Jika ada kendala, hubungi pihak lain lewat chat; jangan berpindah sepihak.</p>}
        </section>
        {order.status === 'ready' && <section className={panel}>
          <h2 className="font-semibold">Serah terima barang</h2>
          <p className="break-words text-sm">Pengambil: {order.collector_name || 'Belum diisi pelanggan'}</p>
          {buyer && <>
            {order.fulfillment_type === 'customer_courier' && <p className="text-sm text-slate-600">Pesan kurir melalui aplikasi lain, lalu isi nama pengambil di sini. Biaya kurir di luar total barang; tidak ada pelacakan kurir di Kelilingku.</p>}
            <form className="space-y-2" onSubmit={event => { event.preventDefault(); void run(() => rpc('update_pickup_details', { target_collector: collectorDraft ?? order.collector_name ?? '' })) }}>
              <label className="block text-sm">Nama pengambil<input required maxLength={100} value={collectorDraft ?? order.collector_name ?? ''} onChange={event => setCollectorDraft(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label><button className={button} disabled={busy || !!loadError}>Simpan nama</button>
            </form>
            {code && <details><summary className="cursor-pointer py-2 font-medium text-teal-800">Lihat kode pengambilan</summary><p className="my-2 break-all rounded-xl bg-teal-50 p-3 font-mono text-xl tracking-widest">{code}</p><p className="text-xs text-slate-600">Berikan kode hanya kepada pengambil yang ditunjuk. Pedagang memasukkannya ketika barang diserahkan.</p></details>}
          </>}
          {merchant && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void run(() => rpc('confirm_pickup_handover', { target_code: enteredCode })) }}>
            <label className="block text-sm">Kode dari pengambil<input required minLength={10} maxLength={10} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={enteredCode} onChange={event => setEnteredCode(event.target.value.toUpperCase())} className="mt-1 w-full rounded-xl border p-3 font-mono" /></label>
            <button className={`${button} bg-teal-700 text-white`} disabled={busy || !!loadError || order.payment_status !== 'paid' || !order.collector_name}>Konfirmasi serah terima</button>
          </form>}
        </section>}
        {order.status === 'completed' && <section className={panel}><OrderReviewComposer order={order} existingReview={review} viewerId={user?.id} buyerName={order.buyer_name} compact onSaved={setReview} /></section>}
      </div>
      <aside className="min-w-0 space-y-4">
        <section className={panel}>
          <h2 className="font-semibold">Pembayaran barang</h2><p className="text-xl font-semibold">{formatPriceLabel(order.total_amount)}</p>
          <p className="text-sm">{formatPaymentMethodLabel(order.payment_method)} · {formatPaymentStatusLabel(order.payment_status)}</p>
          <p className="text-sm text-slate-600">{getPaymentGuidance(order, merchant ? 'vendor' : 'customer')}</p>
          {order.payment_method !== 'cod' && ['accepted', 'ready'].includes(order.status) && payment.ready && <details><summary className="cursor-pointer py-2 text-sm text-teal-800">Detail pembayaran</summary>
            {payment.imageUrl && <img src={payment.imageUrl} alt="QRIS pedagang" className="my-3 max-h-64 w-full object-contain" />}
            {payment.rows.map(row => <p key={row.label} className="my-2 break-all text-sm"><span className="text-slate-500">{row.label}: </span>{row.value}</p>)}
            {payment.note && <p className="break-words text-sm">{payment.note}</p>}
          </details>}
          <div className="flex flex-wrap gap-2">{(merchant ? getVendorPaymentActions(order) : getBuyerPaymentActions(order)).map(action => <button className={button} key={action.value} disabled={busy || !!loadError} onClick={() => change('payment_status', action.value)}>{action.label}</button>)}</div>
        </section>
        <details className={panel}><summary className="cursor-pointer font-semibold">Rincian barang ({items.length})</summary>
          {items.map(item => <div key={item.id} className="break-words border-t py-2 text-sm"><p>{item.product_name_snapshot} x {item.quantity}</p><p>{formatPriceLabel(item.line_total)}</p>{item.item_note && <p className="text-slate-600">{item.item_note}</p>}</div>)}
          {order.customer_note && <p className="break-words text-sm">Catatan: {order.customer_note}</p>}
        </details>
      </aside>
      {active && <div className="min-w-0 lg:col-span-2"><PickupLocationMap vendor={vendor} point={order.meeting_point_location} /></div>}
    </div>
  </main>
}
