import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getBrowserPosition,
  getBrowserPositionWithFallback,
} from './geolocation'

afterEach(() => vi.unstubAllGlobals())
describe('browser location requests', () => {
  it('falls back to a cached relaxed fix after a precise timeout', async () => {
    const position = { coords: { latitude: 1, longitude: 2 } }
    const getCurrentPosition = vi
      .fn()
      .mockImplementationOnce((_success, fail) => fail({ code: 3 }))
      .mockImplementationOnce((success) => success(position))
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    expect(await getBrowserPositionWithFallback()).toBe(position)
    expect(getCurrentPosition.mock.calls[1][2]).toMatchObject({
      enableHighAccuracy: false,
      maximumAge: 120_000,
    })
  })
  it('never retries a denied permission', async () => {
    const getCurrentPosition = vi.fn((_success, fail) => fail({ code: 1 }))
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    await expect(getBrowserPositionWithFallback()).rejects.toMatchObject({
      code: 1,
    })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })
  it('rejects an aborted request and ignores a late browser callback', async () => {
    let late: PositionCallback | undefined
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      late = success
    })
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    const controller = new AbortController()
    const request = getBrowserPosition({}, controller.signal)
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    late?.({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition)
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })
  it('does not start GPS for an already-aborted signal', async () => {
    const getCurrentPosition = vi.fn()
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    await expect(
      getBrowserPosition({}, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })
})
