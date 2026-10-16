import { supabase } from './supabase'
import { getServerOrigin } from '../../lib/network'
import { fetchWithDeadline } from './fetchWithDeadline'

export type ErrorArea =
  | 'orders'
  | 'chat'
  | 'media'
  | 'auth'
  | 'map'
  | 'application'
  | 'products'
  | 'profile'
  | 'notifications'
  | 'admin'
export type ErrorSource = 'query' | 'mutation' | 'runtime' | 'handled'
const seen = new Map<string, number>()
let recent: number[] = []

export function errorCategory(error: unknown) {
  const value =
    error && typeof error === 'object' ? (error as Record<string, unknown>) : {}
  const code = String(value.code || value.status || '')
  if (['401', 'PGRST301', 'invalid_token'].includes(code)) return 'auth'
  if (['403', '42501'].includes(code)) return 'permission'
  if (['400', '23505', '23514', '22023'].includes(code)) return 'validation'
  if (
    value.name === 'AbortError' ||
    value.name === 'TimeoutError' ||
    /failed to fetch|networkerror|fetch failed/i.test(
      String(value.message || '')
    )
  )
    return 'network'
  if (/^5\d\d$/.test(code)) return 'server'
  return 'unexpected'
}

export function queryErrorArea(key: readonly unknown[]): ErrorArea {
  const name = typeof key[0] === 'string' ? key[0] : ''
  if (/order|demand/.test(name)) return 'orders'
  if (/chat/.test(name)) return 'chat'
  if (/notification|nearby/.test(name)) return 'notifications'
  if (/map|route/.test(name)) return 'map'
  if (/product/.test(name)) return 'products'
  if (/profile|vendor/.test(name)) return 'profile'
  if (/admin/.test(name)) return 'admin'
  return 'application'
}

export async function reportError(
  error: unknown,
  area: ErrorArea,
  source: ErrorSource = 'handled'
) {
  if (typeof window === 'undefined' || !navigator.onLine || !getServerOrigin())
    return
  const now = Date.now()
  const category = errorCategory(error)
  const signature = `${area}:${source}:${category}`
  recent = recent.filter((at) => now - at < 5 * 60_000)
  if (recent.length >= 5 || now - (seen.get(signature) || 0) < 60_000) return
  seen.set(signature, now)
  recent.push(now)
  for (const [key, at] of seen) if (now - at > 60_000) seen.delete(key)
  try {
    const { data } = await supabase.auth.getSession()
    if (!data.session?.access_token) return
    // Deliberately no message, stack, URL, query key, user ID or arbitrary context.
    await fetchWithDeadline(
      `${getServerOrigin()}/client-errors`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`
        },
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          area,
          category,
          source
        })
      },
      5000
    )
  } catch {
    /* Diagnostic failures must not affect the user's action or recurse. */
  }
}

export function installErrorReporting() {
  const onError = (event: ErrorEvent) => {
    void reportError(event.error, 'application', 'runtime')
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    void reportError(event.reason, 'application', 'runtime')
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
