import { useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Coordinates, Role } from '../../types/domain.types'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import {
  fetchProfile,
  saveProfile,
  updateProfileLocation,
  type SaveProfileInput,
} from './profile-api'
import type { ProfileView } from './profile-form'

export function useProfile(user: User, role: Role) {
  const client = useQueryClient()
  const key = ['profile', user.id, role]
  const lock = useRef(false)
  useRealtimeQuerySync(key, [
    { table: role === 'vendor' ? 'vendors' : 'profiles', filter: `id=eq.${user.id}` },
  ])
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchProfile(user, role, signal),
  })
  async function publish(profile: ProfileView) {
    await client.cancelQueries({ queryKey: key })
    client.setQueryData(key, profile)
    await Promise.all([
      client.invalidateQueries({ queryKey: ['vendor'] }),
      client.invalidateQueries({ queryKey: ['map-vendors'] }),
      client.invalidateQueries({ queryKey: ['chat-identities'] }),
      client.invalidateQueries({ queryKey: ['admin-vendors'] }),
    ])
  }
  const mutation = useMutation({
    mutationFn: (input: SaveProfileInput) => saveProfile(user, role, input),
    onSuccess: publish,
  })
  const location = useMutation({
    mutationFn: (point: Coordinates) => {
      if (role !== 'vendor') throw new Error('Hanya pedagang yang dapat mengubah lokasi toko.')
      return updateProfileLocation(user.id, point)
    },
    onSuccess: publish,
  })
  return {
    ...query,
    save: async (input: SaveProfileInput) => {
      if (lock.current) return null
      lock.current = true
      try {
        return await mutation.mutateAsync(input)
      } finally {
        lock.current = false
      }
    },
    saving: mutation.isPending,
    updateLocation: location.mutateAsync,
    savingLocation: location.isPending,
  }
}
