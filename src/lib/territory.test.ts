import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildVendorTerritoryInsights } from './territory'
afterEach(() => vi.useRealTimers())
describe('merchant demand layer', () => {
  it('maps only valid points and separates completed, cancelled and active signals', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'))
    const point = { lat: 1.47, lng: 124.84 }
    const rows = ['pending', 'completed', 'cancelled'].map((status) => ({
      status,
      meeting_point_location: point,
      meeting_point_label: 'Pasar',
      total_amount: 1000,
      created_at: '2026-10-15T00:00:00Z',
    }))
    const result = buildVendorTerritoryInsights([
      ...rows,
      { status: 'pending', meeting_point_location: { lat: 200, lng: 124 } },
    ])
    expect(result.mappedOrderCount).toBe(3)
    expect(result.hotspotCount).toBe(1)
    expect(result.leadHotspot).toMatchObject({
      label: 'Pasar',
      activeCount: 1,
      completedCount: 1,
      cancelledCount: 1,
      totalCompletedValue: 1000,
    })
  })
  it('excludes old history but keeps unresolved active orders', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'))
    const old = {
      meeting_point_location: { lat: 1.47, lng: 124.84 },
      created_at: '2020-01-01T00:00:00Z',
    }
    expect(
      buildVendorTerritoryInsights([
        { ...old, status: 'completed' },
        { ...old, status: 'pending' },
      ]).mappedOrderCount,
    ).toBe(1)
  })
})
