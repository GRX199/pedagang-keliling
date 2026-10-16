import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDrivingRoute } from './routing'
const endpoints = { from: { lat: 1, lng: 124 }, to: { lat: 1.1, lng: 124.1 } }
afterEach(() => vi.unstubAllGlobals())
describe('driving route boundary', () => {
  it('converts OSRM longitude/latitude to Leaflet latitude/longitude', async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        code: 'Ok',
        routes: [
          {
            distance: 1500,
            duration: 120,
            geometry: {
              coordinates: [
                [124, 1],
                [124.1, 1.1],
              ],
            },
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', request)
    const result = await fetchDrivingRoute(endpoints)
    expect(result.latLngs).toEqual([
      [1, 124],
      [1.1, 124.1],
    ])
    expect(result.distanceMeters).toBe(1500)
    expect(request.mock.calls[0][0]).toContain(
      '/route/v1/driving/124,1;124.1,1.1',
    )
  })
  it.each([
    null,
    {},
    { code: 'NoRoute' },
    {
      code: 'Ok',
      routes: [
        {
          geometry: {
            coordinates: [
              [181, 91],
              ['bad', 1],
            ],
          },
        },
      ],
    },
  ])('rejects incomplete or invalid route responses', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    await expect(fetchDrivingRoute(endpoints)).rejects.toThrow()
  })
  it('rejects invalid coordinates without calling an external service', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    await expect(
      fetchDrivingRoute({ ...endpoints, from: { lat: NaN, lng: 124 } }),
    ).rejects.toThrow('tidak lengkap')
    expect(request).not.toHaveBeenCalled()
  })
  it('passes cancellation to fetch and never treats an abort as route success', async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    vi.stubGlobal('fetch', request)
    const signal = AbortSignal.abort()
    await expect(
      fetchDrivingRoute({ ...endpoints, signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(request.mock.calls[0][1].signal).toBe(signal)
  })
})
