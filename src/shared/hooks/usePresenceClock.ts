import { useEffect, useState } from 'react'
import type { Vendor } from '../../types/domain.types'

type Presence = Pick<Vendor, 'online' | 'is_verified' | 'last_seen_at'>
export function usePresenceClock(vendors: readonly (Presence | null | undefined)[]) {
  const [now, setNow] = useState(Date.now)
  const expiries = vendors
    .filter((vendor) => vendor?.online && vendor.is_verified && vendor.last_seen_at)
    .map((vendor) => Date.parse(vendor!.last_seen_at!) + 120_001)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .join(',')
  useEffect(() => {
    let timer: number | undefined
    const tick = () => {
      window.clearTimeout(timer)
      const current = Date.now()
      setNow(current)
      const next = expiries
        .split(',')
        .map(Number)
        .find((expiry) => expiry > current)
      timer = window.setTimeout(tick, Math.max(1, Math.min(30_000, next ? next - current : 30_000)))
    }
    tick()
    const visible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', tick)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', tick)
    }
  }, [expiries])
  return now
}
