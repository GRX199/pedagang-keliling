import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { findOrCreateDirectChat, sendChatMessage } from '../lib/conversations'
import {
  formatFulfillmentTypeLabel,
  formatOrderStatusLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatPriceLabel,
  isActiveOrderStatus,
} from '../lib/orders'
import { uploadImageFile } from '../lib/media'
import { loadIdentityMap } from '../lib/profiles'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useToast } from './ToastProvider'

const IMAGE_MESSAGE_PREFIX = '[kelilingku:image] '

function buildImageMessageText(imageUrl, caption = '') {
  return `${IMAGE_MESSAGE_PREFIX}${JSON.stringify({
    url: imageUrl,
    caption: String(caption || '').trim(),
  })}`
}

function parseImageMessageText(text) {
  const value = String(text || '')
  if (!value.startsWith(IMAGE_MESSAGE_PREFIX)) return null

  try {
    const payload = JSON.parse(value.slice(IMAGE_MESSAGE_PREFIX.length))
    if (!payload?.url) return null
    return {
      url: String(payload.url),
      caption: String(payload.caption || '').trim(),
    }
  } catch (error) {
    console.warn('parseImageMessageText', error)
    return null
  }
}

function getPartnerId(chat, currentUserId) {
  return (chat?.participants || []).find((participant) => participant !== currentUserId) || null
}

function getPartnerLabel(chat, currentUserId, vendorMap) {
  const partnerId = getPartnerId(chat, currentUserId)
  if (!partnerId) return 'Percakapan'
  return vendorMap[partnerId]?.name || 'Pengguna'
}

function pickFeaturedOrder(orderRows, preferredOrderId = null) {
  if (!Array.isArray(orderRows) || orderRows.length === 0) return null

  if (preferredOrderId) {
    const preferred = orderRows.find((order) => String(order.id) === String(preferredOrderId))
    if (preferred) return preferred
  }

  const activeOrder = orderRows.find((order) => isActiveOrderStatus(order.status))
  if (activeOrder) return activeOrder

  return orderRows[0] || null
}

