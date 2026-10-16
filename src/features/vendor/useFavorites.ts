import { useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import { isFavoritesSchemaCompatibilityError } from '../../lib/favorites'

type Favorites = { ids: string[]; available: boolean }
type Change = { vendorId: string; favorite: boolean }
const EMPTY: string[] = []
export function updateFavoriteIds(ids: string[], vendorId: string, favorite: boolean) {
  const next = ids.filter((id) => id !== vendorId)
  return favorite ? [vendorId, ...next] : next
}

export function useFavorites() {
  const { user, role } = useAuth()
  const client = useQueryClient()
  const viewerId = user?.id || ''
  const enabled = !!viewerId && role === 'customer'
  const key = ['favorites', enabled ? viewerId : '']
  const locks = useRef(new Set<string>())
  useRealtimeQuerySync(key, [{ table: 'favorites', filter: `buyer_id=eq.${viewerId}` }])
  const query = useQuery({
    queryKey: key,
    enabled,
    refetchInterval: 30_000,
    queryFn: async ({ signal }): Promise<Favorites> => {
      const { data, error } = await supabase
        .from('favorites')
        .select('vendor_id')
        .eq('buyer_id', viewerId)
        .order('created_at', { ascending: false })
        .abortSignal(signal)
      if (error) {
        if (isFavoritesSchemaCompatibilityError(error)) return { ids: EMPTY, available: false }
        throw error
      }
      return { ids: [...new Set(data.map((row) => row.vendor_id))], available: true }
    },
  })
  const mutation = useMutation({
    mutationKey: ['favorites', viewerId],
    scope: { id: `favorites:${viewerId}` },
    mutationFn: async ({ vendorId, favorite }: Change) => {
      if (!enabled || !vendorId) throw new Error('Favorit hanya tersedia untuk akun pelanggan.')
      const request = favorite
        ? supabase
            .from('favorites')
            .upsert(
              { buyer_id: viewerId, vendor_id: vendorId },
              { onConflict: 'buyer_id,vendor_id', ignoreDuplicates: true }
            )
        : supabase.from('favorites').delete().eq('buyer_id', viewerId).eq('vendor_id', vendorId)
      const { error } = await request
      if (error) throw error
      return { vendorId, favorite }
    },
    onMutate: async (change) => {
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<Favorites>(key)
      client.setQueryData<Favorites>(key, (current) =>
        current
          ? { ...current, ids: updateFavoriteIds(current.ids, change.vendorId, change.favorite) }
          : current
      )
      return { wasFavorite: previous?.ids.includes(change.vendorId) ?? false }
    },
    onError: (error, change, context) => {
      client.setQueryData<Favorites>(key, (current) =>
        current
          ? isFavoritesSchemaCompatibilityError(error)
            ? { ids: EMPTY, available: false }
            : {
                ...current,
                ids: updateFavoriteIds(current.ids, change.vendorId, context?.wasFavorite ?? false),
              }
          : current
      )
    },
    onSuccess: (change) => {
      client.setQueryData<Favorites>(key, (current) =>
        current
          ? { ...current, ids: updateFavoriteIds(current.ids, change.vendorId, change.favorite) }
          : current
      )
    },
    onSettled: () => {
      if (client.isMutating({ mutationKey: ['favorites', viewerId] }) === 1)
        void client.invalidateQueries({ queryKey: key })
    },
  })
  const mutateAsync = mutation.mutateAsync
  const setFavorite = useCallback(
    async (vendorId: string, favorite: boolean) => {
      if (locks.current.has(vendorId)) return null
      locks.current.add(vendorId)
      try {
        return await mutateAsync({ vendorId, favorite })
      } finally {
        locks.current.delete(vendorId)
      }
    },
    [mutateAsync]
  )
  return {
    ...query,
    ids: enabled ? query.data?.ids || EMPTY : EMPTY,
    available: enabled && !!query.data?.available,
    busyVendorId: mutation.isPending ? mutation.variables?.vendorId || null : null,
    setFavorite,
  }
}
