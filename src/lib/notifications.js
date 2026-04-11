import { useEffect, useRef, useState } from 'react'
import { loadIdentityMap } from './profiles'
import { supabase } from './supabase'

function statusLabel(status) {
  switch (status) {
    case 'accepted':
      return 'Pesanan Anda diterima pedagang.'
    case 'rejected':
      return 'Pesanan Anda ditolak pedagang.'
    case 'cancelled':
      return 'Pesanan dibatalkan.'
    default:
      return 'Status pesanan diperbarui.'
  }
}

export function useRealtimeNotifications({ user, role, pathname, search, toast }) {
  const [counts, setCounts] = useState({ messages: 0, orders: 0 })
  const routeRef = useRef({ pathname, search })

  useEffect(() => {
    routeRef.current = { pathname, search }
    const currentTab = new URLSearchParams(search).get('tab')
    if (pathname.startsWith('/chat')) {
      setCounts((current) => ({ ...current, messages: 0 }))
    }
    if (pathname === '/dashboard' && currentTab === 'orders') {
      setCounts((current) => ({ ...current, orders: 0 }))
    }
  }, [pathname, search])

  useEffect(() => {
    if (!user) {
      setCounts({ messages: 0, orders: 0 })
      return undefined
    }

    const messageChannel = supabase
      .channel(`app-messages-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const message = payload.new
        if (!message || message.from_user === user.id) return

        const currentPath = routeRef.current.pathname
        const currentSearch = routeRef.current.search
        const onChatScreen = currentPath.startsWith('/chat')

        let senderName = 'Pengguna'
        try {
          const identityMap = await loadIdentityMap([message.from_user])
          senderName = identityMap[message.from_user]?.name || senderName
        } catch (error) {
          console.warn('useRealtimeNotifications.messageIdentity', error)
        }

        toast.push(`Pesan baru dari ${senderName}`, { type: 'info' })
        if (!onChatScreen) {
          setCounts((current) => ({ ...current, messages: current.messages + 1 }))
        }

        if (currentPath === '/dashboard' && new URLSearchParams(currentSearch).get('tab') === 'orders') {
          setCounts((current) => ({ ...current, orders: 0 }))
        }
      })
      .subscribe()

    const orderChannel = supabase
      .channel(`app-orders-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        const order = payload.new
        if (!order) return

        const currentPath = routeRef.current.pathname
        const currentTab = new URLSearchParams(routeRef.current.search).get('tab')
        const onOrdersScreen = currentPath === '/dashboard' && currentTab === 'orders'

        if (role === 'vendor' && order.vendor_id === user.id && order.buyer_id !== user.id) {
          toast.push(`Pesanan baru dari ${order.buyer_name || 'pelanggan'}`, { type: 'success' })
          if (!onOrdersScreen) {
            setCounts((current) => ({ ...current, orders: current.orders + 1 }))
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        const order = payload.new
        if (!order) return

        const currentPath = routeRef.current.pathname
        const currentTab = new URLSearchParams(routeRef.current.search).get('tab')
        const onOrdersScreen = currentPath === '/dashboard' && currentTab === 'orders'

        if (role === 'customer' && order.buyer_id === user.id && order.status !== 'pending') {
          toast.push(statusLabel(order.status), { type: order.status === 'accepted' ? 'success' : 'info' })
          if (!onOrdersScreen) {
            setCounts((current) => ({ ...current, orders: current.orders + 1 }))
          }
        }
      })
      .subscribe()

    return () => {
      try {
        supabase.removeChannel(messageChannel)
      } catch (error) {
        console.error('removeMessageNotificationChannel', error)
      }

      try {
        supabase.removeChannel(orderChannel)
      } catch (error) {
        console.error('removeOrderNotificationChannel', error)
      }
    }
  }, [role, toast, user])

  return counts
}