function OrderContextCard({ currentUser, order, partnerLabel, relatedCount, onOpenOrders, onTrackOrder }) {
  if (!order) return null

  const counterpartName = order.vendor_id === currentUser?.id
    ? (order.buyer_name || partnerLabel || 'Pelanggan')
    : (order.vendor_name || partnerLabel || 'Pedagang')

  const isActive = isActiveOrderStatus(order.status)

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[20px] bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 p-3 text-white shadow-sm sm:rounded-[24px] sm:p-4">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-2xl">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-300">Order Terkait</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="break-words text-base font-semibold tracking-tight sm:text-lg">
              Pesanan #{String(order.id).slice(0, 8)}
            </div>
            <span className="max-w-full rounded-full bg-white/10 px-3 py-1 text-xs font-medium leading-tight text-slate-100 ring-1 ring-white/10">
              {formatOrderStatusLabel(order.status)}
            </span>
          </div>
          <div className="mt-2 break-words text-sm text-slate-200">
            {counterpartName}
            {relatedCount > 1 ? ` • ${relatedCount} transaksi terkait` : ''}
          </div>
          <p className="mt-2 hidden text-sm leading-6 text-slate-300 sm:block">
            {isActive
              ? 'Order aktif ini diprioritaskan supaya percakapan tetap fokus ke transaksi yang sedang berjalan.'
              : 'Order terbaru yang terkait dengan percakapan ini tetap bisa dibuka lagi untuk klarifikasi atau tindak lanjut.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button
            onClick={onTrackOrder}
            className="min-w-0 rounded-2xl bg-white px-4 py-3 text-sm font-medium leading-tight text-slate-900 transition hover:bg-slate-100"
          >
            Lacak
          </button>
          <button
            onClick={onOpenOrders}
            className="min-w-0 whitespace-normal rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium leading-tight text-white transition hover:bg-white/15"
          >
            Pesanan
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/10 px-3 py-3 text-sm text-slate-200 md:hidden">
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
          <span>{formatPaymentMethodLabel(order.payment_method)}</span>
          <span>{formatPaymentStatusLabel(order.payment_status)}</span>
          <span>{formatFulfillmentTypeLabel(order.fulfillment_type)}</span>
        </div>
        <div className="mt-2 line-clamp-2 break-words text-xs leading-5 text-slate-300">
          {Number(order.total_amount || 0) > 0
            ? `${formatPriceLabel(order.total_amount)} • `
            : ''}
          {order.customer_note || order.meeting_point_label || 'Gunakan chat ini untuk konfirmasi stok, waktu, atau titik temu.'}
        </div>
      </div>

      <div className="mt-4 hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Pembayaran</div>
          <div className="mt-1 text-sm font-medium text-white">
            {formatPaymentMethodLabel(order.payment_method)}
          </div>
          <div className="mt-1 text-xs text-slate-300">{formatPaymentStatusLabel(order.payment_status)}</div>
        </div>

        <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Serah Terima</div>
          <div className="mt-1 text-sm font-medium text-white">
            {formatFulfillmentTypeLabel(order.fulfillment_type)}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {order.meeting_point_label || 'Akan dikonfirmasi di chat'}
          </div>
        </div>

        <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Total</div>
          <div className="mt-1 text-sm font-medium text-white">
            {Number(order.total_amount || 0) > 0 ? formatPriceLabel(order.total_amount) : 'Menyesuaikan harga produk'}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {order.created_at ? new Date(order.created_at).toLocaleString('id-ID') : 'Baru dibuat'}
          </div>
        </div>

        <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-300">Catatan</div>
          <div className="mt-1 text-sm font-medium text-white">
            {order.customer_note ? 'Ada catatan pelanggan' : 'Tanpa catatan khusus'}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {order.customer_note || 'Gunakan chat ini untuk konfirmasi stok, waktu, atau titik temu.'}
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatThread({ chatId, currentUser, onMessageActivity }) {
  const toast = useToast()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const endRef = useRef(null)
  const fileInputRef = useRef(null)
  const messageIdsRef = useRef(new Set())
  const latestMessageAtRef = useRef(null)

  function applyMessageRows(incomingRows, { replace = false } = {}) {
    setMessages((current) => {
      const nextMap = new Map()

      if (!replace) {
        for (const row of current) {
          if (row?.id) nextMap.set(row.id, row)
        }
      }

      for (const row of incomingRows || []) {
        if (row?.id) nextMap.set(row.id, row)
      }

      const nextRows = [...nextMap.values()].sort((left, right) => {
        const leftTime = new Date(left.created_at || 0).getTime()
        const rightTime = new Date(right.created_at || 0).getTime()
        return leftTime - rightTime
      })

      messageIdsRef.current = new Set(nextRows.map((row) => row.id))
      latestMessageAtRef.current = nextRows.at(-1)?.created_at || null
      return nextRows
    })
  }

  useEffect(() => {
    if (!chatId || !currentUser) return undefined

    let active = true

    async function loadMessages() {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true })

        if (error) throw error
        if (active) applyMessageRows(data || [], { replace: true })
      } catch (error) {
        console.error('loadMessages', error)
        toast.push('Gagal memuat pesan', { type: 'error' })
      }
    }

    async function pollNewMessages() {
      try {
        let query = supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true })

        if (latestMessageAtRef.current) {
          query = query.gt('created_at', latestMessageAtRef.current)
        }

        const { data, error } = await query
        if (error) throw error
        if (active && (data || []).length > 0) {
          applyMessageRows(data || [])
          for (const message of data || []) {
            onMessageActivity?.(chatId, message)
          }
        }
      } catch (error) {
        console.warn('pollNewMessages', error)
      }
    }

    loadMessages()

    const channel = supabase
      .channel(`messages-${chatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          if (!payload.new?.id || messageIdsRef.current.has(payload.new.id)) return
          applyMessageRows([payload.new])
          onMessageActivity?.(chatId, payload.new)
        }
      )
      .subscribe()

    const intervalId = window.setInterval(() => {
      void pollNewMessages()
    }, 4000)

    return () => {
      active = false
      window.clearInterval(intervalId)
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeMessagesChannel', error)
      }
    }
  }, [chatId, currentUser, onMessageActivity, toast])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (sending || !chatId || !currentUser || !text.trim()) return

    setSending(true)
    try {
      const message = await sendChatMessage(chatId, currentUser.id, text.trim())
      applyMessageRows(message ? [message] : [])
      onMessageActivity?.(chatId, message)
      setText('')
    } catch (error) {
      console.error('sendMessage', error)
      toast.push(error.message || 'Gagal mengirim pesan', { type: 'error' })
    } finally {
      setSending(false)
    }
  }

  async function sendImageMessage(file) {
    if (sending || !chatId || !currentUser || !file) return

    const caption = text.trim() || 'Bukti pembayaran'
    setSending(true)
    setUploadingImage(true)
    try {
      const imageUrl = await uploadImageFile({
        file,
        vendorId: currentUser.id,
        folder: 'chat',
      })
      if (!imageUrl) throw new Error('Gagal mendapatkan URL foto')

      const message = await sendChatMessage(chatId, currentUser.id, buildImageMessageText(imageUrl, caption))
      applyMessageRows(message ? [message] : [])
      onMessageActivity?.(chatId, message)
      setText('')
      toast.push('Foto berhasil dikirim', { type: 'success' })
    } catch (error) {
      console.error('sendImageMessage', error)
      toast.push(error.message || 'Gagal mengirim foto', { type: 'error' })
    } finally {
      setUploadingImage(false)
      setSending(false)
    }
  }

  function handleImageInputChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void sendImageMessage(file)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto rounded-2xl border border-slate-100 bg-slate-50 p-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Belum ada pesan. Mulai percakapan dari sini.
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.from_user === currentUser.id
            const imageMessage = parseImageMessageText(message.text)
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] overflow-hidden rounded-2xl px-3 py-2 text-sm sm:max-w-[85%] ${
                    mine
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  }`}
                >
                  {imageMessage ? (
                    <div className="space-y-2">
                      <a
                        href={imageMessage.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-xl bg-black/10"
                      >
                        <img
                          src={imageMessage.url}
                          alt={imageMessage.caption || 'Foto chat'}
                          loading="lazy"
                          className="max-h-72 w-full object-cover"
                        />
                      </a>
                      {imageMessage.caption ? (
                        <div className="whitespace-pre-wrap break-words">{imageMessage.caption}</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words">{message.text}</div>
                  )}
                  <div className={`mt-1 break-words text-right text-xs ${mine ? 'text-slate-300' : 'text-slate-400'}`}>
                    {message.created_at ? new Date(message.created_at).toLocaleString('id-ID') : '-'}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageInputChange}
        />
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              sendMessage()
            }
          }}
          rows={1}
          className="min-h-[48px] min-w-0 flex-1 resize-none rounded-2xl border border-slate-200 px-4 py-3"
          placeholder="Ketik pesan atau catatan bukti pembayaran..."
        />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || !chatId || !currentUser}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 sm:min-w-24"
          >
            {uploadingImage ? 'Upload...' : 'Foto'}
          </button>
          <button
            onClick={sendMessage}
            disabled={sending || !text.trim()}
            className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400 sm:min-w-24"
          >
            {sending && !uploadingImage ? 'Mengirim...' : 'Kirim'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChatWorkspace({ initialVendorId = null, initialOrderId = null, embedded = false }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const [chats, setChats] = useState([])
  const [vendorMap, setVendorMap] = useState({})
  const [selectedChatId, setSelectedChatId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [creatingChat, setCreatingChat] = useState(false)
  const [showInboxMobile, setShowInboxMobile] = useState(true)
  const [relatedOrders, setRelatedOrders] = useState([])
  const [loadingRelatedOrders, setLoadingRelatedOrders] = useState(false)

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) || null,
    [chats, selectedChatId]
  )
  const selectedPartnerId = useMemo(
    () => getPartnerId(selectedChat, user?.id),
    [selectedChat, user?.id]
  )
  const selectedPartnerLabel = useMemo(
    () => getPartnerLabel(selectedChat, user?.id, vendorMap),
    [selectedChat, user?.id, vendorMap]
  )
  const featuredOrder = useMemo(
    () => pickFeaturedOrder(relatedOrders, initialOrderId),
    [initialOrderId, relatedOrders]
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    function handleResize() {
      if (window.innerWidth >= 1024) {
        setShowInboxMobile(true)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  async function hydratePartners(chatRows) {
    const partnerIds = [...new Set(
      chatRows
        .flatMap((chat) => chat.participants || [])
        .filter((participant) => participant && participant !== user?.id)
    )]

    if (partnerIds.length === 0) {
      setVendorMap({})
      return
    }

    try {
      const nextMap = await loadIdentityMap(partnerIds)
      const missingIds = partnerIds.filter((partnerId) => !nextMap[partnerId])

      if (missingIds.length > 0 && user?.id) {
        const { data: orderRows, error } = await supabase
          .from('orders')
          .select('vendor_id, vendor_name, buyer_id, buyer_name')
          .or(`vendor_id.eq.${user.id},buyer_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
          .limit(200)

        if (error) throw error

        for (const order of orderRows || []) {
          if (!nextMap[order.buyer_id] && missingIds.includes(order.buyer_id)) {
            nextMap[order.buyer_id] = {
              id: order.buyer_id,
              name: order.buyer_name || 'Pelanggan',
              photo_url: null,
              role: 'customer',
            }
          }

          if (!nextMap[order.vendor_id] && missingIds.includes(order.vendor_id)) {
            nextMap[order.vendor_id] = {
              id: order.vendor_id,
              name: order.vendor_name || 'Pedagang',
              photo_url: null,
              role: 'vendor',
            }
          }
        }
      }

      setVendorMap(nextMap)
    } catch (error) {
      console.error('hydratePartners', error)
      setVendorMap({})
    }
  }

  async function fetchChats({ preferredChatId = null, background = false, silent = false } = {}) {
    if (!user) return

    if (!background) {
      setLoading(true)
    }
    try {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .contains('participants', [user.id])
        .order('last_updated', { ascending: false })

      if (error) throw error

      const chatRows = data || []
      setChats(chatRows)
      await hydratePartners(chatRows)
      setSelectedChatId((current) => {
        if (preferredChatId && chatRows.some((chat) => chat.id === preferredChatId)) {
          return preferredChatId
        }
        if (current && chatRows.some((chat) => chat.id === current)) {
          return current
        }
        return chatRows[0]?.id || null
      })
    } catch (error) {
      console.error('fetchChats', error)
      if (!silent) {
        toast.push(error.message || 'Gagal memuat daftar chat', { type: 'error' })
      }
    } finally {
      if (!background) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!user) return undefined

    void fetchChats()

    const channel = supabase
      .channel(`chats-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, (payload) => {
        const participants = payload.new?.participants || payload.old?.participants || []
        if (!participants.includes(user.id)) return
        void fetchChats({ background: true, silent: true })
      })
      .subscribe()

    const intervalId = window.setInterval(() => {
      void fetchChats({ background: true, silent: true })
    }, 10000)

    return () => {
      window.clearInterval(intervalId)
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeChatsChannel', error)
      }
    }
  }, [user])

  useEffect(() => {
    if (!user || !initialVendorId || initialVendorId === user.id) return undefined

    let active = true

    async function ensureDirectChat() {
      setCreatingChat(true)
      try {
        const chat = await findOrCreateDirectChat(user.id, initialVendorId)
        if (active) {
          setSelectedChatId(chat.id)
          void fetchChats({ preferredChatId: chat.id, background: true, silent: true })
        }
      } catch (error) {
        console.error('ensureDirectChat', error)
        toast.push(error.message || 'Gagal membuka chat vendor', { type: 'error' })
      } finally {
        if (active) setCreatingChat(false)
      }
    }

    ensureDirectChat()

    return () => {
      active = false
    }
  }, [initialVendorId, toast, user])

  useEffect(() => {
    if (!selectedChatId) {
      setShowInboxMobile(true)
      return
    }

    if (initialVendorId && typeof window !== 'undefined' && window.innerWidth < 1024) {
      setShowInboxMobile(false)
    }
  }, [initialVendorId, selectedChatId])

  function selectChat(chatId) {
    setSelectedChatId(chatId)
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setShowInboxMobile(false)
    }
  }

  function handleMessageActivity(chatId, message) {
    if (!chatId || !message) return

    setChats((current) => {
      const currentIndex = current.findIndex((chat) => chat.id === chatId)
      if (currentIndex === -1) return current

      const nextRows = [...current]
      const [chat] = nextRows.splice(currentIndex, 1)
      nextRows.unshift({
        ...chat,
        last_updated: message.created_at || new Date().toISOString(),
      })
      return nextRows
    })
  }

  useEffect(() => {
    if (!user?.id || !selectedPartnerId) {
      setRelatedOrders([])
      setLoadingRelatedOrders(false)
      return undefined
    }

    let active = true

    async function fetchRelatedOrders({ background = false, silent = false } = {}) {
      if (!background) setLoadingRelatedOrders(true)

      try {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .or(`and(vendor_id.eq.${user.id},buyer_id.eq.${selectedPartnerId}),and(vendor_id.eq.${selectedPartnerId},buyer_id.eq.${user.id})`)
          .order('created_at', { ascending: false })
          .limit(24)

        if (error) throw error
        if (!active) return

        setRelatedOrders(data || [])
      } catch (error) {
        console.error('fetchRelatedOrders', error)
        if (!silent && active) {
          toast.push(error.message || 'Gagal memuat konteks pesanan di chat', { type: 'error' })
        }
      } finally {
        if (active && !background) {
          setLoadingRelatedOrders(false)
        }
      }
    }

    void fetchRelatedOrders()

    const channel = supabase
      .channel(`chat-orders-${user.id}-${selectedPartnerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        const row = payload.new || payload.old
        if (!row) return

        const participants = [row.vendor_id, row.buyer_id]
        if (!participants.includes(user.id) || !participants.includes(selectedPartnerId)) return

        void fetchRelatedOrders({ background: true, silent: true })
      })
      .subscribe()

    const intervalId = window.setInterval(() => {
      void fetchRelatedOrders({ background: true, silent: true })
    }, 10000)

    return () => {
      active = false
      window.clearInterval(intervalId)
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeRelatedOrdersChannel', error)
      }
    }
  }, [selectedPartnerId, toast, user?.id])

  return (
    <div className={`grid min-w-0 max-w-full gap-4 ${embedded ? 'grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)]' : 'grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]'}`}>
      <div className={`min-w-0 overflow-hidden rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] ${selectedChat && !showInboxMobile ? 'hidden lg:block' : ''}`}>
        <div className="mb-3 flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-semibold text-slate-900">Daftar Chat</div>
            <div className="text-sm text-slate-500">Pilih percakapan.</div>
          </div>
        </div>

        <div className="space-y-2">
          {loading || creatingChat ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
              Memuat percakapan...
            </div>
          ) : chats.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
              Belum ada percakapan.
            </div>
          ) : (
            chats.map((chat) => {
              const active = chat.id === selectedChatId
              const partnerId = getPartnerId(chat, user?.id)
              const partner = vendorMap[partnerId]

              return (
                <button
                  key={chat.id}
                  onClick={() => selectChat(chat.id)}
                  className={`flex min-w-0 w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                    active
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="h-11 w-11 overflow-hidden rounded-full bg-slate-100">
                    {partner?.photo_url ? (
                      <img src={partner.photo_url} alt={partner.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
                        {(partner?.name || 'P')[0]}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-900">
                      {getPartnerLabel(chat, user?.id, vendorMap)}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {chat.last_updated ? new Date(chat.last_updated).toLocaleString('id-ID') : 'Belum ada aktivitas'}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className={`min-w-0 max-w-full overflow-hidden rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-4 ${selectedChat && !showInboxMobile ? 'block' : 'hidden lg:block'}`}>
        {selectedChat ? (
          <>
            <div className="mb-3 border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-slate-500">Sedang chat dengan</div>
                  <div className="truncate font-semibold text-slate-900">
                    {selectedPartnerLabel}
                  </div>
                </div>

                <button
                  onClick={() => setShowInboxMobile(true)}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 lg:hidden"
                >
                  Kembali
                </button>
              </div>
            </div>
            <div className="min-w-0 space-y-3">
              {loadingRelatedOrders ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  Menautkan pesanan terkait ke percakapan ini...
                </div>
              ) : featuredOrder ? (
                <OrderContextCard
                  currentUser={user}
                  order={featuredOrder}
                  partnerLabel={selectedPartnerLabel}
                  relatedCount={relatedOrders.length}
                  onTrackOrder={() => navigate(`/orders/${featuredOrder.id}`)}
                  onOpenOrders={() => navigate('/dashboard?tab=orders')}
                />
              ) : null}

              <div
                className={embedded
                  ? (featuredOrder ? 'h-[50vh] min-h-[360px] sm:h-[50vh]' : 'h-[62vh] min-h-[420px] sm:h-[60vh]')
                  : (featuredOrder ? 'h-[58vh] min-h-[390px] sm:h-[58vh]' : 'h-[70vh] min-h-[460px] sm:h-[70vh]')}
              >
              <ChatThread
                chatId={selectedChat.id}
                currentUser={user}
                onMessageActivity={handleMessageActivity}
              />
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-slate-500">
            Pilih chat di sebelah kiri untuk mulai percakapan.
          </div>
        )}
      </div>
    </div>
  )
}
