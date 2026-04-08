import { supabase } from './supabase'
import { getFriendlyFetchErrorMessage, getServerOrigin } from './network'

const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || 'data'
const SERVER_ORIGIN = getServerOrigin()

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function sanitizeFileName(name) {
  return String(name || 'upload')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'upload'
}

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

  const filePath = `vendors/${vendorId}/${folder}/${Date.now()}-${sanitizeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, file, { cacheControl: '3600', upsert: false })

  if (!uploadError) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath)
    return data?.publicUrl || null
  }

  const sessionRes = await supabase.auth.getSession()
  const accessToken = sessionRes?.data?.session?.access_token
  if (!accessToken) {
    throw new Error(uploadError.message || 'Gagal upload gambar')
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', folder)

  let response
  try {
    response = await fetch(`${SERVER_ORIGIN}/upload-only`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    })
  } catch (error) {
    throw new Error(getFriendlyFetchErrorMessage(error, 'Gagal upload gambar.'))
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || uploadError.message || 'Gagal upload gambar')
  }

  return payload.imageUrl || null
}
