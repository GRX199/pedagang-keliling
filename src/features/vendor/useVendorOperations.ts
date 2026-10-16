import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../shared/lib/supabase'
import { requireServerOrigin, getFriendlyFetchErrorMessage } from '../../lib/network'
import { createLocationPayload } from '../../shared/lib/coordinates'
import type { Coordinates, VendorMapItem } from '../../types/domain.types'

export async function setVendorOnline(vendorId: string, online: boolean) {
  let { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token)
    throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.')
  const send = (token: string) =>
    fetch(`${requireServerOrigin()}/api/vendor/${encodeURIComponent(vendorId)}/online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ online }),
    })
  let response: Response
  try {
    response = await send(data.session.access_token)
    if (response.status === 401) {
      const refreshed = await supabase.auth.refreshSession()
      data = refreshed.data
      error = refreshed.error
      if (error || !data.session?.access_token)
        throw new Error('Sesi login berakhir. Silakan masuk kembali.')
      response = await send(data.session.access_token)
    }
  } catch (error) {
    throw new Error(
      getFriendlyFetchErrorMessage(error, 'Server status toko belum dapat dihubungi.'),
      { cause: error }
    )
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Status toko belum tersimpan.'
    )
  if (!body || typeof body !== 'object' || !('online' in body) || typeof body.online !== 'boolean')
    throw new Error('Status toko belum terkonfirmasi. Periksa koneksi dan coba lagi.')
  return body.online
}

export function useVendorOperations() {
  const { user, role } = useAuth()
  const client = useQueryClient()
  const lock = useRef(false)
  const viewerId = user?.id || ''
  async function invalidate() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['map-vendors', viewerId] }),
      client.invalidateQueries({ queryKey: ['vendor-presence', viewerId] }),
      client.invalidateQueries({ queryKey: ['profile', viewerId] }),
      client.invalidateQueries({ queryKey: ['vendor'] }),
    ])
  }
  const online = useMutation({
    mutationFn: (value: boolean) => {
      if (!viewerId || role !== 'vendor')
        throw new Error('Hanya pedagang yang dapat mengubah status toko.')
      return setVendorOnline(viewerId, value)
    },
    onSuccess: async (value) => {
      await client.cancelQueries({ queryKey: ['map-vendors', viewerId] })
      client.setQueryData<VendorMapItem[]>(['map-vendors', viewerId], (previous) =>
        previous?.map((vendor) =>
          vendor.id === viewerId
            ? { ...vendor, online: value, ...(value ? {} : { location: null, last_seen_at: null }) }
            : vendor
        )
      )
      await invalidate()
    },
  })
  const location = useMutation({
    mutationFn: async (coordinates: Coordinates) => {
      if (!viewerId || role !== 'vendor')
        throw new Error('Hanya pedagang yang dapat mengubah lokasi toko.')
      const payload = createLocationPayload(coordinates)
      if (!payload) throw new Error('Lokasi tidak valid.')
      const { data, error } = await supabase
        .from('vendors')
        .update({ location: payload, last_seen_at: new Date().toISOString() })
        .eq('id', viewerId)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: async (row) => {
      await client.cancelQueries({ queryKey: ['map-vendors', viewerId] })
      client.setQueryData<VendorMapItem[]>(['map-vendors', viewerId], (previous) =>
        previous?.map((vendor) => (vendor.id === viewerId ? { ...vendor, ...row } : vendor))
      )
      await invalidate()
    },
  })
  return {
    updatingOnline: online.isPending,
    updatingLocation: location.isPending,
    updateLocation: location.mutateAsync,
    setOnline: async (value: boolean) => {
      if (lock.current) return null
      lock.current = true
      try {
        return await online.mutateAsync(value)
      } finally {
        lock.current = false
      }
    },
  }
}
