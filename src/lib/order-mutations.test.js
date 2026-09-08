import { describe, expect, it, vi } from 'vitest'
import { saveOrderChange } from './order-mutations'

const order = { id: 'order-1', vendor_id: 'vendor-1', buyer_id: 'buyer-1', status: 'arrived', payment_status: 'paid', payment_method: 'cod' }

describe('order writes', () => {
  it('completes through one atomic RPC without browser stock writes', async () => {
    const completed = { ...order, status: 'completed' }
    const client = { rpc: vi.fn().mockResolvedValue({ data: completed, error: null }), from: vi.fn() }
    await expect(saveOrderChange(client, order, 'status', 'completed', 'vendor-1')).resolves.toEqual(completed)
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('complete_order_and_decrement_stock', { target_order_id: order.id })
    expect(client.from).not.toHaveBeenCalled()
  })

  it.each(['PGRST202', '42883', '42501'])('never falls back to partial stock writes after RPC error %s', async (code) => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: { code, message: 'RPC error' } }), from: vi.fn() }
    await expect(saveOrderChange(client, order, 'status', 'completed', 'vendor-1')).rejects.toBeTruthy()
    expect(client.from).not.toHaveBeenCalled()
  })

  it('rejects unauthorized and out-of-sequence writes before sending a request', async () => {
    const client = { rpc: vi.fn(), from: vi.fn() }
    await expect(saveOrderChange(client, order, 'status', 'completed', 'stranger')).rejects.toThrow('tidak tersedia')
    await expect(saveOrderChange(client, { ...order, status: 'pending' }, 'status', 'completed', 'vendor-1')).rejects.toThrow('tidak tersedia')
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
  })

  it('detects a concurrent status change instead of reporting false success', async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    const client = { from: vi.fn().mockReturnValue(query) }
    const pending = { ...order, status: 'pending', payment_status: 'unpaid' }
    await expect(saveOrderChange(client, pending, 'status', 'accepted', 'vendor-1')).rejects.toThrow('sudah berubah')
    expect(query.eq.mock.calls).toEqual([['id', order.id], ['status', 'pending'], ['payment_status', 'unpaid']])
  })

  it('returns confirmed server state for a successful payment', async () => {
    const updated = { ...order, payment_status: 'paid' }
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: updated, error: null }) }
    const client = { from: vi.fn().mockReturnValue(query) }
    await expect(saveOrderChange(client, { ...order, payment_status: 'unpaid' }, 'payment_status', 'paid', 'vendor-1')).resolves.toEqual(updated)
  })
})
