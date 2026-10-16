export function getBrowserPosition(options: PositionOptions, signal?: AbortSignal) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Location request cancelled', 'AbortError'))
      return
    }
    if (!navigator.geolocation) {
      reject(new Error('Browser ini tidak mendukung akses lokasi'))
      return
    }
    const cancel = () => reject(new DOMException('Location request cancelled', 'AbortError'))
    signal?.addEventListener('abort', cancel, { once: true })
    navigator.geolocation.getCurrentPosition(
      (position) => {
        signal?.removeEventListener('abort', cancel)
        if (!signal?.aborted) resolve(position)
      },
      (error) => {
        signal?.removeEventListener('abort', cancel)
        if (!signal?.aborted) reject(error)
      },
      options
    )
  })
}

export async function getBrowserPositionWithFallback(signal?: AbortSignal) {
  try {
    return await getBrowserPosition(
      { enableHighAccuracy: true, timeout: 25_000, maximumAge: 30_000 },
      signal
    )
  } catch (error) {
    if (
      signal?.aborted ||
      (error && typeof error === 'object' && 'code' in error && error.code === 1)
    )
      throw error
    return getBrowserPosition(
      { enableHighAccuracy: false, timeout: 18_000, maximumAge: 120_000 },
      signal
    )
  }
}
