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
    case 'preparing':
      return 'Pesanan sedang disiapkan.'
    case 'on_the_way':
      return 'Pedagang sedang menuju titik temu.'
    case 'arrived':
      return 'Pedagang sudah tiba di sekitar Anda.'
    case 'completed':
      return 'Pesanan telah selesai.'
    default:
      return 'Status pesanan diperbarui.'
  }
}

function isOrdersScreen(pathname, search) {
  return pathname === '/dashboard' && new URLSearchParams(search).get('tab') === 'orders'
}

function rememberValue(setRef, value, maxSize = 200) {
  if (!value) return false
  const nextSet = new Set(setRef.current)
  if (nextSet.has(value)) {
    setRef.current = nextSet
    return false
  }

  nextSet.add(value)
  while (nextSet.size > maxSize) {
    const oldest = nextSet.values().next().value
    nextSet.delete(oldest)
  }

  setRef.current = nextSet
  return true
}

function buildOrderUpdateKey(order) {
  return `status:${order.id}:${order.status}:${order.updated_at || order.created_at || 'unknown'}`
}

function isCompatibilityError(error) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase()
  return text.includes('schema cache') || text.includes('does not exist') || text.includes('relation')
}

function getNotificationBucket(type) {
  return type === 'message_received' ? 'messages' : 'orders'
}

