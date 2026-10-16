import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from './queryClient'

describe('query defaults', () => {
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
