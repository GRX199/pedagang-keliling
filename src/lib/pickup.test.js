import { describe, expect, it, vi } from 'vitest'
import { isPickupOrder, validatePickupRequest } from './pickup'
import { getBuyerPaymentActions, getNextVendorStatusActions, getOrderStatusSteps, getVendorPaymentActions, isActiveOrderStatus } from './orders'
import { saveOrderChange } from './order-mutations'
import { getVendorCoordinates, isVendorPresenceFresh } from './vendor'

const order = { id: 'o', vendor_id: 'v', buyer_id: 'b', service_flow: 'pickup_v1', status: 'pending', payment_method: 'cod', payment_status: 'unpaid' }

describe('pickup flow', () => {
  it('does not silently reinterpret old orders', () => {
    expect(isPickupOrder({ fulfillment_type: 'delivery' })).toBe(false)
    expect(getNextVendorStatusActions({ ...order, service_flow: 'legacy', status: 'accepted' })[0].value).toBe('preparing')
  })
  it('offers only the next pickup step and no blind completion', () => {
    expect(getNextVendorStatusActions(order).map(a => a.value)).toEqual(['accepted', 'rejected'])
    expect(getNextVendorStatusActions({ ...order, status: 'accepted' }).map(a => a.value)).toEqual(['ready'])
    for (const status of ['ready', 'completed', 'cancelled', 'rejected']) expect(getNextVendorStatusActions({ ...order, status })).toEqual([])
    expect(isActiveOrderStatus('ready')).toBe(true)
    expect(getOrderStatusSteps('ready', 'pickup_v1').map(s => s.key)).toEqual(['pending', 'accepted', 'ready', 'completed'])
  })
  it('requires consent for external courier and a real proposed point', () => {
    const request = { method: 'customer_courier', point: 'Gerbang pasar', collector: 'Ani', courierConsent: true }
    expect(validatePickupRequest(request)).toBe('')
    for (const invalid of [{ point: ' ' }, { collector: '' }, { method: 'delivery' }, { courierConsent: false }]) expect(validatePickupRequest({ ...request, ...invalid })).not.toBe('')
    expect(validatePickupRequest({ ...request, method: 'self_pickup', courierConsent: false })).toBe('')
  })
  it('does not invite payment before approval or after final status', () => {
    for (const status of ['pending', 'completed', 'cancelled', 'rejected']) {
      expect(getBuyerPaymentActions({ ...order, status, payment_method: 'qris' })).toEqual([])
      expect(getVendorPaymentActions({ ...order, status, payment_method: 'qris', payment_status: 'pending_confirmation' })).toEqual([])
    }
    expect(getBuyerPaymentActions({ ...order, status: 'ready', payment_method: 'qris' })[0].value).toBe('pending_confirmation')
    expect(getVendorPaymentActions({ ...order, status: 'ready' })).toEqual([])
  })
  it('refuses forbidden client mutations without sending a request', async () => {
    const client = { rpc: vi.fn(), from: vi.fn() }
    await expect(saveOrderChange(client, { ...order, status: 'ready', payment_status: 'paid' }, 'status', 'completed', 'v')).rejects.toThrow()
    await expect(saveOrderChange(client, order, 'status', 'accepted', 'stranger')).rejects.toThrow()
    await expect(saveOrderChange(client, { ...order, status: 'accepted' }, 'status', 'cancelled', 'b')).rejects.toThrow()
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
  })
  it('hides unverified, offline, stale and invalid positions', () => {
    const now = Date.now()
    const vendor = { online: true, is_verified: true, location: { lat: 1.4, lng: 124.8 }, last_seen_at: new Date(now).toISOString() }
    expect(isVendorPresenceFresh(vendor, now)).toBe(true)
    for (const invalid of [{ is_verified: false }, { online: false }, { last_seen_at: new Date(now - 121000).toISOString() }, { last_seen_at: new Date(now + 60000).toISOString() }, { location: { lat: NaN, lng: 124 } }]) expect(isVendorPresenceFresh({ ...vendor, ...invalid }, now)).toBe(false)
    expect(getVendorCoordinates({ lat: 91, lng: 124 })).toBeNull()
    expect(getVendorCoordinates({ lat: 1, lng: Infinity })).toBeNull()
  })

  it('approval compares the point shown to the vendor before writing', async () => {
    const pending = { ...order, meeting_point_label: 'Gerbang pasar', updated_at: '2026-09-16T00:00:00Z' }
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    await expect(saveOrderChange({ from: () => query }, pending, 'status', 'accepted', 'v')).rejects.toThrow('sudah berubah')
    expect(query.eq).toHaveBeenCalledWith('meeting_point_label', pending.meeting_point_label)
    expect(query.eq).toHaveBeenCalledWith('updated_at', pending.updated_at)
  })
})
