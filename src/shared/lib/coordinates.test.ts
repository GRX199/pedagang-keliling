import { describe, expect, it } from 'vitest'
import { createLocationPayload, getVendorCoordinates } from './coordinates'

describe('typed coordinates', () => {
  it.each([
    null,
    '',
    { lat: '1', lng: 124 },
    { lat: NaN, lng: 124 },
    { lat: 91, lng: 0 },
    { lat: 0, lng: 181 },
  ])('rejects invalid coordinates: %j', (location) => {
    expect(getVendorCoordinates(location)).toBeNull()
  })
  it.each([
    { lat: 0, lng: 0 },
    { latitude: 0, longitude: 0 },
    { type: 'Point', coordinates: [0, 0] },
  ])('preserves valid zero coordinates: %j', (location) => {
    expect(getVendorCoordinates(location)).toEqual({ lat: 0, lng: 0 })
  })
  it('builds the existing SQL-compatible JSON shape', () => {
    expect(createLocationPayload({ lat: 1, lng: 124, accuracy: 10.3 })).toEqual({
      lat: 1,
      lng: 124,
      accuracy: 10,
      updated_at: expect.any(String),
    })
    expect(createLocationPayload({ lat: 91, lng: 124 })).toBeNull()
  })
})
