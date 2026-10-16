export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 30_000
) {
  const controller = new AbortController()
  const source =
    init?.signal || (input instanceof Request ? input.signal : null)
  const abort = () => controller.abort(source?.reason)
  if (source?.aborted) abort()
  else source?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timeout', 'TimeoutError')),
    timeoutMs
  )
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    source?.removeEventListener('abort', abort)
  }
}
