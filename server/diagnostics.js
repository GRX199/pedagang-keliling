import { randomUUID } from 'node:crypto'

const AREAS = new Set([
  'orders',
  'chat',
  'media',
  'auth',
  'map',
  'application',
  'products',
  'profile',
  'notifications',
  'admin'
])
const CATEGORIES = new Set([
  'network',
  'auth',
  'permission',
  'validation',
  'server',
  'unexpected'
])
const SOURCES = new Set(['query', 'mutation', 'runtime', 'handled'])
const SAFE_CODES = new Set([
  '42501',
  '23505',
  '23503',
  '23514',
  '22023',
  'PGRST202',
  'PGRST301',
  'PGRST116',
  'ETIMEDOUT',
  'ECONNRESET'
])

export function clientDiagnostic(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    !AREAS.has(input.area) ||
    !CATEGORIES.has(input.category) ||
    !SOURCES.has(input.source)
  )
    return null
  if (
    typeof input.eventId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.eventId
    )
  )
    return null
  // Rebuild from a closed allowlist; never spread client JSON into logs.
  return {
    eventId: input.eventId,
    area: input.area,
    category: input.category,
    source: input.source
  }
}

export function recordDiagnostic(
  event,
  { requestId, status, durationMs, code, client } = {}
) {
  const payload = {
    time: new Date().toISOString(),
    event,
    requestId: /^[0-9a-f-]{36}$/.test(requestId || '') ? requestId : undefined,
    status:
      Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : undefined,
    durationMs: Number.isFinite(durationMs)
      ? Math.max(0, Math.round(durationMs))
      : undefined,
    code: SAFE_CODES.has(code) ? code : undefined,
    client: clientDiagnostic(client) || undefined
  }
  console.warn(JSON.stringify(payload))
}

export function diagnosticRequests(req, res, next) {
  const start = performance.now()
  res.locals.requestId = randomUUID()
  res.setHeader('X-Request-ID', res.locals.requestId)
  res.once('finish', () => {
    if (res.statusCode < 400) return
    const routes = {
      '/upload-only': 'upload',
      '/upload-product': 'product_upload',
      '/client-errors': 'client_diagnostic',
      '/vendor/:id/online': 'presence',
      '/api/vendor/:id/online': 'presence'
    }
    const route = Array.isArray(req.route?.path)
      ? req.route.path[0]
      : req.route?.path
    recordDiagnostic(`http.${routes[route] || 'request'}.failed`, {
      requestId: res.locals.requestId,
      status: res.statusCode,
      durationMs: performance.now() - start
    })
  })
  next()
}
