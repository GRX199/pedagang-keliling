import { useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import { isSchemaCompatibilityError } from '../../lib/orders'
import type { Order, Role } from '../../types/domain.types'
import type { Tables } from '../../types/database.types'
import type { Database } from '../../types/database.types'
import {
  fetchOrder,
  fetchOrderBundle,
  updateOrder,
  type OrderAction,
  type OrderBundle,
} from './api'

export type OrderListItem = Order & {
  order_items: Tables<'order_items'>[]
  review: Tables<'reviews'> | null
}

export function useCreatePickupOrder() {
  const client = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (args: Database['public']['Functions']['create_pickup_order']['Args']) => {
      if (!user) throw new Error('Silakan masuk kembali.')
      const { data, error } = await supabase.rpc('create_pickup_order', args)
      if (error) {
        if (isSchemaCompatibilityError(error))
          throw new Error(
            'Pemesanan pengambilan belum tersedia. Hubungi pengelola; pesanan belum dibuat.',
            { cause: error }
          )
        throw error
      }
      if (!data?.id)
        throw new Error(
          'Pesanan belum terkonfirmasi. Periksa halaman pesanan sebelum mencoba lagi.'
        )
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['orders', user?.id] }),
        client.invalidateQueries({ queryKey: ['vendor'] }),
        client.invalidateQueries({ queryKey: ['products'] }),
      ])
    },
  })
}

export function useOrder(id: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['orders', user?.id, id],
    enabled: !!id && !!user,
    queryFn: ({ signal }) => fetchOrder(id!, signal),
  })
}
export function useOrders(viewerId: string | undefined, role: Role | null) {
  const client = useQueryClient()
  const key = ['orders', viewerId || '', 'list', role || 'customer']
  useRealtimeQuerySync(key, [
    { table: 'orders', filter: `${role === 'vendor' ? 'vendor_id' : 'buyer_id'}=eq.${viewerId}` },
  ])
  const query = useQuery({
    queryKey: key,
    enabled: !!viewerId && !!role,
    refetchInterval: 15_000,
    queryFn: async ({ signal }): Promise<OrderListItem[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq(role === 'vendor' ? 'vendor_id' : 'buyer_id', viewerId!)
        .order('created_at', { ascending: false })
        .abortSignal(signal)
      if (error) throw error
      if (!data.length) return []
      const ids = data.map((order) => order.id)
      const [items, reviews] = await Promise.all([
        supabase
          .from('order_items')
          .select('*')
          .in('order_id', ids)
          .order('created_at', { ascending: true })
          .abortSignal(signal),
        supabase.from('reviews').select('*').in('order_id', ids).abortSignal(signal),
      ])
      const previous = client.getQueryData<OrderListItem[]>(key)
      return data.map((order) => ({
        ...order,
        order_items: items.error
          ? previous?.find((row) => row.id === order.id)?.order_items || []
          : items.data.filter((item) => item.order_id === order.id),
        review: reviews.error
          ? previous?.find((row) => row.id === order.id)?.review || null
          : reviews.data.find((review) => review.order_id === order.id) || null,
      }))
    },
  })
  const setOrders = useCallback(
    (update: (previous: OrderListItem[]) => OrderListItem[]) => {
      client.setQueryData<OrderListItem[]>(
        ['orders', viewerId || '', 'list', role || 'customer'],
        (previous) => update(previous || [])
      )
    },
    [client, viewerId, role]
  )
  const mutation = useMutation({
    mutationFn: ({ order, action }: { order: Order; action: OrderAction }) => {
      if (!viewerId) throw new Error('Silakan masuk kembali.')
      return updateOrder(order, viewerId, action)
    },
    onSuccess: async (updated) => {
      await client.cancelQueries({ queryKey: key })
      setOrders((previous) =>
        previous.map((order) => (order.id === updated.id ? { ...order, ...updated } : order))
      )
      await client.invalidateQueries({ queryKey: ['orders', viewerId] })
      await client.invalidateQueries({ queryKey: ['order-details', viewerId, updated.id] })
      await client.invalidateQueries({ queryKey: ['vendor'] })
    },
  })
  return { ...query, setOrders, updateOrder: mutation.mutateAsync }
}
export function useOrderDetails(initialOrder: Order) {
  const { user } = useAuth()
  const client = useQueryClient()
  const key = ['order-details', user?.id || '', initialOrder.id]
  useRealtimeQuerySync(key, [
    { table: 'orders', filter: `id=eq.${initialOrder.id}` },
    { table: 'vendors', filter: `id=eq.${initialOrder.vendor_id}` },
  ])
  return useQuery({
    queryKey: key,
    enabled: !!user,
    initialData: {
      order: initialOrder,
      vendor: null,
      items: [],
      review: null,
      detailError: false,
    } satisfies OrderBundle,
    initialDataUpdatedAt: 0,
    refetchInterval: 15_000,
    queryFn: ({ signal }) =>
      fetchOrderBundle(initialOrder, signal, client.getQueryData<OrderBundle>(key)),
  })
}
export function useUpdateOrderStatus(order: Order) {
  const { user } = useAuth()
  const client = useQueryClient()
  const lock = useRef(false)
  const mutation = useMutation({
    mutationFn: (action: OrderAction) => {
      if (!user) throw new Error('Silakan masuk kembali.')
      return updateOrder(order, user.id, action)
    },
    onSuccess: async (updated) => {
      await client.cancelQueries({ queryKey: ['order-details', user?.id, order.id] })
      client.setQueryData<OrderBundle>(['order-details', user?.id, order.id], (previous) =>
        previous ? { ...previous, order: updated } : undefined
      )
      client.setQueryData(['orders', user?.id, order.id], updated)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['orders', user?.id] }),
        client.invalidateQueries({ queryKey: ['order-details', user?.id, order.id] }),
        client.invalidateQueries({ queryKey: ['vendor'] }),
      ])
    },
  })
  return {
    ...mutation,
    execute: async (action: OrderAction) => {
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
