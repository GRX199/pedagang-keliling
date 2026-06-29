import { supabase } from './supabase'
import { getFriendlyFetchErrorMessage, requireServerOrigin } from './network'

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function validateImageFile(file) {
  if (!file) return 'File gambar belum dipilih'
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return 'Format gambar harus JPG, PNG, WEBP, atau GIF'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Ukuran gambar maksimal 5 MB'
  }
  return null
}

export async function uploadImageFile({ file, vendorId, folder = 'products' }) {
  if (!file) return null
  if (!vendorId) throw new Error('Vendor tidak terdeteksi')

  const validationError = validateImageFile(file)
  if (validationError) throw new Error(validationError)

  const sessionRes = await supabase.auth.getSession()
  const accessToken = sessionRes?.data?.session?.access_token
  if (!accessToken) {
    throw new Error('Sesi login tidak ditemukan untuk upload gambar')
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', folder)

  const serverOrigin = requireServerOrigin()
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

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || 'Gagal upload gambar')
  }

  return payload.imageUrl || null
}
