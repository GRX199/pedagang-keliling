import { useCallback, useRef } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../shared/lib/supabase'
import { useRealtimeQuerySync } from '../../shared/hooks/useRealtimeQuerySync'
import { isSchemaCompatibilityError } from '../../lib/orders'
import type { Order, Role } from '../../types/domain.types'
import type { DateCursor } from '../../shared/lib/keyset'
import {
  fetchOrderPage,
  updateOrderLists,
  type OrderListOptions,
  type OrderPage,
  type OrderPages
} from './order-list'
import type { OrderListItem } from './order-list'
export type { OrderListItem } from './order-list'
import type { Database } from '../../types/database.types'
import {
  fetchOrder,
  fetchOrderBundle,
  updateOrder,
  type OrderAction,
  type OrderBundle
} from './api'

export function useCreatePickupOrder() {
  const client = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationKey: ['orders-create', user?.id],
    mutationFn: async (
      args: Database['public']['Functions']['create_pickup_order']['Args']
    ) => {
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
        client.invalidateQueries({ queryKey: ['products'] })
      ])
    }
  })
}

export function useOrder(id: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['orders', user?.id, id],
    enabled: !!id && !!user,
    queryFn: ({ signal }) => fetchOrder(id!, signal)
  })
}
export function useOrders(
  viewerId: string | undefined,
  role: Role | null,
  options: OrderListOptions = { scope: 'active' }
) {
  const client = useQueryClient()
  const prefix = ['orders', viewerId || '', 'list', role || 'customer']
  const key = [
    ...prefix,
    'v2',
    options.scope,
    options.status || 'all',
    options.search || ''
  ]
  const connection = useRealtimeQuerySync(
    prefix,
    [
      {
        table: 'orders',
        filter: `${role === 'vendor' ? 'vendor_id' : 'buyer_id'}=eq.${viewerId}`
      }
    ],
    options.scope === 'active'
  )
  const query = useInfiniteQuery<
    OrderPage,
    Error,
    OrderPages,
    string[],
    DateCursor | null
  >({
    queryKey: key,
    enabled: !!viewerId && !!role && options.enabled !== false,
    refetchInterval: options.scope === 'active' ? 15_000 : 60_000,
    initialPageParam: null as DateCursor | null,
    getNextPageParam: (page) => page.next,
    queryFn: ({ signal, pageParam }) =>
      fetchOrderPage(viewerId!, role!, options, pageParam, signal)
  })
  const setOrders = useCallback(
    (update: (previous: OrderListItem[]) => OrderListItem[]) => {
      if (viewerId) updateOrderLists(client, viewerId, update)
    },
    [client, viewerId]
  )
  const mutation = useMutation({
    mutationKey: ['orders-update', viewerId],
    mutationFn: ({ order, action }: { order: Order; action: OrderAction }) => {
      if (!viewerId) throw new Error('Silakan masuk kembali.')
      return updateOrder(order, viewerId, action)
    },
    onSuccess: async (updated) => {
      await client.cancelQueries({ queryKey: ['orders', viewerId, 'list'] })
      setOrders((previous) =>
        previous.map((order) =>
          order.id === updated.id ? { ...order, ...updated } : order
        )
      )
      await client.invalidateQueries({ queryKey: ['orders', viewerId] })
      await client.invalidateQueries({
        queryKey: ['order-details', viewerId, updated.id]
      })
      await client.invalidateQueries({ queryKey: ['vendor'] })
    }
  })
  const orders = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .map((order) => [order.id, order])
    ).values()
  ]
  return {
    ...query,
    orders,
    connection,
    setOrders,
    updateOrder: mutation.mutateAsync
  }
}
export function useOrderDetails(initialOrder: Order) {
  const { user } = useAuth()
  const client = useQueryClient()
  const key = ['order-details', user?.id || '', initialOrder.id]
  useRealtimeQuerySync(key, [
    { table: 'orders', filter: `id=eq.${initialOrder.id}` },
    { table: 'vendors', filter: `id=eq.${initialOrder.vendor_id}` }
  ])
  return useQuery({
    queryKey: key,
    enabled: !!user,
    initialData: {
      order: initialOrder,
      vendor: null,
      items: [],
      review: null,
      detailError: false
    } satisfies OrderBundle,
    initialDataUpdatedAt: 0,
    refetchInterval: 15_000,
    queryFn: ({ signal }) =>
      fetchOrderBundle(
        initialOrder,
        signal,
        client.getQueryData<OrderBundle>(key)
      )
  })
}
export function useUpdateOrderStatus(order: Order) {
  const { user } = useAuth()
  const client = useQueryClient()
  const lock = useRef(false)
  const mutation = useMutation({
    mutationKey: ['orders-update', user?.id],
    mutationFn: (action: OrderAction) => {
      if (!user) throw new Error('Silakan masuk kembali.')
      return updateOrder(order, user.id, action)
    },
    onSuccess: async (updated) => {
      await client.cancelQueries({
        queryKey: ['order-details', user?.id, order.id]
      })
      client.setQueryData<OrderBundle>(
        ['order-details', user?.id, order.id],
        (previous) => (previous ? { ...previous, order: updated } : undefined)
      )
      client.setQueryData(['orders', user?.id, order.id], updated)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['orders', user?.id] }),
        client.invalidateQueries({
          queryKey: ['order-details', user?.id, order.id]
        }),
        client.invalidateQueries({ queryKey: ['vendor'] })
      ])
    }
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
    }
  }
}
