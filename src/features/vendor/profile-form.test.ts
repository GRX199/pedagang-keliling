import { describe, expect, it } from 'vitest'
import { buildProfileForm, buildVendorProfilePayload, toLocalDateTime } from './profile-form'

const form = () => ({ ...buildProfileForm(null), name: 'Pak Sayur' })
describe('profile draft and SQL payload', () => {
  it('round-trips a local promo time instead of shifting it to UTC in the input', () => {
    const iso = '2026-10-16T08:35:00.000Z'
    const local = toLocalDateTime(iso)
    expect(new Date(local).toISOString()).toBe(iso)
    expect(buildVendorProfilePayload({ ...form(), promo_expires_at: local }).promo_expires_at).toBe(
      iso
    )
  })
  it.each([null, undefined, '', 'not a date'])(
    'handles missing or invalid existing promo date: %s',
    (value) => {
      expect(toLocalDateTime(value)).toBe('')
    }
  )
  it('maps empty optional values to the actual nullable columns', () => {
    const payload = buildVendorProfilePayload(form())
    expect(payload).toMatchObject({
      description: null,
      service_radius_km: null,
      mobility_type: null,
      promo_expires_at: null,
      operating_hours: null,
      payment_details: {},
    })
    expect(payload).not.toHaveProperty('is_verified')
    expect(payload).not.toHaveProperty('online')
    expect(payload).not.toHaveProperty('user_id')
  })
  it('preserves payment identifiers as strings and uses the existing JSON keys', () => {
    const payload = buildVendorProfilePayload({
      ...form(),
      payment_bank_account_number: ' 001234 ',
      payment_ewallet_number: '081234',
      payment_bank_name: ' BRI ',
    })
    expect(payload.payment_details).toEqual({
      bank_account_number: '001234',
      bank_name: 'BRI',
      ewallet_number: '081234',
    })
  })
  it.each(['-1', 'Infinity', 'NaN', '10000'])(
    'rejects radius outside numeric(6,2): %s',
    (radius) => {
      expect(() => buildVendorProfilePayload({ ...form(), service_radius_km: radius })).toThrow(
        'Radius layanan'
      )
    }
  )
  it('accepts zero radius and all supported mobility values', () => {
    for (const mobility of ['walking', 'pushcart', 'bicycle', 'motor_vehicle'])
      expect(
        buildVendorProfilePayload({ ...form(), service_radius_km: '0', mobility_type: mobility })
      ).toMatchObject({ service_radius_km: 0, mobility_type: mobility })
  })
  it('rejects invalid names, dates, or mobility before any writes', () => {
    expect(() => buildVendorProfilePayload({ ...form(), name: ' ' })).toThrow('Isi nama')
    expect(() => buildVendorProfilePayload({ ...form(), promo_expires_at: 'bad' })).toThrow(
      'Tanggal'
    )
    expect(() => buildVendorProfilePayload({ ...form(), mobility_type: 'airplane' })).toThrow(
      'cara berkeliling'
    )
  })
})
