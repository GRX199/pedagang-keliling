import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import { loadIdentityMap } from '../../lib/profiles'
import { findOrCreateDirectChat } from '../../lib/conversations'
import type { Tables } from '../../types/database.types'
import type { Order } from '../../types/domain.types'
import { ACTIVE_ORDER_STATUSES } from '../../lib/orders'

type Chat = Tables<'chats'>
const EMPTY: Chat[] = []
const EMPTY_ORDERS: Order[] = []

export function useDirectChat(viewerId: string | undefined, partnerId: string | null) {
  const client = useQueryClient()
  return useQuery({
    queryKey: ['direct-chat', viewerId || '', partnerId || ''],
    enabled: !!viewerId && !!partnerId && viewerId !== partnerId,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<Chat> => {
      if (!viewerId || !partnerId) throw new Error('Peserta chat tidak valid.')
      const chat = await findOrCreateDirectChat(viewerId, partnerId)
      await client.invalidateQueries({ queryKey: ['chats', viewerId] })
      return chat
    },
  })
}

export function useChats(viewerId: string | undefined) {
  const client = useQueryClient()
  const key = ['chats', viewerId || '']
  useRealtimeQuerySync(key, [{ table: 'chats' }, { table: 'profiles' }])
  const query = useQuery({
    queryKey: key,
    enabled: !!viewerId,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .contains('participants', [viewerId!])
        .order('last_updated', { ascending: false })
        .abortSignal(signal)
      if (error) throw error
      return data || EMPTY
    },
  })
  const chats = query.data || EMPTY
  const partnerIds = [
    ...new Set(chats.flatMap((chat) => chat.participants || []).filter((id) => id !== viewerId)),
  ].sort()
  const identities = useQuery({
    queryKey: ['chat-identities', viewerId || '', partnerIds],
    enabled: !!viewerId && partnerIds.length > 0,
    queryFn: async ({ signal }) => {
      const map = await loadIdentityMap(partnerIds)
      const missingIds = partnerIds.filter((id) => !map[id])
      if (missingIds.length) {
        const { data, error } = await supabase
          .from('orders')
          .select('vendor_id, vendor_name, buyer_id, buyer_name')
          .or(`vendor_id.eq.${viewerId},buyer_id.eq.${viewerId}`)
          .order('created_at', { ascending: false })
          .limit(200)
          .abortSignal(signal)
        if (error) throw error
        for (const order of data || []) {
          if (order.buyer_id && missingIds.includes(order.buyer_id) && !map[order.buyer_id])
            map[order.buyer_id] = {
              id: order.buyer_id,
              name: order.buyer_name || 'Pelanggan',
              photo_url: null,
              role: 'customer',
            }
          if (order.vendor_id && missingIds.includes(order.vendor_id) && !map[order.vendor_id])
            map[order.vendor_id] = {
              id: order.vendor_id,
              name: order.vendor_name || 'Pedagang',
              photo_url: null,
              role: 'vendor',
            }
        }
      }
      return map
    },
  })
  const setChats = useCallback(
    (update: (previous: Chat[]) => Chat[]) => {
      client.setQueryData<Chat[]>(['chats', viewerId || ''], (previous) =>
        update(previous || EMPTY)
      )
    },
    [client, viewerId]
  )
  return { ...query, chats, identities: identities.data || {}, setChats }
}

export function useRelatedOrders(viewerId: string | undefined, partnerId: string | null) {
  const key = ['chat-orders', viewerId || '', partnerId || '']
  useRealtimeQuerySync(key, [
    { table: 'orders', filter: `vendor_id=eq.${viewerId}` },
    { table: 'orders', filter: `buyer_id=eq.${viewerId}` },
  ])
  const query = useQuery({
    queryKey: key,
    enabled: !!viewerId && !!partnerId,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .or(
          `and(vendor_id.eq.${viewerId},buyer_id.eq.${partnerId}),and(vendor_id.eq.${partnerId},buyer_id.eq.${viewerId})`
        )
        .in('status', ACTIVE_ORDER_STATUSES)
        .order('created_at', { ascending: false })
        .limit(24)
        .abortSignal(signal)
      if (error) throw error
      return data || EMPTY_ORDERS
    },
  })
  return { ...query, orders: query.data || EMPTY_ORDERS }
}
