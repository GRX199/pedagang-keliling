import { describe, expect, it } from 'vitest'
import {
  getBuyerPaymentActions,
  getNextVendorStatusActions,
  getVendorStatusTransitionBlockReason,
  getVendorPaymentActions,
  getPaymentGuidance,
  getOrderPaymentDetails,
  getOrderOperationalNotice,
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
    expect(getBuyerPaymentActions({ status: 'pending', payment_method: 'qris', payment_status: 'unpaid' })).toEqual([
      { value: 'pending_confirmation', label: 'Saya Sudah Bayar', tone: 'primary' },
    ])
  })

  it.each(['completed', 'cancelled', 'rejected'])('removes payment actions and operational prompts for %s orders', (status) => {
    const order = { status, payment_method: 'qris', payment_status: 'pending_confirmation' }
    expect(getVendorPaymentActions(order)).toEqual([])
    expect(getBuyerPaymentActions({ ...order, payment_status: 'failed' })).toEqual([])
    expect(getOrderOperationalNotice(order)).toBe('')
    expect(getPaymentGuidance(order)).not.toContain('kirim ulang')
  })

  it('only confirms unpaid COD at arrival', () => {
    expect(getVendorPaymentActions({ status: 'arrived', payment_method: 'cod', payment_status: 'unpaid' })).toHaveLength(1)
    expect(getVendorPaymentActions({ status: 'completed', payment_method: 'cod', payment_status: 'unpaid' })).toEqual([])
    expect(getVendorPaymentActions({ status: 'arrived', payment_method: 'cod', payment_status: 'refunded' })).toEqual([])
  })

  it('does not ask buyers to pay again during delivery', () => {
    expect(getBuyerPaymentActions({ status: 'on_the_way', payment_method: 'qris', payment_status: 'unpaid' })).toEqual([])
  })

  it('keeps the checkout payment destination when the vendor changes their account', () => {
    const snapshot = { bank_transfer: { account_number: 'old-account' } }
    const vendor = { payment_details: { bank_transfer: { account_number: 'new-account' } } }
    expect(getOrderPaymentDetails({ vendor_payment_details_snapshot: snapshot }, vendor)).toBe(snapshot)
    expect(getOrderPaymentDetails({ vendor_payment_details_snapshot: {} }, vendor)).toBe(vendor.payment_details)
  })
})
