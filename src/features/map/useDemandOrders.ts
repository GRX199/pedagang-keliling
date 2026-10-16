import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import type { Order } from '../../types/domain.types'

export type DemandOrder = Pick<
  Order,
  | 'id'
  | 'status'
  | 'order_timing'
  | 'fulfillment_type'
  | 'meeting_point_label'
  | 'meeting_point_location'
  | 'customer_location'
  | 'requested_fulfillment_at'
  | 'total_amount'
  | 'created_at'
  | 'updated_at'
>
const EMPTY: DemandOrder[] = []
export const DEMAND_ORDER_LIMIT = 1000
export function useDemandOrders() {
  const { user, role } = useAuth()
  const vendorId = role === 'vendor' ? user?.id || '' : ''
  const key = ['vendor-demand', vendorId, 'v2']
  useRealtimeQuerySync(key, [{ table: 'orders', filter: `vendor_id=eq.${vendorId}` }])
  const query = useQuery({
    queryKey: key,
    enabled: !!vendorId,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error, count } = await supabase
        .from('orders')
        .select(
          'id, status, order_timing, fulfillment_type, meeting_point_label, meeting_point_location, customer_location, requested_fulfillment_at, total_amount, created_at, updated_at',
          { count: 'exact' }
        )
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(DEMAND_ORDER_LIMIT)
        .abortSignal(signal)
      if (error) throw error
      return { rows: data, total: count ?? data.length }
    },
  })
  return {
    ...query,
    orders: vendorId ? query.data?.rows || EMPTY : EMPTY,
    truncated: !!query.data && query.data.total > query.data.rows.length,
  }
}
