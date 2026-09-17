export const PICKUP_FLOW = 'pickup_v1'
export const PICKUP_STATUSES = ['pending', 'accepted', 'ready', 'completed']
export const PICKUP_LABELS = { pending: 'Menunggu persetujuan', accepted: 'Disetujui', ready: 'Siap diambil', completed: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan' }
export const MOBILITY_OPTIONS = [
  { value: 'walking', label: 'Jalan kaki / pikulan' },
  { value: 'pushcart', label: 'Gerobak dorong' },
  { value: 'bicycle', label: 'Sepeda' },
  { value: 'motor_vehicle', label: 'Kendaraan bermotor' },
]
export const isPickupOrder = (order) => order?.service_flow === PICKUP_FLOW
export const formatMobility = (value) => MOBILITY_OPTIONS.find((item) => item.value === value)?.label || 'Mobilitas belum diisi'
export const pickupStatusLabel = (order) => PICKUP_LABELS[order?.status] || order?.status

export function pickupActions(order) {
  if (order.status === 'pending') return [{ value: 'accepted', label: 'Setujui titik', tone: 'primary' }, { value: 'rejected', label: 'Tolak', tone: 'danger' }]
  if (order.status === 'accepted') return [{ value: 'ready', label: 'Barang siap diambil', tone: 'primary' }]
  // Final handover uses the merchant confirmation RPC, never a direct status update.
  return []
}

export function validatePickupRequest({ method, point, collector, courierConsent }) {
  if (!['self_pickup', 'customer_courier'].includes(method)) return 'Pilih cara pengambilan.'
  if (!String(point || '').trim()) return 'Isi usulan titik pengambilan yang sesuai rute pedagang.'
  if (!String(collector || '').trim()) return 'Isi nama pelanggan yang mengatur pengambilan.'
  if (method === 'customer_courier' && !courierConsent) return 'Setujui pengaturan dan biaya kurir di luar Kelilingku.'
  return ''
}
