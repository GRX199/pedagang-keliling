import { describe, expect, it } from 'vitest'
import {
  formatVendorPresenceAge,
  getVendorPresenceTone,
  isVendorPresenceFresh,
  VENDOR_PRESENCE_MAX_AGE_MS,
} from './vendor'

describe('vendor presence', () => {
  const now = Date.parse('2026-06-29T10:00:00.000Z')

  it('requires an online vendor with coordinates', () => {
    expect(isVendorPresenceFresh({ online: false, location: { lat: -5, lng: 119 } }, now)).toBe(false)
    expect(isVendorPresenceFresh({ online: true, location: null }, now)).toBe(false)
  })

  it('expires stale location updates', () => {
    const freshVendor = {
      online: true,
      location: { lat: -5, lng: 119 },
      last_seen_at: new Date(now - VENDOR_PRESENCE_MAX_AGE_MS + 1000).toISOString(),
    }
    const staleVendor = {
      ...freshVendor,
      last_seen_at: new Date(now - VENDOR_PRESENCE_MAX_AGE_MS - 1000).toISOString(),
    }

    expect(isVendorPresenceFresh(freshVendor, now)).toBe(true)
    expect(isVendorPresenceFresh(staleVendor, now)).toBe(false)
  })

  it('formats presence freshness for mobile map cards', () => {
    const liveVendor = {
      online: true,
      location: { lat: -5, lng: 119 },
      last_seen_at: new Date(now - 20000).toISOString(),
    }
    const agingVendor = {
      ...liveVendor,
      last_seen_at: new Date(now - 90000).toISOString(),
    }

    expect(formatVendorPresenceAge(liveVendor, now)).toBe('Live sekarang')
    expect(getVendorPresenceTone(liveVendor, now)).toBe('fresh')
    expect(formatVendorPresenceAge(agingVendor, now)).toBe('Update 1 menit lalu')
    expect(getVendorPresenceTone(agingVendor, now)).toBe('aging')
  })
})
