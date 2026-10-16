import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import type { Product, Review, Vendor } from '../../types/domain.types'

const EMPTY_PRODUCTS: Product[] = []
const EMPTY_REVIEWS: Review[] = []
type VendorBundle = {
  vendor: Vendor | null
  products: Product[]
  reviews: Review[]
  reviewsUnavailable: boolean
}
export function useVendor(id: string | undefined) {
  const { user } = useAuth()
  const client = useQueryClient()
  const key = ['vendor', user?.id || '', id || '']
  useRealtimeQuerySync(key, [
    { table: 'vendors', filter: `id=eq.${id}` },
    { table: 'products', filter: `vendor_id=eq.${id}` },
    { table: 'reviews', filter: `vendor_id=eq.${id}` },
  ])
  const query = useQuery({
    queryKey: key,
    enabled: !!id && !!user,
    refetchInterval: 30_000,
    queryFn: async ({ signal }): Promise<VendorBundle> => {
      const [v, p, r] = await Promise.all([
        supabase.from('vendors').select('*').eq('id', id!).abortSignal(signal).maybeSingle(),
        supabase
          .from('products')
          .select('*')
          .eq('vendor_id', id!)
          .order('created_at', { ascending: false })
          .abortSignal(signal),
        supabase
          .from('reviews')
          .select('*')
          .eq('vendor_id', id!)
          .order('created_at', { ascending: false })
          .limit(6)
          .abortSignal(signal),
      ])
      if (v.error) throw v.error
      if (p.error) throw p.error
      return {
        vendor: v.data,
        products: p.data || EMPTY_PRODUCTS,
        reviews: r.error
          ? client.getQueryData<VendorBundle>(key)?.reviews || EMPTY_REVIEWS
          : r.data || EMPTY_REVIEWS,
        reviewsUnavailable: !!r.error,
      }
    },
  })
  return {
    ...query,
    vendor: query.data?.vendor || null,
    products: query.data?.products || EMPTY_PRODUCTS,
    reviews: query.data?.reviews || EMPTY_REVIEWS,
  }
}
