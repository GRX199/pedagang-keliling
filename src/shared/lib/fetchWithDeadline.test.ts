import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithDeadline } from './fetchWithDeadline'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('bounded network requests', () => {
  it('propagates cancellation and releases the deadline after success', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetcher = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetcher)
    await fetchWithDeadline('https://example.test', { signal: controller.signal })
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false)
  })
  it('fails a hung request without retrying it', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_input, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const result = fetchWithDeadline('https://example.test', { method: 'POST' }, 100)
    const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts immediately when a query is cancelled before the request starts', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))
    vi.stubGlobal('fetch', vi.fn((_input, init: RequestInit) => Promise.reject(init.signal!.reason)))
    await expect(fetchWithDeadline('https://example.test', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
