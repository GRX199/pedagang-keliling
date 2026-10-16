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
export function useDemandOrders() {
  const { user, role } = useAuth()
  const vendorId = role === 'vendor' ? user?.id || '' : ''
  const key = ['vendor-demand', vendorId]
  useRealtimeQuerySync(key, [{ table: 'orders', filter: `vendor_id=eq.${vendorId}` }])
  const query = useQuery({
    queryKey: key,
    enabled: !!vendorId,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('orders')
        .select(
          'id, status, order_timing, fulfillment_type, meeting_point_label, meeting_point_location, customer_location, requested_fulfillment_at, total_amount, created_at, updated_at'
        )
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false })
        .limit(200)
        .abortSignal(signal)
      if (error) throw error
      return data
    },
  })
  return { ...query, orders: vendorId ? query.data || EMPTY : EMPTY }
}