export function useRealtimeNotifications({ user, role, pathname, search, toast }) {
  const [counts, setCounts] = useState({ messages: 0, orders: 0 })
  const routeRef = useRef({ pathname, search })
  const chatIdsRef = useRef(new Set())
  const knownMessageIdsRef = useRef(new Set())
  const knownOrderEventKeysRef = useRef(new Set())
  const knownNotificationIdsRef = useRef(new Set())
  const latestNotificationAtRef = useRef(null)

  useEffect(() => {
    routeRef.current = { pathname, search }
    if (pathname.startsWith('/chat')) {
      setCounts((current) => ({ ...current, messages: 0 }))
    }
    if (isOrdersScreen(pathname, search)) {
      setCounts((current) => ({ ...current, orders: 0 }))
    }
  }, [pathname, search])

  useEffect(() => {
    if (!user) {
      chatIdsRef.current = new Set()
      knownMessageIdsRef.current = new Set()
      knownOrderEventKeysRef.current = new Set()
      knownNotificationIdsRef.current = new Set()
      latestNotificationAtRef.current = null
      setCounts({ messages: 0, orders: 0 })
      return undefined
    }

    let active = true
    const openChannels = []
    let pollId = null

    function cleanupChannels() {
      for (const channel of openChannels) {
        try {
          supabase.removeChannel(channel)
        } catch (error) {
          console.error('removeNotificationChannel', error)
        }
      }
    }

    function pushNotificationRow(notification, { quiet = false } = {}) {
      if (!notification || !rememberValue(knownNotificationIdsRef, notification.id)) return

      latestNotificationAtRef.current = notification.created_at || latestNotificationAtRef.current
      const bucket = getNotificationBucket(notification.type)
      const onChatScreen = routeRef.current.pathname.startsWith('/chat')
      const onOrdersPage = isOrdersScreen(routeRef.current.pathname, routeRef.current.search)
      const shouldMute =
        (bucket === 'messages' && onChatScreen) ||
        (bucket === 'orders' && onOrdersPage)

      if (!quiet && !shouldMute) {
        toast.push(notification.body || notification.title || 'Ada pembaruan baru', {
          type: bucket === 'orders' ? 'success' : 'info',
        })
      }

      if (!shouldMute) {
        setCounts((current) => ({ ...current, [bucket]: current[bucket] + 1 }))
      }
    }

    async function tryStartNotificationInboxMode() {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('id, type, title, body, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50)

        if (error) throw error

        const rows = data || []
        knownNotificationIdsRef.current = new Set(rows.map((row) => row.id))
        latestNotificationAtRef.current = rows[0]?.created_at || null

        const notificationChannel = supabase
          .channel(`app-notifications-${user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${user.id}`,
            },
            (payload) => {
              pushNotificationRow(payload.new)
            }
          )
          .subscribe()

        openChannels.push(notificationChannel)

        pollId = window.setInterval(async () => {
          if (document.visibilityState === 'hidden') return

          try {
            let query = supabase
              .from('notifications')
              .select('id, type, title, body, created_at')
              .eq('user_id', user.id)
              .order('created_at', { ascending: true })
              .limit(30)

            if (latestNotificationAtRef.current) {
              query = query.gt('created_at', latestNotificationAtRef.current)
            }

            const { data: nextRows, error: nextError } = await query
            if (nextError) throw nextError

            for (const row of nextRows || []) {
              pushNotificationRow(row)
            }
          } catch (error) {
            console.warn('pollNotifications.inbox', error)
          }
        }, 5000)

        return true
      } catch (error) {
        if (!isCompatibilityError(error)) {
          console.warn('tryStartNotificationInboxMode', error)
        }
        return false
      }
    }

    async function refreshChatIds() {
      const { data, error } = await supabase
        .from('chats')
        .select('id')
        .contains('participants', [user.id])

      if (error) throw error
      chatIdsRef.current = new Set((data || []).map((chat) => chat.id))
    }

    async function handleIncomingMessage(message, { quiet = false } = {}) {
      if (!active || !message || message.from_user === user.id) return
      if (!chatIdsRef.current.has(message.chat_id)) return

      const isNewMessage = rememberValue(knownMessageIdsRef, message.id)
      if (!isNewMessage) return

      const onChatScreen = routeRef.current.pathname.startsWith('/chat')

      if (!quiet && !onChatScreen) {
        let senderName = 'Pengguna'
        try {
          const identityMap = await loadIdentityMap([message.from_user])
          senderName = identityMap[message.from_user]?.name || senderName
        } catch (error) {
          console.warn('handleIncomingMessage.identity', error)
        }

        toast.push(`Pesan baru dari ${senderName}`, { type: 'info' })
      }

      if (!onChatScreen) {
        setCounts((current) => ({ ...current, messages: current.messages + 1 }))
      }
    }

    function handleOrderInsert(order, { quiet = false } = {}) {
      if (!active || !order) return
      if (role !== 'vendor' || order.vendor_id !== user.id || order.buyer_id === user.id) return

      const isNewOrder = rememberValue(knownOrderEventKeysRef, `insert:${order.id}`)
      if (!isNewOrder) return

      if (!quiet) {
        toast.push(`Pesanan baru dari ${order.buyer_name || 'pelanggan'}`, { type: 'success' })
      }

      if (!isOrdersScreen(routeRef.current.pathname, routeRef.current.search)) {
        setCounts((current) => ({ ...current, orders: current.orders + 1 }))
      }
    }

    function handleOrderUpdate(order, { quiet = false } = {}) {
      if (!active || !order) return
      if (role !== 'customer' || order.buyer_id !== user.id || order.status === 'pending') return

      const isNewUpdate = rememberValue(knownOrderEventKeysRef, buildOrderUpdateKey(order))
      if (!isNewUpdate) return

      if (!quiet) {
        toast.push(statusLabel(order.status), {
          type: order.status === 'accepted' || order.status === 'completed' ? 'success' : 'info',
        })
      }

      if (!isOrdersScreen(routeRef.current.pathname, routeRef.current.search)) {
        setCounts((current) => ({ ...current, orders: current.orders + 1 }))
      }
    }

    async function primeLegacyNotificationState() {
      await refreshChatIds()

      if (chatIdsRef.current.size > 0) {
        const { data: messageRows, error: messageError } = await supabase
          .from('messages')
          .select('id, chat_id, from_user')
          .in('chat_id', [...chatIdsRef.current])
          .order('created_at', { ascending: false })
          .limit(60)

        if (messageError) throw messageError
        knownMessageIdsRef.current = new Set((messageRows || []).map((message) => message.id))
      } else {
        knownMessageIdsRef.current = new Set()
      }

      let orderQuery = supabase
        .from('orders')
        .select('id, status, buyer_id, vendor_id, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(60)

      orderQuery = role === 'vendor'
        ? orderQuery.eq('vendor_id', user.id)
        : orderQuery.eq('buyer_id', user.id)

      const { data: orderRows, error: orderError } = await orderQuery
      if (orderError) throw orderError

      const initialOrderKeys = new Set()
      for (const order of orderRows || []) {
        initialOrderKeys.add(`insert:${order.id}`)
        initialOrderKeys.add(buildOrderUpdateKey(order))
      }
      knownOrderEventKeysRef.current = initialOrderKeys
    }

    async function pollLegacyNotifications() {
      try {
        await refreshChatIds()

        const chatIds = [...chatIdsRef.current]
        if (chatIds.length > 0) {
          const { data: messageRows, error: messageError } = await supabase
            .from('messages')
            .select('id, chat_id, from_user, created_at')
            .in('chat_id', chatIds)
            .order('created_at', { ascending: false })
            .limit(20)

          if (messageError) throw messageError

          for (const message of [...(messageRows || [])].reverse()) {
            await handleIncomingMessage(message)
          }
        }

        let orderQuery = supabase
          .from('orders')
          .select('id, status, buyer_id, buyer_name, vendor_id, vendor_name, created_at, updated_at')
          .order('updated_at', { ascending: false })
          .limit(20)

        orderQuery = role === 'vendor'
          ? orderQuery.eq('vendor_id', user.id)
          : orderQuery.eq('buyer_id', user.id)

        const { data: orderRows, error: orderError } = await orderQuery
        if (orderError) throw orderError

        for (const order of [...(orderRows || [])].reverse()) {
          handleOrderInsert(order)
          handleOrderUpdate(order)
        }
      } catch (error) {
        console.warn('pollNotifications.legacy', error)
      }
    }

    async function startLegacyMode() {
      try {
        await primeLegacyNotificationState()
      } catch (error) {
        console.error('primeLegacyNotificationState', error)
      }

      if (!active) return

      const messageChannel = supabase
        .channel(`app-messages-${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
          void handleIncomingMessage(payload.new)
        })
        .subscribe()

      const orderChannel = supabase
        .channel(`app-orders-${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
          handleOrderInsert(payload.new)
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
          handleOrderUpdate(payload.new)
        })
        .subscribe()

      const chatChannel = supabase
        .channel(`app-chats-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, (payload) => {
          const participants = payload.new?.participants || payload.old?.participants || []
          if (!participants.includes(user.id)) return

          const nextChatIds = new Set(chatIdsRef.current)
          if (payload.eventType === 'DELETE') {
            nextChatIds.delete(payload.old?.id)
          } else if (payload.new?.id) {
            nextChatIds.add(payload.new.id)
          }
          chatIdsRef.current = nextChatIds
        })
        .subscribe()

      openChannels.push(messageChannel, orderChannel, chatChannel)

      pollId = window.setInterval(() => {
        if (document.visibilityState === 'hidden') return
        void pollLegacyNotifications()
      }, 5000)
    }

    async function startNotifications() {
      const inboxModeStarted = await tryStartNotificationInboxMode()
      if (inboxModeStarted || !active) return
      await startLegacyMode()
    }

    void startNotifications()

    return () => {
      active = false
      if (pollId) window.clearInterval(pollId)
      cleanupChannels()
    }
  }, [role, toast, user])

  return counts
}
