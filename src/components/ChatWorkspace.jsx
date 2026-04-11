import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useToast } from './ToastProvider'

function getPartnerId(chat, currentUserId) {
  return (chat?.participants || []).find((participant) => participant !== currentUserId) || null
}

function getPartnerLabel(chat, currentUserId, vendorMap) {
  const partnerId = getPartnerId(chat, currentUserId)
  if (!partnerId) return 'Percakapan'
  return vendorMap[partnerId]?.name || 'Pelanggan'
}

function ChatThread({ chatId, currentUser }) {
  const toast = useToast()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

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
        if (active) setMessages(data || [])
      } catch (error) {
        console.error('loadMessages', error)
        toast.push('Gagal memuat pesan', { type: 'error' })
      }
    }

    loadMessages()

    const channel = supabase
      .channel(`messages-${chatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          setMessages((current) => [...current, payload.new])
        }
      )
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.error('removeMessagesChannel', error)
      }
    }
  }, [chatId, currentUser, toast])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!chatId || !currentUser || !text.trim()) return

    setSending(true)
    try {
      const payload = {
        chat_id: chatId,
        from_user: currentUser.id,
        text: text.trim(),
      }

      const { error } = await supabase.from('messages').insert([payload])
      if (error) throw error

      await supabase
        .from('chats')
        .update({ last_updated: new Date().toISOString() })
        .eq('id', chatId)

      setText('')
    } catch (error) {
      console.error('sendMessage', error)
      toast.push(error.message || 'Gagal mengirim pesan', { type: 'error' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-auto rounded-2xl border border-slate-100 bg-slate-50 p-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Belum ada pesan. Mulai percakapan dari sini.
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.from_user === currentUser.id
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    mine
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  }`}
                >
                  <div>{message.text}</div>
                  <div className={`mt-1 text-right text-xs ${mine ? 'text-slate-300' : 'text-slate-400'}`}>
                    {message.created_at ? new Date(message.created_at).toLocaleString('id-ID') : '-'}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              sendMessage()
            }
          }}
          className="flex-1 rounded-2xl border border-slate-200 px-4 py-3"
          placeholder="Ketik pesan..."
        />
        <button
          onClick={sendMessage}
          disabled={sending || !text.trim()}
          className="rounded-2xl bg-slate-900 px-4 py-3 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {sending ? 'Mengirim...' : 'Kirim'}
        </button>
      </div>
    </div>
  )
}

export default function ChatWorkspace({ initialVendorId = null, embedded = false }) {
  const { user } = useAuth()
  const toast = useToast()
  const [chats, setChats] = useState([])
  const [vendorMap, setVendorMap] = useState({})
  const [selectedChatId, setSelectedChatId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [creatingChat, setCreatingChat] = useState(false)
  const [showInboxMobile, setShowInboxMobile] = useState(true)

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) || null,
    [chats, selectedChatId]
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
      const { data, error } = await supabase
        .from('vendors')
        .select('id, name, photo_url')
        .in('id', partnerIds)

      if (error) throw error

      const nextMap = (data || []).reduce((accumulator, vendor) => {
        accumulator[vendor.id] = vendor
        return accumulator
      }, {})

      setVendorMap(nextMap)
    } catch (error) {
      console.error('hydratePartners', error)
      setVendorMap({})
    }
  }

  async function fetchChats(preferredChatId = null) {
    if (!user) return

    setLoading(true)
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
      toast.push(error.message || 'Gagal memuat daftar chat', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user) return undefined

    fetchChats()

    const channel = supabase
      .channel(`chats-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, () => {
        fetchChats()
      })
      .subscribe()

    return () => {
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
        const { data, error } = await supabase
          .from('chats')
          .select('*')
          .contains('participants', [user.id, initialVendorId])
          .order('last_updated', { ascending: false })
          .limit(1)

        if (error) throw error

        const existingChat = data?.[0]
        if (existingChat) {
          if (active) {
            setSelectedChatId(existingChat.id)
            fetchChats(existingChat.id)
          }
          return
        }

        const payload = {
          participants: [user.id, initialVendorId],
          last_updated: new Date().toISOString(),
        }

        const { data: createdChat, error: createError } = await supabase
          .from('chats')
          .insert([payload])
          .select()
          .single()

        if (createError) throw createError

        if (active) {
          setSelectedChatId(createdChat.id)
          fetchChats(createdChat.id)
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

  return (
    <div className={`grid gap-4 ${embedded ? 'grid-cols-1 xl:grid-cols-[320px_1fr]' : 'grid-cols-1 lg:grid-cols-[320px_1fr]'}`}>
      <div className={`rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 ${selectedChat && !showInboxMobile ? 'hidden lg:block' : ''}`}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-900">Daftar Chat</div>
            <div className="text-sm text-slate-500">Pilih percakapan untuk mulai ngobrol.</div>
          </div>
          <button
            onClick={() => fetchChats(selectedChatId)}
            className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Refresh
          </button>
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
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
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

      <div className={`rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 ${selectedChat && !showInboxMobile ? 'block' : 'hidden lg:block'}`}>
        {selectedChat ? (
          <>
            <div className="mb-3 border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-500">Sedang chat dengan</div>
                  <div className="font-semibold text-slate-900">
                    {getPartnerLabel(selectedChat, user?.id, vendorMap)}
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
            <div className={embedded ? 'h-[62vh] sm:h-[60vh]' : 'h-[72vh] sm:h-[70vh]'}>
              <ChatThread chatId={selectedChat.id} currentUser={user} />
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
