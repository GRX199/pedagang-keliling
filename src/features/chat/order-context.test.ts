import { describe, expect, it } from 'vitest'
import {
  pickFeaturedOrder,
  shouldShowPaymentProofShortcut,
} from './order-context'

describe('chat order context', () => {
  it.each(['completed', 'cancelled', 'rejected'])(
    'does not retain a terminal %s order even when its URL is preferred',
    (status) => {
      expect(pickFeaturedOrder([{ id: 'old', status }], 'old')).toBeNull()
      expect(
        pickFeaturedOrder(
          [
            { id: 'old', status },
            { id: 'active', status: 'accepted' },
          ],
          'old',
        )?.id,
      ).toBe('active')
    },
  )
  it('selects the requested active order without changing its row', () => {
    const requested = { id: 'second', status: 'ready', buyer_id: 'buyer' }
    expect(
      pickFeaturedOrder(
        [{ id: 'first', status: 'pending' }, requested],
        'second',
      ),
    ).toBe(requested)
  })
  it('offers a payment-proof shortcut only when the buyer can confirm payment', () => {
    const order = {
      buyer_id: 'buyer',
      service_flow: 'pickup_v1',
      status: 'pending',
      payment_method: 'qris',
      payment_status: 'unpaid',
    }
    expect(shouldShowPaymentProofShortcut(order, { id: 'buyer' })).toBe(false)
    expect(
      shouldShowPaymentProofShortcut(
        { ...order, status: 'accepted' },
        { id: 'buyer' },
      ),
    ).toBe(true)
    expect(
      shouldShowPaymentProofShortcut(
        { ...order, status: 'ready', payment_status: 'paid' },
        { id: 'buyer' },
      ),
    ).toBe(false)
    expect(
      shouldShowPaymentProofShortcut(
        { ...order, status: 'ready' },
        { id: 'other' },
      ),
    ).toBe(false)
  })
})
