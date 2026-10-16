import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import type { VendorMapItem } from '../../types/domain.types'

const EMPTY: VendorMapItem[] = []
export function useActiveVendors() {
  const { user } = useAuth()
  const client = useQueryClient()
  const viewer = user?.id || ''
  const key = ['map-vendors', viewer]
  useRealtimeQuerySync(key, [
    { table: 'vendors' },
    { table: 'products' },
    { table: 'reviews' },
    { table: 'profiles' },
  ])
  const query = useQuery({
    queryKey: key,
    enabled: !!viewer,
    refetchInterval: 15_000,
    queryFn: async ({ signal }): Promise<VendorMapItem[]> => {
      const vendors = await supabase.from('vendors').select('*').abortSignal(signal)
      if (vendors.error) throw vendors.error
      if (!vendors.data.length) return EMPTY
      const ids = vendors.data.map((vendor) => vendor.id)
      const [products, profiles, reviews] = await Promise.all([
        supabase
          .from('products')
          .select('vendor_id, name, category_name')
          .in('vendor_id', ids)
          .order('created_at', { ascending: false })
          .abortSignal(signal),
        supabase.from('profiles').select('id, account_status').in('id', ids).abortSignal(signal),
        supabase
          .from('reviews')
          .select('vendor_id, rating')
          .in('vendor_id', ids)
          .abortSignal(signal),
      ])
      const previous = new Map(
        (client.getQueryData<VendorMapItem[]>(key) || EMPTY).map((row) => [row.id, row])
      )
      return vendors.data.map((vendor) => {
        const cached = previous.get(vendor.id)
        const goods = (products.data || []).filter((product) => product.vendor_id === vendor.id)
        const ratings = (reviews.data || []).filter((review) => review.vendor_id === vendor.id)
        return {
          ...vendor,
          map_category: products.error
            ? cached?.map_category || null
            : goods.find((product) => product.category_name)?.category_name || null,
          map_search_text: products.error
            ? cached?.map_search_text || ''
            : [...new Set(goods.map((product) => product.name))].join(' '),
          account_status: profiles.error
            ? cached?.account_status || 'active'
            : profiles.data?.find((profile) => profile.id === vendor.id)?.account_status ||
              'active',
          review_average: reviews.error
            ? cached?.review_average || 0
            : ratings.length
              ? ratings.reduce((sum, review) => sum + review.rating, 0) / ratings.length
              : 0,
          review_count: reviews.error ? cached?.review_count || 0 : ratings.length,
        }
      })
    },
  })
  const setVendors = useCallback(
    (update: VendorMapItem[] | ((previous: VendorMapItem[]) => VendorMapItem[])) => {
      client.setQueryData<VendorMapItem[]>(['map-vendors', viewer], (previous) =>
        typeof update === 'function' ? update(previous || EMPTY) : update
      )
    },
    [client, viewer]
  )
  return { ...query, vendors: query.data || EMPTY, setVendors }
}
