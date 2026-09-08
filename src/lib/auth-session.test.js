import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthSessionController } from './auth-session'

const user = { id: 'vendor-1', user_metadata: { full_name: 'Toko' } }
const meta = { role: 'vendor', accountStatus: 'active' }

function setup(resolveMeta = vi.fn().mockResolvedValue(meta)) {
  const onChange = vi.fn()
  const syncProfile = vi.fn().mockResolvedValue(null)
  const controller = createAuthSessionController({ resolveMeta, syncProfile, onChange })
  return { controller, resolveMeta, syncProfile, onChange, latest: () => onChange.mock.lastCall[0] }
}

describe('auth session lifecycle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('defers database queries until outside the auth callback', async () => {
    const { controller, resolveMeta, latest } = setup()
    controller.handleSession('INITIAL_SESSION', { user })
    expect(resolveMeta).not.toHaveBeenCalled()
    expect(latest().loading).toBe(true)
    await vi.runAllTimersAsync()
    expect(latest()).toMatchObject({ user, ...meta, loading: false })
  })

  it('keeps the same user reference and mounted UI on token refresh', async () => {
    const { controller, resolveMeta, onChange, latest } = setup()
    controller.handleSession('SIGNED_IN', { user })
    await vi.runAllTimersAsync()
    onChange.mockClear()
    controller.handleSession('TOKEN_REFRESHED', { user: { ...user } })
    await vi.runAllTimersAsync()
    expect(onChange).not.toHaveBeenCalled()
    expect(resolveMeta).toHaveBeenCalledTimes(1)
    controller.handleSession('SIGNED_IN', { user: { ...user } })
    expect(latest().loading).toBe(false)
    expect(latest().user).toBe(user)
  })

  it('rechecks account restrictions in the background on refocus', async () => {
    const { controller, resolveMeta, syncProfile, latest } = setup()
    controller.handleSession('INITIAL_SESSION', { user })
    await vi.runAllTimersAsync()
    resolveMeta.mockResolvedValue({ ...meta, accountStatus: 'blocked' })
    controller.handleSession('SIGNED_IN', { user: { ...user } })
    expect(latest().loading).toBe(false)
    await vi.runAllTimersAsync()
    expect(latest().accountStatus).toBe('blocked')
    expect(syncProfile).toHaveBeenCalledTimes(1)
  })

  it('does not restore a logged-out user when a slow lookup finishes', async () => {
    let finishLookup
    const { controller, latest } = setup(vi.fn(() => new Promise((resolve) => { finishLookup = resolve })))
    controller.handleSession('SIGNED_IN', { user })
    vi.advanceTimersByTime(0)
    controller.handleSession('SIGNED_OUT', null)
    finishLookup(meta)
    await vi.runAllTimersAsync()
    expect(latest()).toMatchObject({ user: null, role: null, loading: false })
  })

  it('ignores lookups from the previous account', async () => {
    let finishLookup
    const resolveMeta = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishLookup = resolve })).mockResolvedValue({ role: 'customer', accountStatus: 'active' })
    const { controller, latest } = setup(resolveMeta)
    controller.handleSession('SIGNED_IN', { user })
    vi.advanceTimersByTime(0)
    controller.handleSession('SIGNED_IN', { user: { id: 'buyer-1' } })
    await vi.runAllTimersAsync()
    finishLookup(meta)
    await vi.runAllTimersAsync()
    expect(latest()).toMatchObject({ user: { id: 'buyer-1' }, role: 'customer', loading: false })
  })

  it('does not apply a getSession result obtained before logout', async () => {
    const { controller, latest } = setup()
    let finishSession
    const pending = controller.refresh(() => new Promise((resolve) => { finishSession = resolve }))
    controller.handleSession('SIGNED_OUT', null)
    finishSession({ data: { session: { user } } })
    await pending
    await vi.runAllTimersAsync()
    expect(latest().user).toBeNull()
  })

  it('cancels deferred work on unmount', async () => {
    const { controller, resolveMeta } = setup()
    controller.handleSession('INITIAL_SESSION', { user })
    controller.dispose()
    await vi.runAllTimersAsync()
    expect(resolveMeta).not.toHaveBeenCalled()
  })

  it('coalesces duplicate login events without losing profile synchronization', async () => {
    const { controller, resolveMeta, syncProfile } = setup()
    controller.handleSession('SIGNED_IN', { user })
    controller.handleSession('INITIAL_SESSION', { user })
    await vi.runAllTimersAsync()
    expect(resolveMeta).toHaveBeenCalledTimes(1)
    expect(syncProfile).toHaveBeenCalledExactlyOnceWith(user, 'vendor')
  })

  it('preserves verified access on a temporary background connection failure', async () => {
    const { controller, resolveMeta, latest } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    controller.handleSession('INITIAL_SESSION', { user })
    await vi.runAllTimersAsync()
    resolveMeta.mockRejectedValue(new Error('Offline'))
    controller.handleSession('SIGNED_IN', { user })
    await vi.runAllTimersAsync()
    expect(latest()).toMatchObject({ role: 'vendor', loading: false, authError: '' })
  })
})
