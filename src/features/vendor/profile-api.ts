import type { User } from '@supabase/supabase-js'
import type { Role, Coordinates } from '../../types/domain.types'
import { supabase } from '../../shared/lib/supabase'
import { uploadImageFile, validateImageFile } from '../../shared/lib/media'
import { createLocationPayload } from '../../shared/lib/coordinates'
import { syncCurrentProfile } from '../../lib/profiles'
import {
  buildVendorProfilePayload,
  validateProfileForm,
  type ProfileForm,
  type ProfileView,
} from './profile-form'

function metadataText(value: unknown) {
  return typeof value === 'string' ? value : ''
}
export async function fetchProfile(
  user: User,
  role: Role,
  signal: AbortSignal
): Promise<ProfileView | null> {
  if (role === 'vendor') {
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .eq('id', user.id)
      .abortSignal(signal)
      .maybeSingle()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .abortSignal(signal)
    .maybeSingle()
  if (error) throw error
  return {
    id: user.id,
    name:
      data?.display_name || metadataText(user.user_metadata.full_name) || user.email || 'Pengguna',
    photo_url: data?.avatar_url || metadataText(user.user_metadata.avatar_url) || null,
    email: user.email,
    description: null,
  }
}

export type SaveProfileInput = {
  form: ProfileForm
  photoFile: File | null
  paymentQrFile: File | null
}
export async function saveProfile(
  user: User,
  role: Role,
  input: SaveProfileInput
): Promise<ProfileView> {
  validateProfileForm(input.form)
  for (const file of [input.photoFile, input.paymentQrFile]) {
    if (!file) continue
    const error = validateImageFile(file)
    if (error) throw new Error(error)
  }
  const form = { ...input.form }
  if (input.photoFile) {
    const url = await uploadImageFile({
      file: input.photoFile,
      vendorId: user.id,
      folder: 'profiles',
    })
    if (!url) throw new Error('Foto profil belum terunggah. Coba lagi.')
    form.photo_url = url
  }
  if (role === 'vendor' && input.paymentQrFile) {
    const url = await uploadImageFile({
      file: input.paymentQrFile,
      vendorId: user.id,
      folder: 'payments',
    })
    if (!url) throw new Error('QRIS belum terunggah. Coba lagi.')
    form.payment_qris_image_url = url
  }
  if (role === 'vendor') {
    const { data, error } = await supabase
      .from('vendors')
      .update(buildVendorProfilePayload(form))
      .eq('id', user.id)
      .select('*')
      .single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.auth.updateUser({
    data: { full_name: form.name.trim(), avatar_url: form.photo_url || null },
  })
  if (error) throw error
  if (!data.user || data.user.id !== user.id)
    throw new Error('Sesi akun berubah. Silakan masuk kembali.')
  const profile = await syncCurrentProfile(data.user, role)
  if (!profile)
    throw new Error(
      'Data akun tersimpan, tetapi nama di chat belum tersinkron. Coba simpan kembali.'
    )
  return {
    id: user.id,
    name: form.name.trim(),
    photo_url: form.photo_url || null,
    email: data.user.email,
    description: null,
  }
}

export async function updateProfileLocation(
  userId: string,
  coordinates: Coordinates
): Promise<ProfileView> {
  const location = createLocationPayload(coordinates)
  if (!location) throw new Error('Lokasi tidak valid. Coba ambil lokasi kembali.')
  const { data, error } = await supabase
    .from('vendors')
    .update({ location })
    .eq('id', userId)
    .select('*')
    .single()
  if (error) throw error
  return data
}
