import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import type { Json } from '../../types/database.types'

export function useVendorPresence(vendorId: string | undefined, enabled: boolean) {
  const key = ['vendor-presence', enabled ? vendorId || '' : '']
  useRealtimeQuerySync(key, [{ table: 'vendors', filter: `id=eq.${vendorId}` }])
  return useQuery({
    queryKey: key,
    enabled: enabled && !!vendorId,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('vendors')
        .select('id, online, is_verified, location, last_seen_at')
        .eq('id', vendorId!)
        .abortSignal(signal)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useSyncVendorLocation(vendorId: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (location: Json) => {
      if (!vendorId) throw new Error('Identitas pedagang tidak tersedia.')
      const { data, error } = await supabase
        .from('vendors')
        .update({ location, last_seen_at: new Date().toISOString() })
        .eq('id', vendorId)
        .eq('online', true)
        .eq('is_verified', true)
        .select('id, online, is_verified, location, last_seen_at')
        .maybeSingle()
      if (error) throw error
      return data
    },
    onSuccess: async (row) => {
      if (!row) return
      await client.cancelQueries({ queryKey: ['vendor-presence', vendorId] })
      client.setQueryData(['vendor-presence', vendorId], row)
      // The map's realtime query also covers other devices viewing this vendor.
      void client.invalidateQueries({ queryKey: ['map-vendors'] })
    },
  })
}
