import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isPostgresReplicationReady } from '../lib/realtime'
export type SyncConnection = 'connecting' | 'connected' | 'polling'

export function useRealtimeQuerySync(
  key: readonly string[],
  tables: readonly { table: string; filter?: string }[],
  enabled = true
) {
  const client = useQueryClient()
  const keySignature = JSON.stringify(key)
  const tableSignature = JSON.stringify(tables)
  const [state, setState] = useState({
    signature: '',
    connection: 'connecting' as SyncConnection
  })
  useEffect(() => {
    const queryKey: string[] = JSON.parse(keySignature)
    if (!enabled || queryKey.some((part) => !part)) return undefined
    const specs: { table: string; filter?: string }[] =
      JSON.parse(tableSignature)
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const connection = (value: SyncConnection) => {
      if (active) setState({ signature: keySignature, connection: value })
    }
    const refresh = () => {
      if (!active || timer) return
      timer = setTimeout(() => {
        timer = undefined
        if (active) void client.invalidateQueries({ queryKey })
      }, 150)
    }
    const channel = supabase.channel(`query:${queryKey.join(':')}`)
    channel.on('system', {}, (payload: unknown) => {
      if (isPostgresReplicationReady(payload)) {
        connection('connected')
        refresh()
      } else if (
        payload &&
        typeof payload === 'object' &&
        'status' in payload &&
        payload.status === 'error'
      )
        connection('polling')
    })
    for (const spec of specs)
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', ...spec },
        () => {
          refresh()
        }
      )
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        connection('connected')
        refresh()
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status))
        connection('polling')
    })
    return () => {
      active = false
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [client, keySignature, tableSignature, enabled])
  return state.signature === keySignature ? state.connection : 'connecting'
}
