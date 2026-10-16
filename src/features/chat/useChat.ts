import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../shared/lib/supabase'
import { sendChatMessage } from '../../lib/conversations'
import { mergeMessages } from './messages'
import { isPostgresReplicationReady } from '../../shared/lib/realtime'
import type { Message } from '../../types/domain.types'

const EMPTY: Message[] = []
type Activity = (chatId: string, message: Message) => void

export function useChat(chatId: string, viewerId: string, onActivity?: Activity) {
  const client = useQueryClient()
  const callback = useRef(onActivity)
  useEffect(() => {
    callback.current = onActivity
  }, [onActivity])
  const key = ['chat-messages', viewerId, chatId]
  const query = useQuery({
    queryKey: key,
    enabled: !!chatId && !!viewerId,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => {
      const before = client.getQueryData<Message[]>(key)
      let request = supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })
      const since = before?.at(-1)?.created_at
      if (since) request = request.gte('created_at', since)
      const { data, error } = await request.abortSignal(signal)
      if (error) throw error
      // A realtime insert or send may finish while the HTTP read is still in flight.
      const latest = client.getQueryData<Message[]>(key) || EMPTY
      if (before) {
        const known = new Set(latest.map((message) => message.id))
        for (const message of data || EMPTY)
          if (!known.has(message.id)) callback.current?.(chatId, message)
      }
      return mergeMessages(latest, data || EMPTY)
    },
  })
  useEffect(() => {
    if (!chatId || !viewerId) return undefined
    let active = true
    const queryKey = ['chat-messages', viewerId, chatId]
    const channel = supabase
      .channel(`chat-messages:${viewerId}:${chatId}`)
      .on('system', {}, (payload: unknown) => {
        if (active && isPostgresReplicationReady(payload)) void client.invalidateQueries({ queryKey })
      })
      .on<Message>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const message = payload.new
          if (!active || !message.id || message.chat_id !== chatId) return
          const previous = client.getQueryData<Message[]>(queryKey) || EMPTY
          if (previous.some((row) => row.id === message.id)) return
          client.setQueryData(queryKey, mergeMessages(previous, [message]))
          callback.current?.(chatId, message)
        }
      )
      .subscribe()
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [chatId, viewerId, client])
  const send = useMutation({
    mutationFn: async (text: string): Promise<Message> => {
      if (!viewerId || !chatId) throw new Error('Silakan masuk kembali.')
      const message = await sendChatMessage(chatId, viewerId, text)
      if (!message) throw new Error('Pesan belum terkirim. Coba lagi.')
      return message
    },
    onSuccess: (message) => {
      client.setQueryData<Message[]>(key, (current) => mergeMessages(current || EMPTY, [message]))
      callback.current?.(chatId, message)
      void client.invalidateQueries({ queryKey: ['chats', viewerId] })
    },
  })
  return { ...query, messages: query.data || EMPTY, send: send.mutateAsync }
}
