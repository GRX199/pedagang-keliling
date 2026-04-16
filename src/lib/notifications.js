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

export function useRealtimeNotifications({ user, role, pathname, search, toast }) {
  const [counts, setCounts] = useState({ messages: 0, orders: 0 })
  const routeRef = useRef({ pathname, search })
  const chatIdsRef = useRef(new Set())
  const knownMessageIdsRef = useRef(new Set())
  const knownOrderEventKeysRef = useRef(new Set())

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
      setCounts({ messages: 0, orders: 0 })
      return undefined
    }

    let active = true
    let messageChannel = null
    let orderChannel = null
    let chatChannel = null
    let pollId = null

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
          type: order.status === 'accepted' ? 'success' : 'info',
        })
      }

      if (!isOrdersScreen(routeRef.current.pathname, routeRef.current.search)) {
        setCounts((current) => ({ ...current, orders: current.orders + 1 }))
      }
    }

    async function primeNotificationState() {
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

    async function pollNotifications() {
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
        console.warn('pollNotifications', error)
      }
    }

    async function startNotifications() {
      try {
        await primeNotificationState()
      } catch (error) {
        console.error('primeNotificationState', error)
      }

      if (!active) return

      messageChannel = supabase
        .channel(`app-messages-${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
          void handleIncomingMessage(payload.new)
        })
        .subscribe()

      orderChannel = supabase
        .channel(`app-orders-${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
          handleOrderInsert(payload.new)
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
          handleOrderUpdate(payload.new)
        })
        .subscribe()

      chatChannel = supabase
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

      pollId = window.setInterval(() => {
        if (document.visibilityState === 'hidden') return
        void pollNotifications()
      }, 5000)
    }

    void startNotifications()

    return () => {
      active = false
      if (pollId) window.clearInterval(pollId)

      if (messageChannel) {
        try {
          supabase.removeChannel(messageChannel)
        } catch (error) {
          console.error('removeMessageNotificationChannel', error)
        }
      }

      if (orderChannel) {
        try {
          supabase.removeChannel(orderChannel)
        } catch (error) {
          console.error('removeOrderNotificationChannel', error)
        }
      }

      if (chatChannel) {
        try {
          supabase.removeChannel(chatChannel)
        } catch (error) {
          console.error('removeChatNotificationChannel', error)
        }
      }
    }
  }, [role, toast, user])

  return counts
}
