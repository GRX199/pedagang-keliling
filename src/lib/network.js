function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function getServerOrigin() {
  const configuredOrigin = String(import.meta.env.VITE_SERVER_URL || '').trim()

  if (!configuredOrigin) {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      return `http://${window.location.hostname}:4000`
    }

    return 'http://localhost:4000'
  }

  try {
    const url = new URL(configuredOrigin)

    if (
      typeof window !== 'undefined' &&
      window.location?.hostname &&
      isLoopbackHost(url.hostname) &&
      !isLoopbackHost(window.location.hostname)
    ) {
      url.hostname = window.location.hostname
    }

    return url.origin
  } catch (_error) {
    return configuredOrigin.replace(/\/$/, '')
  }
}

export function getServerConnectionHint() {
  const origin = getServerOrigin()

  try {
    const serverUrl = new URL(origin)
    const appOrigin = typeof window !== 'undefined' ? window.location.origin : null

    if (typeof window !== 'undefined' && serverUrl.hostname !== window.location.hostname) {
      return `Periksa apakah server ${origin} bisa diakses dari perangkat ini, dan pastikan CORS backend mengizinkan ${appOrigin}.`
    }

    return `Periksa apakah server ${origin} sedang aktif dan port-nya bisa diakses dari perangkat ini.`
  } catch (_error) {
    return `Periksa apakah server ${origin} sedang aktif dan bisa diakses dari perangkat ini.`
  }
}

export function getFriendlyFetchErrorMessage(error, fallbackMessage) {
  const message = String(error?.message || '')
  if (/failed to fetch|fetch failed|networkerror/i.test(message)) {
    return `${fallbackMessage} ${getServerConnectionHint()}`
  }

  return fallbackMessage
}

export function getGeolocationErrorMessage(error) {
  if (
    typeof window !== 'undefined' &&
    window.isSecureContext === false &&
    !isLoopbackHost(window.location.hostname)
  ) {
    return 'Akses lokasi butuh koneksi aman (HTTPS) atau localhost. Untuk test di HP, buka aplikasi dari domain HTTPS.'
  }

  switch (error?.code) {
    case 1:
      return 'Izin lokasi ditolak di browser atau perangkat Anda.'
    case 2:
      return 'Lokasi tidak tersedia. Pastikan GPS atau layanan lokasi perangkat aktif.'
    case 3:
      return 'Permintaan lokasi timeout. Coba lagi saat sinyal GPS lebih stabil.'
    default:
      return 'Tidak dapat mengakses lokasi Anda'
  }
}
