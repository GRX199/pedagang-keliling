import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { supabase } from '../../shared/lib/supabase'
import {
  dateCursorFilter,
  literalSearch,
  pageOf,
  type DateCursor
} from '../../shared/lib/keyset'
import { ACTIVE_ORDER_STATUSES, HISTORY_ORDER_STATUSES } from '../../lib/orders'
import type { Order, Role } from '../../types/domain.types'
import type { Tables } from '../../types/database.types'

export const ORDER_PAGE_SIZE = 20
export type OrderListItem = Order & {
  order_items: Tables<'order_items'>[]
  review: Tables<'reviews'> | null
}
export type OrderListOptions = {
  scope: 'active' | 'history'
  status?: string
  search?: string
  enabled?: boolean
}
export type OrderPage = { items: OrderListItem[]; next: DateCursor | null }
export type OrderPages = InfiniteData<OrderPage, DateCursor | null>

export function orderListFilter(cursor: DateCursor | null, search = '') {
  const clauses: string[] = []
  if (cursor) clauses.push(`or(${dateCursorFilter(cursor)})`)
  if (search.trim()) {
    const term = literalSearch(search)
    clauses.push(
      `or(${[
        'vendor_name',
        'buyer_name',
        'items',
        'customer_note',
        'meeting_point_label'
      ]
        .map((field) => `${field}.ilike.${term}`)
        .join(',')})`
    )
  }
  return clauses.length ? `and(${clauses.join(',')})` : ''
}

export async function fetchOrderPage(
  viewerId: string,
  role: Role,
  options: OrderListOptions,
  cursor: DateCursor | null,
  signal: AbortSignal
): Promise<OrderPage> {
  let request = supabase
    .from('orders')
    .select('*,order_items(*),reviews(*)')
    .eq(role === 'vendor' ? 'vendor_id' : 'buyer_id', viewerId)
    .in(
      'status',
      options.scope === 'active'
        ? ACTIVE_ORDER_STATUSES
        : HISTORY_ORDER_STATUSES
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(ORDER_PAGE_SIZE + 1)
  if (
    options.scope === 'history' &&
    HISTORY_ORDER_STATUSES.includes(options.status || '')
  )
    request = request.eq('status', options.status!)
  const filter = orderListFilter(
    cursor,
    options.scope === 'history' ? options.search : ''
  )
  if (filter) request = request.or(filter)
  const { data, error } = await request.abortSignal(signal)
  if (error) throw error
  const rows: OrderListItem[] = data.map(({ reviews, ...order }) => ({
    ...order,
    order_items: order.order_items || [],
    review: Array.isArray(reviews) ? reviews[0] || null : reviews || null
  }))
  return pageOf(rows, ORDER_PAGE_SIZE)
}

export function updateOrderLists(
  client: QueryClient,
  viewerId: string,
  update: (rows: OrderListItem[]) => OrderListItem[]
) {
  client.setQueriesData<OrderPages>(
    { queryKey: ['orders', viewerId, 'list'] },
    (previous) =>
      previous
        ? {
            ...previous,
            pages: previous.pages.map((page) => ({
              ...page,
              items: update(page.items)
            }))
          }
        : previous
  )
}
