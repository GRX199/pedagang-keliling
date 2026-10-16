import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
const mock = vi.hoisted(() => ({ from: vi.fn(), response: { data: [] as Record<string, unknown>[], error: null as object | null } }))
vi.mock('../../shared/lib/supabase', () => ({ supabase: { from: mock.from } }))
import { fetchOrderPage, orderListFilter, updateOrderLists, ORDER_PAGE_SIZE, type OrderPages } from './order-list'

describe('order list data boundaries', () => {
  const request = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn(), or: vi.fn(), abortSignal: vi.fn() }
  beforeEach(() => {
    vi.clearAllMocks()
    for (const method of ['select', 'eq', 'in', 'order', 'limit', 'or'] as const) request[method].mockReturnValue(request)
    request.abortSignal.mockImplementation(async () => mock.response)
    mock.from.mockReturnValue(request)
    mock.response = { data: [], error: null }
  })
  it('bounds requests and joins only the selected orders with participant ownership', async () => {
    await fetchOrderPage('vendor-a', 'vendor', { scope: 'active' }, null, new AbortController().signal)
    expect(request.eq).toHaveBeenCalledWith('vendor_id', 'vendor-a')
    expect(request.in.mock.calls[0][1]).not.toContain('completed')
    expect(request.select).toHaveBeenCalledWith('*,order_items(*),reviews(*)')
    expect(request.limit).toHaveBeenCalledWith(ORDER_PAGE_SIZE + 1)
    expect(mock.from).toHaveBeenCalledTimes(1)
  })
  it('applies history search and cursor together before limiting rows', async () => {
    const cursor = { created_at: '2026-01-01T00:00:00+00:00', id: 'a' }
    await fetchOrderPage('buyer-a', 'customer', { scope: 'history', status: 'completed', search: 'tomat' }, cursor, new AbortController().signal)
    expect(request.eq).toHaveBeenCalledWith('buyer_id', 'buyer-a')
    expect(request.eq).toHaveBeenCalledWith('status', 'completed')
    expect(request.or).toHaveBeenCalledWith(orderListFilter(cursor, 'tomat'))
    expect(request.or.mock.calls[0][0]).toContain('items.ilike."%tomat%"')
  })
  it('does not silently drop a failed page or expose a false empty result', async () => {
    mock.response.error = { code: '42501', message: 'denied' }
    await expect(fetchOrderPage('a', 'customer', { scope: 'active' }, null, new AbortController().signal)).rejects.toMatchObject({ code: '42501' })
  })
  it('patches all loaded pages but never another account cache', () => {
    const client = new QueryClient()
    const cached = { pages: [{ items: [{ id: 'order', status: 'completed' }], next: null }], pageParams: [null] } as OrderPages
    const key = ['orders', 'buyer-a', 'list', 'customer', 'v2', 'history']
    const other = ['orders', 'buyer-b', 'list', 'customer', 'v2', 'history']
    client.setQueryData(key, cached)
    client.setQueryData(other, cached)
    updateOrderLists(client, 'buyer-a', rows => rows.map(row => ({ ...row, buyer_name: 'Updated' })))
    expect(client.getQueryData<OrderPages>(key)?.pages[0].items[0].buyer_name).toBe('Updated')
    expect(client.getQueryData<OrderPages>(other)?.pages[0].items[0].buyer_name).toBeUndefined()
  })
})
