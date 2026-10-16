import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../../shared/lib/supabase'
import type { Role } from '../../types/domain.types'
import type { useToast } from '../../shared/components/ToastProvider'
import { useNearbyAlerts } from './useNearbyAlerts'
import { isPostgresReplicationReady } from '../../shared/lib/realtime'
import {
  isNotificationVisible,
  mergeNotificationRows,
  notificationBucket,
  notificationCounts,
  reconcileNotificationSnapshot,
  type Notification,
  type NotificationRoute,
} from './notification-model'

type Props = {
  user: User | null
  role: Role | null
  pathname: string
  search: string
  toast: ReturnType<typeof useToast>
}
const EMPTY: Notification[] = []

export function useRealtimeNotifications({
  user,
  role,
  pathname,
  search,
  toast,
}: Props) {
  const userId = user?.id || ''
  useEffect(() => { toast.clear() }, [toast.clear, userId])
  const client = useQueryClient()
  const visibleChat = useQuery<string | null>({
    queryKey: ['visible-chat', userId],
    queryFn: async () => null,
    enabled: false,
    staleTime: Infinity,
  })
  const activeChatId = visibleChat.data || null
  const route: NotificationRoute = { pathname, search, role, activeChatId }
  const routeRef = useRef(route)
  routeRef.current = route
  const pushRef = useRef(toast.push)
  pushRef.current = toast.push
  const session = useRef({
    userId,
    seen: new Set<string>(),
    startedAt: Date.now(),
    primed: false,
    loaded: false,
  })
  if (session.current.userId !== userId)
    session.current = {
      userId,
      seen: new Set(),
      startedAt: Date.now(),
      primed: false,
      loaded: false,
    }
  const key = ['notifications', userId]
  const query = useQuery({
    queryKey: key,
    enabled: !!userId && !!role,
    refetchInterval: 30_000,
    queryFn: async ({ signal }): Promise<Notification[]> => {
      const state = session.current
      const before = client.getQueryData<Notification[]>(key) || EMPTY
      const rows: Notification[] = []
      let cursor = ''
      // UUID keyset pagination avoids timestamp ties and offset shifts between pages.
      while (!signal.aborted) {
        let request = supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .eq('is_read', false)
          .order('id', { ascending: true })
          .limit(100)
        if (cursor) request = request.gt('id', cursor)
        const result = await request.abortSignal(signal)
        if (result.error) throw result.error
        rows.push(...result.data)
        if (result.data.length < 100) break
        cursor = result.data[result.data.length - 1].id
      }
      signal.throwIfAborted()
      if (session.current === state) state.loaded = true
      return reconcileNotificationSnapshot(
        rows,
        before,
        client.getQueryData<Notification[]>(key) || EMPTY,
      )
    },
  })

  useEffect(() => {
    if (!userId || !role) return
    let active = true
    const queryKey = ['notifications', userId]
    const deliver = (row: Notification) => {
      if (
        !active ||
        row.user_id !== userId ||
        session.current.userId !== userId
      )
        return
      if (!row.is_read && !session.current.seen.has(row.id)) {
        session.current.seen.add(row.id)
        if (!isNotificationVisible(row, routeRef.current))
          pushRef.current(row.body || row.title, {
            type: notificationBucket(row) === 'messages' ? 'info' : 'success',
          })
      }
      client.setQueryData<Notification[]>(queryKey, (current = EMPTY) =>
        mergeNotificationRows(current, [row]),
      )
    }
    const channel = supabase
      .channel(`notification-inbox:${userId}`)
      .on('system', {}, (payload: unknown) => {
        if (active && isPostgresReplicationReady(payload))
          void client.invalidateQueries({ queryKey })
      })
      .on<Notification>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (event) => deliver(event.new),
      )
      .on<Notification>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (event) => deliver(event.new),
      )
      .subscribe((status) => {
        // Catch the window between the initial HTTP read and the live subscription.
        if (active && status === 'SUBSCRIBED')
          void client.invalidateQueries({ queryKey })
      })
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [client, role, userId])

  useEffect(() => {
    if (!userId || session.current.userId !== userId || !query.isSuccess) return
    const state = session.current
    let shown = 0
    for (const row of query.data) {
      if (state.seen.has(row.id)) continue
      state.seen.add(row.id)
      if (
        !row.is_read &&
        (state.primed || Date.parse(row.created_at) >= state.startedAt) &&
        !isNotificationVisible(row, route) &&
        shown < 3
      ) {
        shown++
        toast.push(row.body || row.title, {
          type: notificationBucket(row) === 'messages' ? 'info' : 'success',
        })
      }
    }
    state.primed = state.loaded
  }, [
    pathname,
    search,
    role,
    activeChatId,
    query.data,
    query.isSuccess,
    toast,
    userId,
  ])

  const failedRead = useRef({ signature: '', at: 0 })
  const read = useMutation({
    mutationFn: async ({ ids, owner }: { ids: string[]; owner: string }) => {
      // Chunks keep the request URL below proxy limits for older unread inboxes.
      for (let offset = 0; offset < ids.length; offset += 100) {
        const result = await supabase
          .from('notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('user_id', owner)
          .in('id', ids.slice(offset, offset + 100))
        if (result.error) throw result.error
      }
    },
    onMutate: async ({ ids, owner }) => {
      const readKey = ['notifications', owner]
      await client.cancelQueries({ queryKey: readKey })
      const previous = client.getQueryData<Notification[]>(readKey) || EMPTY
      if (session.current.userId !== owner) return { previous }
      const targets = new Set(ids)
      const now = new Date().toISOString()
      client.setQueryData<Notification[]>(
        readKey,
        previous.map((row) =>
          targets.has(row.id)
            ? { ...row, is_read: true, read_at: now, updated_at: now }
            : row,
        ),
      )
      return { previous }
    },
    onError: (_error, { ids, owner }, context) => {
      if (session.current.userId !== owner) return
      failedRead.current = { signature: ids.join(','), at: Date.now() }
      const previous = new Map(context?.previous.map((row) => [row.id, row]))
      const targets = new Set(ids)
      const readKey = ['notifications', owner]
      client.setQueryData<Notification[]>(readKey, (rows = EMPTY) =>
        rows.map((row) =>
          targets.has(row.id) ? previous.get(row.id) || row : row,
        ),
      )
      void client.invalidateQueries({ queryKey: readKey })
    },
  })
  const rows = query.data || EMPTY
  useEffect(() => {
    if (!userId || read.isPending || document.visibilityState === 'hidden')
      return
    const ids = rows
      .filter((row) => !row.is_read && isNotificationVisible(row, route))
      .map((row) => row.id)
    if (!ids.length) return
    if (
      failedRead.current.signature === ids.join(',') &&
      Date.now() - failedRead.current.at < 30_000
    )
      return
    read.mutate({ ids, owner: userId })
  }, [
    userId,
    pathname,
    search,
    role,
    activeChatId,
    rows,
    query.dataUpdatedAt,
    read.isPending,
  ])

  useNearbyAlerts({ userId, role, pathname, push: toast.push })
  return notificationCounts(rows, route)
}
