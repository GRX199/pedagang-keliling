export function errorMessage(
  error: unknown,
  fallback = 'Terjadi kendala. Silakan coba lagi.',
): string {
  if (error instanceof Error) return error.message
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message
  return fallback
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function errorDetails(error: unknown): string {
  if (!error || typeof error !== 'object')
    return typeof error === 'string' ? error : ''
  return ['message', 'details', 'hint']
    .map((key) =>
      key in error ? String((error as Record<string, unknown>)[key] || '') : '',
    )
    .join(' ')
}
