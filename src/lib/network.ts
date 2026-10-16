import { errorMessage } from '../shared/lib/utils'

export function assertOnlineForWrite() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    throw new Error('Tidak ada koneksi. Sambungkan internet lalu coba lagi.')
}

function isLoopbackHost(hostname: string) {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  )
}

export function getServerOrigin() {
  const configuredOrigin = String(import.meta.env.VITE_SERVER_URL || '').trim()

  if (!configuredOrigin) {
    if (
      typeof window !== 'undefined' &&
      window.location?.hostname &&
      (import.meta.env.DEV || isLoopbackHost(window.location.hostname))
    ) {
      return `http://${window.location.hostname}:4000`
    }

    return ''
  }

  try {
    const url = new URL(configuredOrigin)

    if (
      typeof window !== 'undefined' &&
      import.meta.env.DEV &&
      window.location?.hostname &&
      isLoopbackHost(url.hostname) &&
      !isLoopbackHost(window.location.hostname)
    ) {
      url.hostname = window.location.hostname
    }

    return url.origin
  } catch {
    return configuredOrigin.replace(/\/$/, '')
  }
}

export function requireServerOrigin() {
  const origin = getServerOrigin()
  if (!origin) {
    throw new Error(
      'URL backend belum dikonfigurasi. Isi VITE_SERVER_URL di Vercel dengan URL HTTPS backend Render.',
    )
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new Error('URL backend tidak valid. Periksa VITE_SERVER_URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('URL backend harus memakai HTTP atau HTTPS.')
  if (
    typeof window !== 'undefined' &&
    !import.meta.env.DEV &&
    !isLoopbackHost(window.location.hostname) &&
    isLoopbackHost(url.hostname)
  )
    throw new Error(
      'URL backend production masih localhost. Isi VITE_SERVER_URL dengan URL HTTPS backend, lalu deploy ulang.',
    )
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    url.protocol !== 'https:'
  )
    throw new Error(
      'Backend harus memakai HTTPS saat website dibuka melalui HTTPS.',
    )
  return url.origin
}

export function getServerConnectionHint() {
  const origin = getServerOrigin()
  if (!origin) {
    return 'Isi VITE_SERVER_URL di environment frontend dengan URL HTTPS backend Render, lalu deploy ulang.'
  }

  try {
    const serverUrl = new URL(origin)
    const appOrigin =
      typeof window !== 'undefined' ? window.location.origin : null

    if (
      typeof window !== 'undefined' &&
      serverUrl.hostname !== window.location.hostname
    ) {
      return `Periksa apakah server ${origin} bisa diakses dari perangkat ini, dan pastikan CORS backend mengizinkan ${appOrigin}.`
    }

    return `Periksa apakah server ${origin} sedang aktif dan port-nya bisa diakses dari perangkat ini.`
  } catch {
    return `Periksa apakah server ${origin} sedang aktif dan bisa diakses dari perangkat ini.`
  }
}

export function getFriendlyFetchErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  const message = errorMessage(error, '')
  if (/failed to fetch|fetch failed|networkerror/i.test(message)) {
    return `${fallbackMessage} ${getServerConnectionHint()}`
  }

  return fallbackMessage
}

export function getGeolocationErrorMessage(error: unknown) {
  if (
    typeof window !== 'undefined' &&
    window.isSecureContext === false &&
    !isLoopbackHost(window.location.hostname)
  ) {
    return 'Akses lokasi butuh koneksi aman (HTTPS) atau localhost. Untuk test di HP, buka aplikasi dari domain HTTPS.'
  }

  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : null
  switch (code) {
    case 1:
      return 'Izin lokasi ditolak di browser atau perangkat Anda.'
    case 2:
      return 'Lokasi tidak tersedia. Pastikan GPS atau layanan lokasi perangkat aktif.'
    case 3:
      return 'Lokasi belum sempat terbaca. Pastikan GPS aktif, coba di area terbuka, lalu tekan Lokasi Saya lagi.'
    default:
      return 'Tidak dapat mengakses lokasi Anda'
  }
}
