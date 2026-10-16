import { supabase } from '../../shared/lib/supabase'
import type { Json } from '../../types/database.types'
import type { Order, Vendor, Review } from '../../types/domain.types'
import type { Tables } from '../../types/database.types'
import { saveOrderChange } from '../../lib/order-mutations'

export type OrderBundle = {
  order: Order
  vendor: Vendor | null
  items: Tables<'order_items'>[]
  review: Review | null
  detailError: boolean
}
export type OrderAction =
  | { kind: 'status'; value: string }
  | { kind: 'payment_status'; value: string }
  | { kind: 'details'; point?: string; collector?: string; expectedPoint?: string | null }
  | { kind: 'complete' }
function isOrder(value: unknown): value is Order {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'vendor_id' in value &&
    'buyer_id' in value &&
    'status' in value
  )
}
export function unwrapOrder(result: unknown): Order {
  const value = result && typeof result === 'object' && 'order' in result ? result.order : result
  if (result && typeof result === 'object' && 'error' in result)
    throw new Error(String(result.error))
  if (!isOrder(value))
    throw new Error('Perubahan belum terkonfirmasi. Periksa pesanan sebelum mencoba lagi.')
  return value
}
export async function fetchOrder(id: string, signal: AbortSignal): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .abortSignal(signal)
    .maybeSingle()
  if (error) throw error
  return data
}
export async function fetchOrderBundle(
  order: Order,
  signal: AbortSignal,
  previous?: OrderBundle
): Promise<OrderBundle> {
  const [o, v, i, r] = await Promise.all([
    supabase.from('orders').select('*').eq('id', order.id).abortSignal(signal).single(),
    supabase
      .from('vendors')
      .select('*')
      .eq('id', order.vendor_id)
      .abortSignal(signal)
      .maybeSingle(),
    supabase
      .from('order_items')
      .select('*')
      .eq('order_id', order.id)
      .order('created_at')
      .abortSignal(signal),
    supabase.from('reviews').select('*').eq('order_id', order.id).abortSignal(signal).maybeSingle(),
  ])
  if (o.error) throw o.error
  return {
    order: o.data,
    vendor: v.error ? previous?.vendor || null : v.data,
    items: i.error ? previous?.items || [] : i.data || [],
    review: r.error ? previous?.review || null : r.data,
    detailError: [v, i, r].some((result) => !!result.error),
  }
}
export async function updateOrder(
  order: Order,
  actor: string,
  action: OrderAction
): Promise<Order> {
  if (action.kind === 'status' || action.kind === 'payment_status')
    return unwrapOrder(await saveOrderChange(supabase, order, action.kind, action.value, actor))
  let result: { data: Json | Order | null; error: unknown }
  if (action.kind === 'complete')
    result = await supabase.rpc('complete_pickup_order', { target_order_id: order.id })
  else
    result = await supabase.rpc('update_pickup_details', {
      target_order_id: order.id,
      target_point: action.point,
      target_collector: action.collector,
      expected_point: action.expectedPoint,
    })
  if (result.error) throw result.error
  return unwrapOrder(result.data)
}
