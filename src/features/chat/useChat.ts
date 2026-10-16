import { useEffect, useMemo, useRef, useState } from 'react'
import type { SyncConnection } from '../../shared/hooks/useRealtimeQuerySync'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData
} from '@tanstack/react-query'
import { supabase } from '../../shared/lib/supabase'
import { sendChatMessage } from '../../lib/conversations'
import { mergeMessages } from './messages'
import { isPostgresReplicationReady } from '../../shared/lib/realtime'
import {
  fetchMessagePage,
  type MessagePage,
  type MessageUpdates
} from './chat-pages'
import type { DateCursor } from '../../shared/lib/keyset'
import type { Message } from '../../types/domain.types'

const EMPTY: Message[] = []
type Activity = (chatId: string, message: Message) => void

export function useChat(
  chatId: string,
  viewerId: string,
  onActivity?: Activity
) {
  const client = useQueryClient()
  const callback = useRef(onActivity)
  const [connection, setConnection] = useState<SyncConnection>('connecting')
  useEffect(() => {
    callback.current = onActivity
  }, [onActivity])
  const prefix = ['chat-messages', viewerId, chatId, 'v2']
  const history = useInfiniteQuery<
    MessagePage,
    Error,
    InfiniteData<MessagePage, DateCursor | null>,
    string[],
    DateCursor | null
  >({
    queryKey: [...prefix, 'history'],
    enabled: !!chatId && !!viewerId,
    initialPageParam: null,
    getNextPageParam: (page) => page.next,
    queryFn: ({ pageParam, signal }) =>
      fetchMessagePage(chatId, pageParam, 'before', signal),
    staleTime: Infinity,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false
  })
  const newest = history.data?.pages[0]?.items[0]
  const initialCursor = newest
    ? { created_at: newest.created_at, id: newest.id }
    : null
  const updatesKey = [...prefix, 'updates']
  const updates = useQuery<MessageUpdates>({
    queryKey: updatesKey,
    enabled: !!chatId && !!viewerId && !!history.data,
    refetchInterval: (query) => (query.state.data?.catchingUp ? 1000 : 15_000),
    queryFn: async ({ signal }): Promise<MessageUpdates> => {
      const before = client.getQueryData<MessageUpdates>(updatesKey)
      // HTTP progress is independent of realtime inserts: a new live message must
      // never move this cursor past messages missed while the socket was offline.
      const cursor = before?.through || initialCursor
      const page = await fetchMessagePage(chatId, cursor, 'after', signal)
      const latest = client.getQueryData<MessageUpdates>(updatesKey)
      const last = page.items.at(-1)
      const known = new Set(
        [
          ...(latest?.messages || EMPTY),
          ...(history.data?.pages.flatMap((page) => page.items) || EMPTY)
        ].map((message) => message.id)
      )
      for (const message of page.items)
        if (!known.has(message.id)) callback.current?.(chatId, message)
      return {
        messages: mergeMessages(latest?.messages || EMPTY, page.items),
        through: last ? { created_at: last.created_at, id: last.id } : cursor,
        catchingUp: page.next !== null
      }
    }
  })
  useEffect(() => {
    if (!chatId || !viewerId) return
    let active = true
    const key = ['chat-messages', viewerId, chatId, 'v2', 'updates']
    const channel = supabase
      .channel(`chat-messages:${viewerId}:${chatId}`)
      .on('system', {}, (payload: unknown) => {
        if (active && isPostgresReplicationReady(payload)) {
          setConnection('connected')
          void client.invalidateQueries({ queryKey: key })
        } else if (
          active &&
          payload &&
          typeof payload === 'object' &&
          'status' in payload &&
          payload.status === 'error'
        )
          setConnection('polling')
      })
      .on<Message>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`
        },
        (payload) => {
          const message = payload.new
          if (!active || !message.id || message.chat_id !== chatId) return
          const previous = client.getQueryData<MessageUpdates>(key)
          if (previous?.messages.some((row) => row.id === message.id)) return
          client.setQueryData<MessageUpdates>(key, (current) => ({
            messages: mergeMessages(current?.messages || EMPTY, [message]),
            through: current?.through || null,
            catchingUp: current?.catchingUp || false
          }))
          callback.current?.(chatId, message)
        }
      )
      .subscribe((status) => {
        if (!active) return
        if (status === 'SUBSCRIBED') {
          setConnection('connected')
          void client.invalidateQueries({ queryKey: key })
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status))
          setConnection('polling')
      })
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [chatId, viewerId, client])
  const send = useMutation({
    mutationKey: ['chat-send', viewerId, chatId],
    mutationFn: async (text: string): Promise<Message> => {
      if (!viewerId || !chatId) throw new Error('Silakan masuk kembali.')
      const message = await sendChatMessage(chatId, viewerId, text)
      if (!message) throw new Error('Pesan belum terkirim. Coba lagi.')
      return message
    },
    onSuccess: (message) => {
      client.setQueryData<MessageUpdates>(updatesKey, (current) => ({
        messages: mergeMessages(current?.messages || EMPTY, [message]),
        through: current?.through || null,
        catchingUp: current?.catchingUp || false
      }))
      callback.current?.(chatId, message)
      void client.invalidateQueries({ queryKey: ['chats', viewerId] })
    }
  })
  const messages = useMemo(
    () =>
      mergeMessages(
        history.data?.pages.flatMap((page) => page.items) || EMPTY,
        updates.data?.messages || EMPTY
      ),
    [history.data, updates.data]
  )
  return {
    messages,
    send: send.mutateAsync,
    connection,
    dataUpdatedAt: Math.max(history.dataUpdatedAt, updates.dataUpdatedAt),
    isPending: history.isPending,
    paused: history.fetchStatus === 'paused',
    catchingUp: updates.data?.catchingUp || false,
    isSuccess: !!history.data && !updates.isError && !updates.data?.catchingUp,
    error: updates.error || (!history.data ? history.error : null),
    olderError: history.data && history.isError ? history.error : null,
    hasOlder: history.hasNextPage,
    loadingOlder: history.isFetchingNextPage,
    fetching: history.isFetching || updates.isFetching,
    loadOlder: history.fetchNextPage,
    refetch: () => (!history.data ? history.refetch() : updates.refetch())
  }
}
