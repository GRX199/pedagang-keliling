// Developer-only fixture. The production bundle never imports this module.
const params = new URLSearchParams(location.search)
export const user = { id: params.get('role') === 'vendor' ? 'vendor' : 'buyer' }
export let fixtureOrder = {
  id: '00000000-1111-2222-3333-444444444444', vendor_id: 'vendor', buyer_id: 'buyer',
  vendor_name: 'Pak Sayur Keliling Tikala', buyer_name: 'Ani', service_flow: 'pickup_v1',
  status: params.get('status') || 'pending', fulfillment_type: params.get('method') || 'customer_courier',
  meeting_point_label: 'Gerbang pasar Tikala, di samping pos dekat jalan utama',
  meeting_point_location: { lat: 1.474, lng: 124.846 }, payment_method: 'bank_transfer',
  payment_status: params.get('payment') || 'unpaid', total_amount: 15000, pickup_contact_name: 'Ani',
  collector_name: null, vendor_payment_details_snapshot: { bank_account_number: '123456789', bank_name: 'Bank Contoh', bank_account_name: 'Pak Sayur' },
}
const vendor = { id: 'vendor', name: 'Pak Sayur', online: true, is_verified: true, mobility_type: 'walking', service_area: 'Tikala', route_description: 'Pasar ke kantor kelurahan', stopping_points: 'Gerbang pasar', location: { lat: 1.475, lng: 124.849 }, last_seen_at: new Date().toISOString() }
const listeners = new Set()
window.pickupFixture = {
  updates: 0,
  refresh() { for (const listener of listeners) listener() },
  offline() { vendor.online = false; this.refresh() },
  stale() { vendor.last_seen_at = new Date(Date.now() - 130000).toISOString(); this.refresh() },
}
export const supabase = {
  channel() {
    const local = []
    return { on(_event, _filter, handler) { local.push(handler); listeners.add(handler); return this }, subscribe() { return this }, unsubscribe() { for (const listener of local) listeners.delete(listener) } }
  },
  removeChannel(channel) { channel.unsubscribe() },
  from(table) {
    let mutation
    let single = false
    const query = {
      select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
      update(value) { mutation = value; return this },
      maybeSingle() { single = true; return this.result() }, single() { single = true; return this.result() },
      then(resolve, reject) { return this.result().then(resolve, reject) },
      result() {
        if (mutation) { fixtureOrder = { ...fixtureOrder, ...mutation }; window.pickupFixture.updates++ }
        const data = table === 'orders' ? { ...fixtureOrder }
          : table === 'vendors' ? { ...vendor }
          : table === 'pickup_codes' ? (fixtureOrder.status === 'ready' ? { code: 'A1B2C3D4E5' } : null)
          : table === 'order_items' ? [{ id: 'item', product_name_snapshot: 'Tomat segar', quantity: 3, line_total: 15000 }]
          : table === 'products' ? [{ id: 'product', name: 'Tomat segar', vendor_id: 'vendor', price: 5000, stock: 10, reserved_stock: 0, is_available: true }]
          : single ? null : []
        return Promise.resolve({ data, error: null })
      },
    }
    return query
  },
  async rpc(name, args) {
    if (name === 'create_pickup_order') {
      window.pickupFixture.checkout = args
      fixtureOrder = { ...fixtureOrder, status: 'pending', fulfillment_type: args.target_fulfillment_type, meeting_point_label: args.target_meeting_point_label }
    } else if (name === 'update_pickup_details') {
      fixtureOrder = { ...fixtureOrder, ...(args.target_point ? { meeting_point_label: args.target_point, meeting_point_location: null } : { collector_name: args.target_collector }) }
    } else if (name === 'confirm_pickup_handover') {
      if (args.target_code !== 'A1B2C3D4E5') return { data: { error: 'Kode tidak cocok.' }, error: null }
      fixtureOrder = { ...fixtureOrder, status: 'completed' }
    }
    window.pickupFixture.updates++
    return { data: { ...fixtureOrder }, error: null }
  },
}
