import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthenticator } from '../../server/authentication.js'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})
const response = () => ({
  locals: { requestId: '11111111-1111-4111-8111-111111111111' },
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code
    return this
  },
  json(body) {
    this.body = body
    return this
  },
  setHeader: vi.fn()
})
const request = { headers: { authorization: 'Bearer qa-token-not-real' } }

describe('backend auth failure classification', () => {
  it.each([
    undefined,
    '',
    'Basic token',
    'Bearer token extra',
    ['Bearer token']
  ])(
    'rejects malformed authorization without contacting Auth (%j)',
    async (authorization) => {
      const getUser = vi.fn()
      const res = response()
      expect(
        await createAuthenticator({ auth: { getUser } })(
          { headers: { authorization } },
          res
        )
      ).toBeNull()
      expect(res.statusCode).toBe(401)
      expect(getUser).not.toHaveBeenCalled()
    }
  )
  it('accepts only the verified user returned by Auth', async () => {
    const user = { id: 'qa-owned-user' }
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null })
    const res = response()
    expect(await createAuthenticator({ auth: { getUser } })(request, res)).toBe(
      user
    )
    expect(getUser).toHaveBeenCalledWith('qa-token-not-real')
    expect(res.body).toBeNull()
  })
  it.each([400, 401, 403])(
    'keeps invalid/restricted credentials distinct from outages (%s)',
    async (status) => {
      const getUser = vi
        .fn()
        .mockResolvedValue({ data: { user: null }, error: { status } })
      const res = response()
      await createAuthenticator({ auth: { getUser } })(request, res)
      expect(res.statusCode).toBe(status === 403 ? 403 : 401)
      expect(res.body.code).toBe(
        status === 403 ? 'account_restricted' : 'invalid_token'
      )
      expect(res.setHeader).not.toHaveBeenCalled()
    }
  )
  it.each([
    { status: 500 },
    { status: 503 },
    { status: 429 },
    { name: 'AuthRetryableFetchError', status: 0 },
    { name: 'AuthUnknownError' }
  ])(
    'returns 503 without forcing token refresh for transient Auth failure (%j)',
    async (error) => {
      const getUser = vi
        .fn()
        .mockResolvedValue({
          data: null,
          error: { ...error, message: 'private token and user data' }
        })
      const res = response()
      expect(
        await createAuthenticator({ auth: { getUser } })(request, res)
      ).toBeNull()
      expect(res.statusCode).toBe(503)
      expect(res.body.code).toBe('auth_unavailable')
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '15')
      expect(getUser).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(res.body)).not.toContain('private')
      expect(JSON.stringify(console.warn.mock.calls)).not.toContain('private')
    }
  )
  it('handles thrown transport errors with the same safe unavailable response', async () => {
    const getUser = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch private-token'))
    const res = response()
    await createAuthenticator({ auth: { getUser } })(request, res)
    expect(res.statusCode).toBe(503)
    expect(JSON.stringify(res.body)).not.toContain('private-token')
  })
  it('does not blame the session when the backend API key is rejected', async () => {
    const getUser = vi
      .fn()
      .mockResolvedValue({
        data: null,
        error: { status: 401, message: 'Invalid API key' }
      })
    const res = response()
    await createAuthenticator({ auth: { getUser } })(request, res)
    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe('auth_unavailable')
  })
  it('treats a deleted user or missing session as invalid rather than an outage', async () => {
    const getUser = vi
      .fn()
      .mockResolvedValue({
        data: null,
        error: { status: 404, code: 'user_not_found' }
      })
    const res = response()
    await createAuthenticator({ auth: { getUser } })(request, res)
    expect(res.statusCode).toBe(401)
  })
})
