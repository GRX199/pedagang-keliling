import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  insert: vi.fn(),
}))
vi.mock('../../shared/lib/supabase', () => ({ supabase: { from: mock.from } }))
import { updateAdminVendor } from './admin-api'

beforeEach(() => {
  vi.clearAllMocks()
  const query = {
    update: mock.update,
    eq: mock.eq,
    select: mock.select,
    single: mock.single,
  }
  mock.from.mockImplementation((table) =>
    table === 'admin_actions' ? { insert: mock.insert } : query,
  )
  mock.update.mockReturnValue(query)
  mock.eq.mockReturnValue(query)
  mock.select.mockReturnValue(query)
  mock.single.mockResolvedValue({ data: { id: 'vendor' }, error: null })
  mock.insert.mockResolvedValue({ data: null, error: null })
})
describe('admin moderation API', () => {
  it('compares the current verification before writing and records the actor', async () => {
    await expect(
      updateAdminVendor('admin', {
        kind: 'verification',
        id: 'vendor',
        expected: false,
        value: true,
      }),
    ).resolves.toEqual({ auditRecorded: true })
    expect(mock.eq.mock.calls).toEqual([
      ['id', 'vendor'],
      ['is_verified', false],
    ])
    expect(mock.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_id: 'admin',
        target_user_id: 'vendor',
        action_type: 'verify_vendor',
      }),
    )
  })
  it('does not report success or add an audit entry after a stale write', async () => {
    mock.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
    await expect(
      updateAdminVendor('admin', {
        kind: 'account',
        id: 'vendor',
        expected: 'active',
        value: 'blocked',
      }),
    ).rejects.toThrow('sudah berubah')
    expect(mock.insert).not.toHaveBeenCalled()
  })
  it('reports a partial audit failure without claiming the moderation itself failed', async () => {
    mock.insert.mockResolvedValue({ error: { code: '42501' } })
    await expect(
      updateAdminVendor('admin', {
        kind: 'account',
        id: 'vendor',
        expected: 'active',
        value: 'suspended',
      }),
    ).resolves.toEqual({ auditRecorded: false })
    expect(mock.from.mock.calls.map(([table]) => table)).toEqual([
      'profiles',
      'admin_actions',
    ])
    expect(mock.update).toHaveBeenCalledWith({ account_status: 'suspended' })
  })
  it('does not write without an actor identity', async () => {
    await expect(
      updateAdminVendor('', {
        kind: 'verification',
        id: 'vendor',
        expected: false,
        value: true,
      }),
    ).rejects.toThrow('tidak tersedia')
    expect(mock.from).not.toHaveBeenCalled()
  })
})
