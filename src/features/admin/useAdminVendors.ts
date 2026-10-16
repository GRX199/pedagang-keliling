import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'

export function useAdminVendors() {
  const { user, role } = useAuth()
  const key = ['admin-vendors', user?.id || '']
  useRealtimeQuerySync(role === 'admin' ? key : [''], [{ table: 'vendors' }, { table: 'profiles' }])
  return useQuery({
    queryKey: key,
    enabled: !!user && role === 'admin',
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const [vendors, profiles] = await Promise.all([
        supabase
          .from('vendors')
          .select('*')
          .order('updated_at', { ascending: false })
          .abortSignal(signal),
        supabase.from('profiles').select('*').abortSignal(signal),
      ])
      if (vendors.error) throw vendors.error
      if (profiles.error) throw profiles.error
      return vendors.data.map((vendor) => {
        const profile = profiles.data.find((row) => row.id === vendor.id) || null
        return { ...vendor, profile, account_status: profile?.account_status || 'active' }
      })
    },
  })
}
