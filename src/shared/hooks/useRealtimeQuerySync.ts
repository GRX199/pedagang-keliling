import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isPostgresReplicationReady } from '../lib/realtime'

export function useRealtimeQuerySync(
  key: readonly string[],
  tables: readonly { table: string; filter?: string }[]
) {
  const client = useQueryClient()
  const keySignature = JSON.stringify(key)
  const tableSignature = JSON.stringify(tables)
  useEffect(() => {
    const queryKey: string[] = JSON.parse(keySignature)
    if (queryKey.some((part) => !part)) return undefined
    const specs: { table: string; filter?: string }[] = JSON.parse(tableSignature)
    const channel = supabase.channel(`query:${queryKey.join(':')}`)
    channel.on('system', {}, (payload: unknown) => {
      if (isPostgresReplicationReady(payload)) void client.invalidateQueries({ queryKey })
    })
    for (const spec of specs)
      channel.on('postgres_changes', { event: '*', schema: 'public', ...spec }, () => {
        void client.invalidateQueries({ queryKey })
      })
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [client, keySignature, tableSignature])
}
