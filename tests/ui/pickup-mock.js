// Developer-only fixture. The production bundle never imports this module.
const params = new URLSearchParams(location.search)
export const user = { id: params.get('role') === 'vendor' ? 'vendor' : 'buyer', email: 'fixture@local.test', user_metadata: { full_name: 'Ani' } }
export let fixtureOrder = {
  id: '00000000-1111-2222-3333-444444444444', vendor_id: 'vendor', buyer_id: 'buyer',
  vendor_name: 'Pak Sayur Keliling Tikala', buyer_name: 'Ani', service_flow: params.get('flow') || 'pickup_v1',
  status: params.get('status') || 'pending', fulfillment_type: params.get('method') || 'customer_courier',
  meeting_point_label: 'Gerbang pasar Tikala, di samping pos dekat jalan utama',
  meeting_point_location: params.get('point') === 'missing' ? null : { lat: 1.474, lng: 124.846 }, payment_method: params.get('paymethod') || 'bank_transfer',
  payment_status: params.get('payment') || 'unpaid', total_amount: 15000, pickup_contact_name: 'Ani',
  collector_name: null, vendor_payment_details_snapshot: { bank_account_number: '123456789', bank_name: 'Bank Contoh', bank_account_name: 'Pak Sayur' },
}
const vendor = { id: 'vendor', name: 'Pak Sayur', description: 'Sayur keliling Tikala', online: true, is_verified: true, mobility_type: 'walking', service_area: 'Tikala', route_description: 'Pasar ke kantor kelurahan', stopping_points: 'Gerbang pasar', location: { lat: 1.475, lng: 124.849 }, last_seen_at: new Date().toISOString() }
const profiles = [{ id: 'vendor', display_name: 'Pak Sayur', role: 'vendor', account_status: 'active' }, { id: 'buyer', display_name: 'Ani', role: 'customer', account_status: 'active' }]
let favorites = []
let product = { id: 'product', name: 'Tomat segar', vendor_id: 'vendor', price: 5000, stock: 10, reserved_stock: 0, is_available: true }
let review = null
const listeners = new Set()
const chatMessages = { first: [], second: [] }
const initialChatRequests = []
const pendingSends = []
const messageListeners = new Set()
const connectionListeners = new Set()
let seededOrders = null
window.chatFixture = {
  sends: 0, subscriptions: 0, failHistory: false,
  seed(count = 95) {
    chatMessages.first = Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      chat_id: 'first', from_user: 'vendor', text: `Riwayat pesan ${index + 1}`,
      created_at: '2026-01-01T00:00:00.123456+00:00',
    }))
  },
  releaseInitial() { for (const resolve of initialChatRequests.splice(0)) resolve() },
  releaseSends() { for (const resolve of pendingSends.splice(0)) resolve() },
  incoming(chatId, text, createdAt = new Date().toISOString(), deliver = true, fromUser = 'vendor') {
    const message = { id: crypto.randomUUID(), chat_id: chatId, from_user: fromUser, text, created_at: createdAt }
    chatMessages[chatId].push(message)
    if (deliver) for (const listener of messageListeners) if (listener.chatId === chatId) listener.handler({ new: message })
  },
}
export async function sendChatMessage(chatId, fromUser, text) {
  window.chatFixture.sends++
  if (!navigator.onLine) throw new TypeError('Failed to fetch')
  if (params.get('view') === 'chat') await new Promise(resolve => pendingSends.push(resolve))
  const message = { id: crypto.randomUUID(), chat_id: chatId, from_user: fromUser, text, created_at: new Date().toISOString() }
  if (chatMessages[chatId]) chatMessages[chatId].push(message)
  return message
}
window.pickupFixture = {
  updates: 0,
  locationWrites: 0,
  profileWrites: 0,
  favoriteWrites: 0,
  auditWrites: 0,
  failNextFavorite: false,
  requests: [],
  failTables: params.get('fail') ? [params.get('fail')] : [],
  refresh() { for (const listener of listeners) listener() },
  offline() { vendor.online = false; this.refresh() },
  stale() { vendor.last_seen_at = new Date(Date.now() - 130000).toISOString(); this.refresh() },
  moveVendor() { vendor.location = { lat: 1.476, lng: 124.850 }; vendor.last_seen_at = new Date().toISOString(); this.refresh() },
  setOrderStatus(status) { fixtureOrder = { ...fixtureOrder, status }; this.refresh() },
  setDemandOrder(value) { fixtureOrder = { ...fixtureOrder, ...value }; this.refresh() },
  connection(status) { for (const callback of connectionListeners) callback(status) },
  seedOrders() {
    seededOrders = Array.from({ length: 65 }, (_, index) => ({ ...fixtureOrder,
      id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      created_at: '2026-01-01T00:00:00.123456+00:00',
      status: index < 25 ? 'pending' : 'completed', items: `Produk riwayat ${index + 1}`,
    }))
    this.refresh()
  },
}
if (params.get('pagination') === '1') {
  window.chatFixture.seed()
  window.pickupFixture.seedOrders()
}
const notificationListeners = new Set()
const notificationReads = []
const notificationRows = []
const notificationTime = new Date().toISOString()
window.notificationFixture = {
  subscriptions: 0, readWrites: 0, failRead: false, delayInitial: true,
  emit(id, type = 'message_received', deliver = true, owner = user.id) {
    const existing = notificationRows.find(row => row.id === id)
    const row = existing || { id, user_id: owner, type, title: `QA ${id}`, body: `Notifikasi ${id}`, entity_type: type === 'message_received' ? 'chat' : 'order', entity_id: type === 'message_received' ? 'chat' : 'order', is_read: false, read_at: null, created_at: notificationTime, updated_at: notificationTime }
    if (!existing) notificationRows.push(row)
    if (deliver) for (const listener of notificationListeners) if (listener.userId === owner && listener.event === 'INSERT') listener.handler({ new: { ...row } })
  },
  old() { notificationRows.push({ id: 'old', user_id: user.id, type: 'order_created', title: 'Lama', body: 'Pesanan lama', entity_type: 'order', entity_id: 'old-order', is_read: false, read_at: null, created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' }) },
  release() { this.delayInitial = false; for (const done of notificationReads.splice(0)) done() },
  get pendingReads() { return notificationReads.length },
  get activeListeners() { return notificationListeners.size },
}
export const supabase = {
  auth: {
    async updateUser({ data }) { user.user_metadata = { ...user.user_metadata, ...data }; return { data: { user }, error: null } },
  },
  channel() {
    const local = []
    let statusCallback
    return {
      on(_event, filter, handler) {
        if (filter.table === 'notifications') {
          const listener = { userId: filter.filter.slice('user_id=eq.'.length), event: filter.event, handler }
          local.push(listener); notificationListeners.add(listener)
        } else if (filter.table === 'messages') {
          const listener = { chatId: filter.filter.slice('chat_id=eq.'.length), handler }
          local.push(listener); messageListeners.add(listener)
        } else { local.push(handler); listeners.add(handler) }
        return this
      },
      subscribe(callback) { statusCallback = callback; if (callback) connectionListeners.add(callback); if (params.get('view') === 'chat') window.chatFixture.subscriptions++; if (params.get('view') === 'notifications') window.notificationFixture.subscriptions++; callback?.('SUBSCRIBED'); return this },
      unsubscribe() { connectionListeners.delete(statusCallback); for (const listener of local) { listeners.delete(listener); messageListeners.delete(listener); notificationListeners.delete(listener) } },
    }
  },
  removeChannel(channel) { channel.unsubscribe() },
  from(table) {
    let mutation
    let deleting = false
    let single = false
    let chatId
    const filters = {}
    let incremental = false
    let idCursor = ''
    let includedIds
    let statusFilter
    let selected = ''
    let limit = Infinity
    let logic = ''
    const ordering = []
    const query = {
      select(columns = '*') { selected = columns; return this }, eq(field, value) { filters[field] = value; if (field === 'chat_id') chatId = value; return this },
      order(field, options = {}) { ordering.push({ field, ascending: options.ascending !== false }); return this },
      limit(value) { limit = value; return this },
      in(field, values) { if (field === 'id') includedIds = values; if (field === 'status') statusFilter = values; return this },
      or(value) { logic = value; return this }, contains() { return this },
      abortSignal() { return this },
      gte() { incremental = true; return this },
      gt(field, value) { if (field === 'id') idCursor = value; return this },
      update(value) { mutation = value; return this },
      insert(values) { mutation = Array.isArray(values) ? values[0] : values; return this },
      is(field, value) { filters[field] = value; return this },
      delete() { deleting = true; return this },
      upsert(values) { mutation = Array.isArray(values) ? values[0] : values; return this },
      maybeSingle() { single = true; return this.result() }, single() { single = true; return this.result() },
      then(resolve, reject) { return this.result().then(resolve, reject) },
      result() {
        window.pickupFixture.requests.push({ table, filters: { ...filters }, selected, limit, ordering, logic, statusFilter })
        if (window.pickupFixture.failTables.includes(table)) return Promise.resolve({ data: null, error: { message: 'Simulated network error' } })
        if (table === 'admin_actions') { window.pickupFixture.auditWrites++; return Promise.resolve({ data: null, error: null }) }
        if (table === 'notifications') {
          let rows = notificationRows.filter(row => (!filters.user_id || row.user_id === filters.user_id) && (!includedIds || includedIds.includes(row.id)) && (filters.is_read === undefined || row.is_read === filters.is_read) && row.id > idCursor)
          if (mutation) {
            window.notificationFixture.readWrites++
            if (window.notificationFixture.failRead) return Promise.resolve({ data: null, error: { message: 'Simulated read failure' } })
            for (const row of rows) Object.assign(row, mutation)
          }
          rows = rows.map(row => ({ ...row }))
          if (!mutation && params.get('view') === 'notifications' && window.notificationFixture.delayInitial && filters.user_id === user.id) return new Promise(resolve => notificationReads.push(() => resolve({ data: rows, error: null })))
          return Promise.resolve({ data: rows, error: null })
        }
        if (table === 'favorites') {
          if (mutation || deleting) {
            if (window.pickupFixture.failNextFavorite) { window.pickupFixture.failNextFavorite = false; return Promise.resolve({ data: null, error: { message: 'Simulated favorite write failure' } }) }
            window.pickupFixture.favoriteWrites++
            if (deleting) favorites = favorites.filter(row => row.buyer_id !== filters.buyer_id || row.vendor_id !== filters.vendor_id)
            else if (!favorites.some(row => row.buyer_id === mutation.buyer_id && row.vendor_id === mutation.vendor_id)) favorites.push(mutation)
          }
          return Promise.resolve({ data: favorites.filter(row => !filters.buyer_id || row.buyer_id === filters.buyer_id).map(row => ({ ...row })), error: null })
        }
        if (table === 'messages') {
          if (window.chatFixture.failHistory && ordering[0]?.ascending === false && logic)
            return Promise.resolve({ data: null, error: { message: 'Simulated older-message request failure' } })
          let rows = [...(chatMessages[chatId] || [])]
          const cursor = logic.match(/created_at\.(lt|gt)\.([^,]+),and\(created_at\.eq\.[^,]+,id\.(?:lt|gt)\.([^\)]+)/)
          if (cursor) rows = rows.filter(row => cursor[1] === 'lt'
            ? row.created_at < cursor[2] || (row.created_at === cursor[2] && row.id < cursor[3])
            : row.created_at > cursor[2] || (row.created_at === cursor[2] && row.id > cursor[3]))
          for (const { field, ascending } of [...ordering].reverse()) rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (ascending ? 1 : -1))
          const data = rows.slice(0, limit)
          return incremental || ordering[0]?.ascending || params.get('pagination') === '1' || cursor
            ? Promise.resolve({ data, error: null }) : new Promise(resolve => initialChatRequests.push(() => resolve({ data, error: null })))
        }
        if (mutation && table === 'vendors') {
          if (filters.online && !vendor.online) return Promise.resolve({ data: null, error: null })
          if (filters.is_verified !== undefined && filters.is_verified !== vendor.is_verified) return Promise.resolve({ data: null, error: { code: 'PGRST116' } })
          Object.assign(vendor, mutation)
          if (mutation.is_verified === false) Object.assign(vendor, { online: false, location: null, last_seen_at: null })
          if (mutation.location) window.pickupFixture.locationWrites++
          else window.pickupFixture.profileWrites++
        } else if (mutation && table === 'products') product = { ...product, ...mutation }
        else if (mutation && table === 'reviews') review = { id: 'review', ...mutation, created_at: new Date().toISOString() }
        else if (mutation && table === 'profiles') {
          const profile = profiles.find(row => row.id === (filters.id || mutation.id))
          if (filters.account_status !== undefined && profile.account_status !== filters.account_status) return Promise.resolve({ data: null, error: { code: 'PGRST116' } })
          Object.assign(profile, mutation)
          if (profile.id === vendor.id && mutation.account_status && mutation.account_status !== 'active') Object.assign(vendor, { online: false, location: null, last_seen_at: null })
        }
        else if (mutation) { fixtureOrder = { ...fixtureOrder, ...mutation }; window.pickupFixture.updates++ }
        if (table === 'orders' && !single && selected.includes('order_items(')) {
          let rows = (seededOrders || [fixtureOrder]).filter(row => (!statusFilter || statusFilter.includes(row.status)) && (!filters.status || row.status === filters.status))
          const cursor = logic.match(/created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^\)]+)/)
          if (cursor) rows = rows.filter(row => row.created_at < cursor[1] || (row.created_at === cursor[1] && row.id < cursor[2]))
          const term = logic.match(/items\.ilike\."%([^%]*)%"/)?.[1]
          if (term) rows = rows.filter(row => [row.vendor_name, row.buyer_name, row.items, row.customer_note, row.meeting_point_label].some(value => value?.toLowerCase().includes(term.toLowerCase())))
          for (const { field, ascending } of [...ordering].reverse()) rows = [...rows].sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (ascending ? 1 : -1))
          return Promise.resolve({ data: rows.slice(0, limit).map(row => ({ ...row, order_items: [], reviews: review ? [review] : [] })), error: null })
        }
        const data = table === 'orders' ? (single ? { ...fixtureOrder } : [{ ...fixtureOrder }])
          : table === 'vendors' ? (single ? { ...vendor, ...(filters.id === 'other' ? { id: 'other', name: 'Toko Lain' } : {}) } : [{ ...vendor }])
          : table === 'pickup_codes' ? (fixtureOrder.status === 'ready' ? { code: 'A1B2C3D4E5' } : null)
          : table === 'order_items' ? [{ id: 'item', product_name_snapshot: 'Tomat segar', quantity: 3, line_total: 15000 }]
          : table === 'products' ? (single ? { ...product } : [{ ...product, ...(filters.vendor_id === 'other' ? { id: 'other-product', vendor_id: 'other', name: 'Kopi' } : {}) }])
          : table === 'profiles' ? (single ? { ...profiles.find(row => row.id === (filters.id || mutation?.id || user.id)) } : profiles.map(row => ({ ...row })))
          : table === 'reviews' ? (single ? review : review ? [review] : [])
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
    } else if (name === 'complete_pickup_order') {
      if (user.id !== fixtureOrder.vendor_id || fixtureOrder.status !== 'ready' || (fixtureOrder.payment_method !== 'cod' && fixtureOrder.payment_status !== 'paid')) return { data: { error: 'Pesanan belum bisa diselesaikan.' }, error: null }
      fixtureOrder = { ...fixtureOrder, status: 'completed', payment_status: 'paid' }
    } else if (name === 'complete_order_and_decrement_stock') {
      if (user.id !== fixtureOrder.vendor_id || fixtureOrder.status !== 'arrived' || fixtureOrder.payment_status !== 'paid') return { data: null, error: { message: 'Belum dapat diselesaikan' } }
      fixtureOrder = { ...fixtureOrder, status: 'completed' }
    }
    window.pickupFixture.updates++
    return { data: { ...fixtureOrder }, error: null }
  },
}
