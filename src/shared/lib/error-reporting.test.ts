import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: mock.getSession } } }))
import { errorCategory, queryErrorArea, reportError } from './error-reporting'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-17T01:00:00Z'))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
describe('privacy-preserving diagnostics', () => {
  it('classifies failures without using arbitrary user strings as labels', () => {
    expect(errorCategory({ code: '42501' })).toBe('permission')
    expect(errorCategory({ code: 'PGRST301' })).toBe('auth')
    expect(errorCategory(new TypeError('Failed to fetch'))).toBe('network')
    expect(errorCategory(new TypeError('Cannot read properties of undefined'))).toBe('unexpected')
    expect(queryErrorArea(['chat-messages', 'private-user-id', 'private-chat-id'])).toBe('chat')
    expect(queryErrorArea(['sensitive-user-content'])).toBe('application')
  })
  it('sends only closed labels, throttles duplicates, and never persists raw errors', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://api.example.test')
    vi.stubGlobal('window', { location: { hostname: 'example.test', protocol: 'https:', origin: 'https://example.test' } })
    vi.stubGlobal('navigator', { onLine: true })
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetcher)
    mock.getSession.mockResolvedValue({ data: { session: { access_token: 'test-session-token' } } })
    const privateError = Object.assign(new Error('secret@example.test password GPS 1.47,124.84'), { code: '42501' })
    await reportError(privateError, 'orders', 'handled')
    await reportError(privateError, 'orders', 'handled')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(Object.keys(payload).sort()).toEqual(['area', 'category', 'eventId', 'source'])
    expect(payload).toMatchObject({ area: 'orders', category: 'permission', source: 'handled' })
    expect(JSON.stringify(payload)).not.toMatch(/secret|GPS|password|session-token/)
    vi.stubGlobal('navigator', { onLine: false })
    await reportError(privateError, 'chat', 'handled')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
