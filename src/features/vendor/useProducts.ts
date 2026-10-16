import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import type { TablesInsert, TablesUpdate } from '../../types/database.types'

type Editable = Pick<
  TablesUpdate<'products'>,
  'name' | 'description' | 'price' | 'stock' | 'category_name' | 'is_available' | 'image_url'
>
type Action =
  | { kind: 'create'; payload: Omit<TablesInsert<'products'>, 'vendor_id' | 'reserved_stock'> }
  | { kind: 'update'; id: string; payload: Editable }
  | { kind: 'delete'; id: string }

export function useProducts(vendorId: string | undefined) {
  const { user } = useAuth()
  const key = ['products', user?.id || '', vendorId || '']
  useRealtimeQuerySync(key, [{ table: 'products', filter: `vendor_id=eq.${vendorId}` }])
  return useQuery({
    queryKey: key,
    enabled: !!user && !!vendorId,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('vendor_id', vendorId!)
        .order('created_at', { ascending: false })
        .abortSignal(signal)
      if (error) throw error
      return data
    },
  })
}

export function useProductMutation(vendorId: string | undefined) {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (action: Action) => {
      if (!user || user.id !== vendorId)
        throw new Error('Produk hanya dapat dikelola pemilik toko.')
      if (action.kind === 'delete') {
        const { error } = await supabase
          .from('products')
          .delete()
          .eq('id', action.id)
          .eq('vendor_id', vendorId)
        if (error) throw error
        return
      }
      const query =
        action.kind === 'create'
          ? supabase.from('products').insert({ ...action.payload, vendor_id: vendorId })
          : supabase
              .from('products')
              .update(action.payload)
              .eq('id', action.id)
              .eq('vendor_id', vendorId)
      const { error } = await query.select('id').single()
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['products', user?.id, vendorId] }),
        client.invalidateQueries({ queryKey: ['vendor'] }),
        client.invalidateQueries({ queryKey: ['map-vendors'] }),
      ])
    },
  })
}
