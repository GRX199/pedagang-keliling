import type { Vendor } from '../../types/domain.types'
import type { TablesUpdate } from '../../types/database.types'
import {
  buildOperatingHoursPayload,
  buildVendorPaymentDetailsPayload,
  getOperatingHoursText,
  normalizeVendorPaymentDetails,
} from '../../lib/vendor'

export type ProfileView = Pick<Vendor, 'id' | 'name' | 'description' | 'photo_url'> &
  Partial<Omit<Vendor, 'id' | 'name' | 'description' | 'photo_url'>> & { email?: string }

export function toLocalDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function buildProfileForm(profile: ProfileView | null | undefined) {
  const payment = normalizeVendorPaymentDetails(profile?.payment_details)
  const hours = getOperatingHoursText(profile?.operating_hours)
  return {
    name: profile?.name || '',
    description: profile?.description || '',
    photo_url: profile?.photo_url || '',
    category_primary: profile?.category_primary || '',
    service_radius_km: profile?.service_radius_km == null ? '' : String(profile.service_radius_km),
    operating_hours_text: hours === 'Belum diatur' ? '' : hours,
    mobility_type: profile?.mobility_type || '',
    service_area: profile?.service_area || '',
    route_description: profile?.route_description || '',
    stopping_points: profile?.stopping_points || '',
    promo_text: profile?.promo_text || '',
    promo_expires_at: toLocalDateTime(profile?.promo_expires_at),
    payment_qris_image_url: payment.qris_image_url,
    payment_bank_name: payment.bank_name,
    payment_bank_account_name: payment.bank_account_name,
    payment_bank_account_number: payment.bank_account_number,
    payment_ewallet_name: payment.ewallet_name,
    payment_ewallet_number: payment.ewallet_number,
    payment_notes: payment.payment_notes,
  }
}
export type ProfileForm = ReturnType<typeof buildProfileForm>

export function validateProfileForm(form: ProfileForm) {
  if (!form.name.trim()) throw new Error('Isi nama toko atau nama Anda.')
  if (form.service_radius_km.trim()) {
    const radius = Number(form.service_radius_km)
    if (!Number.isFinite(radius) || radius < 0 || radius > 9999.99)
      throw new Error('Radius layanan harus antara 0 dan 9999,99 km.')
  }
  if (
    form.mobility_type &&
    !['walking', 'pushcart', 'bicycle', 'motor_vehicle'].includes(form.mobility_type)
  )
    throw new Error('Pilih cara berkeliling yang tersedia.')
  if (form.promo_expires_at && !Number.isFinite(new Date(form.promo_expires_at).getTime()))
    throw new Error('Tanggal akhir promo tidak valid.')
}

export function buildVendorProfilePayload(form: ProfileForm): TablesUpdate<'vendors'> {
  validateProfileForm(form)
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    photo_url: form.photo_url || null,
    category_primary: form.category_primary.trim() || null,
    service_radius_km: form.service_radius_km.trim() ? Number(form.service_radius_km) : null,
    operating_hours: buildOperatingHoursPayload(form.operating_hours_text),
    mobility_type: form.mobility_type || null,
    service_area: form.service_area.trim() || null,
    route_description: form.route_description.trim() || null,
    stopping_points: form.stopping_points.trim() || null,
    promo_text: form.promo_text.trim() || null,
    promo_expires_at: form.promo_expires_at ? new Date(form.promo_expires_at).toISOString() : null,
    payment_details: buildVendorPaymentDetailsPayload({
      qris_image_url: form.payment_qris_image_url,
      bank_name: form.payment_bank_name,
      bank_account_name: form.payment_bank_account_name,
      bank_account_number: form.payment_bank_account_number,
      ewallet_name: form.payment_ewallet_name,
      ewallet_number: form.payment_ewallet_number,
      payment_notes: form.payment_notes,
    }),
  }
}
