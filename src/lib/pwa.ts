import { reportError } from '../shared/lib/error-reporting'

export function isStandaloneApp() {
  if (typeof window === 'undefined') return false

  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator && window.navigator.standalone === true)
  )
}

export function registerServiceWorker() {
  if (
    import.meta.env.DEV ||
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return
  }

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch((error) => { void reportError(error, 'application') })
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
