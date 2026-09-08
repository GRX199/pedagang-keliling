import { getBuyerPaymentActions, getNextVendorStatusActions, getVendorPaymentActions } from './orders'

const STALE_ORDER_MESSAGE = 'Pesanan sudah berubah. Muat ulang pesanan sebelum mencoba lagi.'

export async function saveOrderChange(client, order, field, value, viewerId) {
  if (!order?.id || !viewerId) throw new Error('Pesanan atau sesi login tidak tersedia.')

  const isVendor = viewerId === order.vendor_id
  const isBuyer = viewerId === order.buyer_id
  let actions = []
  if (field === 'status') {
    actions = isVendor
      ? getNextVendorStatusActions(order)
      : isBuyer && order.status === 'pending' ? [{ value: 'cancelled' }] : []
  } else if (field === 'payment_status') {
    actions = isVendor ? getVendorPaymentActions(order) : isBuyer ? getBuyerPaymentActions(order) : []
  }
  const action = actions.find((item) => item.value === value)
  if (!action || action.disabled) {
    throw new Error(action?.disabledReason || 'Aksi ini tidak tersedia untuk status pesanan saat ini.')
  }

  if (field === 'status' && value === 'completed') {
    // Completion and inventory must commit together in the database, never in browser writes.
    const { data, error } = await client.rpc('complete_order_and_decrement_stock', {
      target_order_id: order.id,
    })
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        throw new Error('Penyelesaian pesanan belum tersedia. Hubungi pengelola; pesanan belum diubah.', { cause: error })
      }
      throw error
    }
    if (!data?.id) throw new Error(STALE_ORDER_MESSAGE)
    return data
  }

  const { data, error } = await client.from('orders')
    .update({ [field]: value })
    .eq('id', order.id)
    .eq('status', order.status)
    .eq('payment_status', order.payment_status)
    .select('*')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error(STALE_ORDER_MESSAGE)
  return data
}
