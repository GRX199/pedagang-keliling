import { supabase } from './supabase'
import { getFriendlyFetchErrorMessage, requireServerOrigin } from '../../lib/network'

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000

export function validateImageFile(file: File | null | undefined): string | null {
  if (!file) return 'File gambar belum dipilih'
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return 'Format gambar harus JPG, PNG, WEBP, atau GIF'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Ukuran gambar maksimal 5 MB'
  }
  return null
}

async function getUploadAccessToken({ forceRefresh = false } = {}): Promise<string> {
  if (forceRefresh) {
    const refreshRes = await supabase.auth.refreshSession()
    const refreshedToken = refreshRes?.data?.session?.access_token
    if (refreshRes?.error || !refreshedToken) {
      throw new Error('Sesi login tidak valid. Silakan logout lalu login ulang.')
    }

    return refreshedToken
  }

  const sessionRes = await supabase.auth.getSession()
  const session = sessionRes?.data?.session
  const accessToken = session?.access_token
  if (!accessToken) {
    throw new Error('Sesi login tidak ditemukan untuk upload gambar')
  }

  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0
  if (expiresAtMs && expiresAtMs - Date.now() <= TOKEN_REFRESH_MARGIN_MS) {
    return getUploadAccessToken({ forceRefresh: true })
  }

  return accessToken
}

async function uploadWithToken({
  serverOrigin,
  accessToken,
  formData,
}: {
  serverOrigin: string
  accessToken: string
  formData: FormData
}) {
  let response
  try {
    response = await fetch(`${serverOrigin}/upload-only`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    })
  } catch (error) {
    throw new Error(getFriendlyFetchErrorMessage(error, 'Gagal upload gambar.'), { cause: error })
  }

  const body: unknown = await response.json().catch(() => ({}))
  const payload = body && typeof body === 'object' ? body : {}
  return {
    response,
    payload: {
      error: 'error' in payload && typeof payload.error === 'string' ? payload.error : undefined,
      imageUrl:
        'imageUrl' in payload && typeof payload.imageUrl === 'string' ? payload.imageUrl : null,
    },
  }
}

export async function uploadImageFile({
  file,
  vendorId,
  folder = 'products',
}: {
  file: File | null
  vendorId: string
  folder?: 'products' | 'profiles' | 'payments' | 'chat'
}): Promise<string | null> {
  if (!file) return null
  if (!vendorId) throw new Error('Vendor tidak terdeteksi')

  const validationError = validateImageFile(file)
  if (validationError) throw new Error(validationError)

  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', folder)

  const serverOrigin = requireServerOrigin()
  let accessToken = await getUploadAccessToken()
  let { response, payload } = await uploadWithToken({ serverOrigin, accessToken, formData })

  if (response.status === 401) {
    accessToken = await getUploadAccessToken({ forceRefresh: true })
    const retryResult = await uploadWithToken({ serverOrigin, accessToken, formData })
    response = retryResult.response
    payload = retryResult.payload
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Gagal upload gambar')
  }

  return payload.imageUrl || null
}
