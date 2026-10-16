import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}))
vi.mock('../../shared/lib/supabase', () => ({ supabase: { auth } }))
vi.mock('../../lib/network', () => ({
  requireServerOrigin: () => 'https://api.example.test',
  getFriendlyFetchErrorMessage: (_error: unknown, fallback: string) => fallback,
}))
import { setVendorOnline } from './useVendorOperations'

beforeEach(() => {
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'old' } },
    error: null,
  })
  auth.refreshSession.mockReset()
})
afterEach(() => vi.unstubAllGlobals())
describe('vendor online API', () => {
  it('retries an explicit idempotent status once after refreshing a rejected token', async () => {
    auth.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'new' } },
      error: null,
    })
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ online: true }))
    vi.stubGlobal('fetch', request)
    expect(await setVendorOnline('vendor/id', true)).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][0]).toBe(
      'https://api.example.test/api/vendor/vendor%2Fid/online',
    )
    expect(request.mock.calls[1][1]).toMatchObject({
      body: '{"online":true}',
      headers: { Authorization: 'Bearer new' },
    })
  })
  it('does not claim success when the server response lacks a confirmed status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ok: true })),
    )
    await expect(setVendorOnline('vendor', true)).rejects.toThrow(
      'belum terkonfirmasi',
    )
  })
  it('surfaces a server authorization failure without retrying the operation', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: 'Toko belum terverifikasi' }, { status: 403 }),
      )
    vi.stubGlobal('fetch', request)
    await expect(setVendorOnline('vendor', true)).rejects.toThrow(
      'Toko belum terverifikasi',
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })
})
