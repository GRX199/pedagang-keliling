import { describe, expect, it } from 'vitest'
import {
  getBuyerPaymentActions,
  getNextVendorStatusActions,
  getVendorStatusTransitionBlockReason,
} from './orders'

describe('order workflow', () => {
  it('keeps vendor status transitions sequential', () => {
    expect(getNextVendorStatusActions('pending').map((action) => action.value)).toEqual(['accepted', 'rejected'])
    expect(getNextVendorStatusActions('accepted').map((action) => action.value)).toEqual(['preparing'])
    expect(getNextVendorStatusActions('preparing').map((action) => action.value)).toEqual(['on_the_way'])
  })

  it('blocks delivery before non-cash payment is confirmed', () => {
    const reason = getVendorStatusTransitionBlockReason({
      payment_method: 'qris',
      payment_status: 'pending_confirmation',
    }, 'on_the_way')

    expect(reason).toContain('Konfirmasi pembayaran')
  })

  it('only lets buyers confirm supported non-cash payments', () => {
    expect(getBuyerPaymentActions({ payment_method: 'cod', payment_status: 'unpaid' })).toEqual([])
    expect(getBuyerPaymentActions({ payment_method: 'qris', payment_status: 'unpaid' })).toEqual([
      { value: 'pending_confirmation', label: 'Saya Sudah Bayar', tone: 'primary' },
    ])
  })
})
