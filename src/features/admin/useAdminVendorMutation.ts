import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { updateAdminVendor, type AdminVendorAction } from './admin-api'

export function useAdminVendorMutation(expectedActor: string) {
  const { user, role } = useAuth()
  const client = useQueryClient()
  const lock = useRef(false)
  const mutation = useMutation({
    mutationFn: (action: AdminVendorAction) => {
      if (!user || user.id !== expectedActor || role !== 'admin')
        throw new Error('Aksi ini hanya tersedia untuk admin.')
      return updateAdminVendor(user.id, action)
    },
    onSuccess: async () => {
      await Promise.all(
        [
          'admin-vendors',
          'map-vendors',
          'vendor',
          'vendor-presence',
          'profile',
        ].map((name) => client.invalidateQueries({ queryKey: [name] })),
      )
    },
  })
  return {
    ...mutation,
    execute: async (action: AdminVendorAction) => {
      if (lock.current) return null
      lock.current = true
      try {
        return await mutation.mutateAsync(action)
      } finally {
        lock.current = false
      }
    },
  }
}
