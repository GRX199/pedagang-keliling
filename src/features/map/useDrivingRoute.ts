import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Coordinates } from '../../types/domain.types'
import { fetchDrivingRoute } from '../../lib/routing'

export function useDrivingRoute(
  from: Coordinates | null,
  to: Coordinates | null,
) {
  const fromKey = from ? `${from.lat.toFixed(4)},${from.lng.toFixed(4)}` : ''
  const toKey = to ? `${to.lat.toFixed(4)},${to.lng.toFixed(4)}` : ''
  return useQuery({
    queryKey: ['driving-route', fromKey, toKey],
    enabled: !!from && !!to,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      const timeout = setTimeout(abort, 15_000)
      try {
        return await fetchDrivingRoute({ from, to, signal: controller.signal })
      } finally {
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
      }
    },
  })
}
