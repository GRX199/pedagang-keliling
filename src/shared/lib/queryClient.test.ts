import { describe, expect, it, vi } from 'vitest'
import { onlineManager } from '@tanstack/react-query'
import { createQueryClient } from './queryClient'

describe('query defaults', () => {
  it('blocks offline mutations before tokens, uploads or transaction callbacks are touched', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const client = createQueryClient()
    const write = vi.fn().mockResolvedValue('must not run')
    try {
      const mutation = client.getMutationCache().build(client, { mutationFn: write })
      await expect(mutation.execute(undefined)).rejects.toThrow('Tidak ada koneksi')
      expect(write).not.toHaveBeenCalled()
      expect(mutation.state.isPaused).toBe(false)
    } finally { client.clear(); vi.unstubAllGlobals() }
  })
  it('fails offline writes immediately instead of queuing a transaction for reconnect', async () => {
    onlineManager.setOnline(false)
    const client = createQueryClient()
    const write = vi.fn().mockRejectedValue(new Error('Offline'))
    try {
      const mutation = client.getMutationCache().build(client, { mutationFn: write })
      await expect(mutation.execute(undefined)).rejects.toThrow('Offline')
      expect(mutation.state.isPaused).toBe(false)
      onlineManager.setOnline(true)
      await client.resumePausedMutations()
      expect(write).toHaveBeenCalledTimes(1)
    } finally { onlineManager.setOnline(true); client.clear() }
  })
  it('never retries an uncertain mutation', async () => {
    const client = createQueryClient()
    const write = vi.fn().mockRejectedValue(new Error('Connection interrupted after write'))
    const mutation = client.getMutationCache().build(client, { mutationFn: write })
    await expect(mutation.execute(undefined)).rejects.toThrow('Connection interrupted')
    expect(write).toHaveBeenCalledTimes(1)
    client.clear()
  })
  it('retains cached data when a background refresh fails', async () => {
    const client = createQueryClient()
    const key = ['orders', 'buyer-a', 'list', 'customer']
    client.setQueryData(key, [{ id: 'order-a' }])
    await expect(
      client.fetchQuery({
        queryKey: key,
        staleTime: 0,
        retry: false,
        queryFn: async () => {
          throw new Error('Offline')
        },
      })
    ).rejects.toThrow('Offline')
    expect(client.getQueryData(key)).toEqual([{ id: 'order-a' }])
    client.clear()
  })
  it('isolates user keys and allows logout to remove private caches', () => {
    const client = createQueryClient()
    client.setQueryData(['chat-messages', 'buyer-a', 'room'], [{ text: 'private' }])
    expect(client.getQueryData(['chat-messages', 'buyer-b', 'room'])).toBeUndefined()
    client.clear()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
  })
  it('does not retry authorization or RLS failures', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry
    if (typeof retry !== 'function') throw new Error('Expected retry predicate')
    for (const code of ['401', '403', '42501', 'PGRST301'])
      expect(retry(0, Object.assign(new Error('Forbidden'), { code }))).toBe(false)
    expect(retry(0, new Error('Temporary network error'))).toBe(true)
    expect(retry(1, new Error('Temporary network error'))).toBe(false)
  })
})
