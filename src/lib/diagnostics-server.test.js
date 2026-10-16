import { describe, expect, it, vi } from 'vitest'
import { clientDiagnostic, recordDiagnostic } from '../../server/diagnostics.js'

describe('backend diagnostic allowlist', () => {
  const valid = { eventId: '11111111-1111-4111-8111-111111111111', area: 'chat', category: 'network', source: 'handled' }
  it('rejects arbitrary labels and strips all private payload fields', () => {
    expect(clientDiagnostic({ ...valid, area: 'user@example.test' })).toBeNull()
    expect(clientDiagnostic({ ...valid, eventId: 'arbitrary log injection\n' })).toBeNull()
    expect(clientDiagnostic({ ...valid, password: 'private', message: 'private', location: { lat: 1, lng: 124 } })).toEqual(valid)
  })
  it('never logs raw exception messages, tokens, coordinates or request paths', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      recordDiagnostic('upload.failed', { requestId: valid.eventId, status: 500, durationMs: 24.5,
        code: 'private-secret', message: 'password private', client: { ...valid, token: 'private-token' },
      })
      const output = log.mock.calls[0][0]
      expect(output).not.toMatch(/private|password|token|location/)
      expect(JSON.parse(output)).toMatchObject({ event: 'upload.failed', status: 500, durationMs: 25, client: valid })
    } finally { log.mockRestore() }
  })
})
