import { useId, useState, type SetStateAction } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Role } from '../../types/domain.types'
import { VENDOR_CATEGORIES } from '../../lib/vendor-categories'
import { formatMobility, MOBILITY_OPTIONS } from '../../lib/pickup'
import { useToast } from '../../shared/components/ToastProvider'
import { useAuth } from '../auth/AuthProvider'
import { useGeolocation } from '../../shared/hooks/useGeolocation'
import { errorMessage } from '../../shared/lib/utils'
import { useProfile } from './useProfile'
import { Disclosure } from '../../shared/components/Disclosure'
import { buildProfileForm, type ProfileForm } from './profile-form'
import { getVendorCoordinates } from '../../shared/lib/coordinates'
import {
  formatVendorCategoryLabel,
  formatVendorPromoExpiry,
  getVendorPaymentMethodDetails,
  getVendorPaymentSetupSummary,
  formatVendorServiceRadius,
  getOperatingHoursText,
  getVendorPromoText,
  isVendorPromoActive,
  normalizeVendorPaymentDetails
} from '../../lib/vendor'

export default function ProfilePanel({
  currentUser,
  role
}: {
  currentUser: User
  role: Role
}) {
  const { refreshAuth } = useAuth()
  const toast = useToast()
  const profileQuery = useProfile(currentUser, role)
  const profile = profileQuery.data
  const [draft, setDraft] = useState<ProfileForm | null>(null)
  const formId = useId()
  const form = draft ?? buildProfileForm(profile)
  const editing = draft !== null
  function setForm(update: SetStateAction<ProfileForm>) {
    setDraft((previous) =>
      typeof update === 'function' ? update(previous ?? form) : update
    )
  }
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [paymentQrFile, setPaymentQrFile] = useState<File | null>(null)
  const geo = useGeolocation()
  const saving = profileQuery.saving
  const savingLocation = geo.pending || profileQuery.savingLocation

  async function saveProfile() {
    try {
      const saved = await profileQuery.save({ form, photoFile, paymentQrFile })
      if (!saved) return
      if (role !== 'vendor') await refreshAuth()
      toast.push('Profil berhasil diperbarui', { type: 'success' })
      setDraft(null)
      setPhotoFile(null)
      setPaymentQrFile(null)
    } catch (error) {
      toast.push(errorMessage(error, 'Gagal menyimpan profil'), {
        type: 'error'
      })
    }
  }
  async function saveCurrentLocation() {
    if (role !== 'vendor' || savingLocation) return
    const point = await geo.locate()
    if (!point) return
    try {
      await profileQuery.updateLocation(point)
      toast.push('Lokasi toko berhasil diperbarui', { type: 'success' })
    } catch (error) {
      toast.push(errorMessage(error, 'Gagal menyimpan lokasi toko'), {
        type: 'error'
      })
    }
  }
  if (profileQuery.isPending)
    return (
      <div
        role="status"
        className="rounded-2xl bg-white p-4 text-sm text-slate-500"
      >
        Memuat profil...
      </div>
    )
  if (!profile)
    return (
      <div
        role="alert"
        className="rounded-2xl bg-white p-4 text-sm text-amber-800"
      >
        {profileQuery.error
          ? 'Profil belum dapat dimuat.'
          : 'Profil toko belum tersedia.'}{' '}
        <button
          type="button"
          onClick={() => {
            void profileQuery.refetch()
          }}
        >
          Coba lagi
        </button>
      </div>
    )

  const vendorPaymentDetails = normalizeVendorPaymentDetails(
    profile.payment_details
  )
  const vendorPaymentSummary = getVendorPaymentSetupSummary(
    profile.payment_details
  )
  const qrisPaymentDetails = getVendorPaymentMethodDetails(
    profile.payment_details,
    'qris'
  )
  const bankPaymentDetails = getVendorPaymentMethodDetails(
    profile.payment_details,
    'bank_transfer'
  )
  const ewalletPaymentDetails = getVendorPaymentMethodDetails(
    profile.payment_details,
    'ewallet'
  )
  const hasActivePromo = isVendorPromoActive(profile)
  const promoText = getVendorPromoText(profile)
  const readyPaymentCount = vendorPaymentSummary.filter(
    (entry) => entry.ready
  ).length
  const readyPaymentLabel =
    readyPaymentCount > 0 ? `${readyPaymentCount} metode siap` : 'Belum diatur'

  function startEditing() {
    setDraft(buildProfileForm(profile))
  }
  function cancelEditing() {
    setDraft(null)
    setPhotoFile(null)
    setPaymentQrFile(null)
  }
  function field(
    key: keyof ProfileForm,
    label: string,
    placeholder?: string,
    rows?: number,
    type: 'text' | 'number' | 'datetime-local' = 'text'
  ) {
    return (
      <div className="min-w-0 text-sm font-medium text-slate-700">
        <label htmlFor={formId + key} className="mb-1.5 block">
          {label}
        </label>
        {rows ? (
          <textarea
            id={formId + key}
            rows={rows}
            className="ui-field resize-y"
            value={form[key]}
            placeholder={placeholder}
            onChange={(event) =>
              setForm((current) => ({ ...current, [key]: event.target.value }))
            }
          />
        ) : (
          <input
            id={formId + key}
            type={type}
            min={type === 'number' ? '0' : undefined}
            step={type === 'number' ? '0.1' : undefined}
            maxLength={
              key === 'service_area'
                ? 240
                : ['route_description', 'stopping_points'].includes(key)
                  ? 500
                  : undefined
            }
            inputMode={
              key === 'payment_bank_account_number' ||
              key === 'payment_ewallet_number'
                ? 'numeric'
                : undefined
            }
            className="ui-field"
            value={form[key]}
            placeholder={placeholder}
            onChange={(event) =>
              setForm((current) => ({ ...current, [key]: event.target.value }))
            }
          />
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
        Profil saya
      </h2>
      {profileQuery.error && (
        <p role="alert" className="text-sm text-amber-800">
          Pembaruan profil tertunda. Draft Anda tetap tersimpan.
        </p>
      )}
      {geo.error && (
        <p role="alert" className="text-sm text-amber-800">
          {geo.error}
        </p>
      )}

      <section className="ui-surface p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-teal-50 text-xl font-semibold text-teal-800">
            {profile.photo_url ? (
              <img
                src={profile.photo_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              (profile.name || 'U')[0]
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-slate-900">
              {profile.name || profile.email}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {role === 'vendor'
                ? 'Pedagang'
                : role === 'admin'
                  ? 'Admin'
                  : 'Pelanggan'}
            </p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={startEditing}
              className="ui-secondary shrink-0"
            >
              Edit
            </button>
          )}
        </div>
        {!editing && role === 'vendor' && profile.description && (
          <p className="mt-4 line-clamp-3 break-words border-t border-slate-100 pt-4 text-sm leading-6 text-slate-600">
            {profile.description}
          </p>
        )}
        {!editing && role !== 'vendor' && (
          <p className="mt-4 break-all border-t border-slate-100 pt-4 text-sm text-slate-500">
            {currentUser.email}
          </p>
        )}
      </section>

      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void saveProfile()
          }}
        >
          <fieldset disabled={saving} className="min-w-0 space-y-3">
            <section className="ui-surface space-y-4 p-4 sm:p-5">
              {field('name', 'Nama profil', 'Nama Anda atau nama toko')}
              {role === 'vendor' && (
                <>
                  {field(
                    'description',
                    'Deskripsi toko',
                    'Apa yang Anda jual?',
                    3
                  )}
                  <label className="block text-sm font-medium text-slate-700">
                    Kategori dagangan
                    <select
                      aria-label="Kategori dagangan"
                      value={form.category_primary}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          category_primary: event.target.value
                        }))
                      }
                      className="ui-field mt-1.5"
                    >
                      <option value="">Pilih kategori dagangan</option>
                      {form.category_primary &&
                        !VENDOR_CATEGORIES.some(
                          (category) => category.label === form.category_primary
                        ) && (
                          <option value={form.category_primary}>
                            {form.category_primary} (kategori lama)
                          </option>
                        )}
                      {VENDOR_CATEGORIES.map((category) => (
                        <option key={category.id} value={category.label}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="block min-w-0 text-sm font-medium text-slate-700">
                Foto profil
                <input
                  type="file"
                  accept="image/*"
                  className="mt-2 block max-w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-teal-800"
                  onChange={(event) =>
                    setPhotoFile(event.target.files?.[0] || null)
                  }
                />
              </label>
            </section>

            {role === 'vendor' && (
              <>
                <Disclosure
                  title="Area & jam jualan"
                  description="Rute, cara berkeliling, dan jam operasional"
                >
                  <label className="block text-sm font-medium text-slate-700">
                    Cara berkeliling
                    <select
                      aria-label="Cara berkeliling"
                      value={form.mobility_type}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          mobility_type: event.target.value
                        }))
                      }
                      className="ui-field mt-1.5"
                    >
                      <option value="">Belum diisi</option>
                      {MOBILITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {field(
                    'service_radius_km',
                    'Radius layanan (km)',
                    'Opsional',
                    undefined,
                    'number'
                  )}
                  {field(
                    'service_area',
                    'Area berjualan',
                    'Contoh: sekitar pasar dan perumahan'
                  )}
                  {field(
                    'route_description',
                    'Rute biasa (deskriptif)',
                    'Rute yang biasa dilewati'
                  )}
                  {field(
                    'stopping_points',
                    'Titik berhenti untuk pengambilan',
                    'Patokan yang mudah ditemukan'
                  )}
                  {field(
                    'operating_hours_text',
                    'Jam operasional',
                    'Contoh: Senin-Sabtu 07.00-12.00',
                    2
                  )}
                </Disclosure>

                <Disclosure
                  title="Pembayaran"
                  description="QRIS, rekening bank, dan e-wallet"
                >
                  <label className="block min-w-0 text-sm font-medium text-slate-700">
                    Foto QRIS
                    {form.payment_qris_image_url && (
                      <img
                        src={form.payment_qris_image_url}
                        alt="QRIS toko"
                        className="my-3 max-h-48 w-full rounded-xl border border-slate-200 object-contain p-2"
                      />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="mt-2 block max-w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-teal-800"
                      onChange={(event) =>
                        setPaymentQrFile(event.target.files?.[0] || null)
                      }
                    />
                  </label>
                  {paymentQrFile && (
                    <p className="break-all text-xs text-slate-500">
                      File dipilih: {paymentQrFile.name}
                    </p>
                  )}
                  {form.payment_qris_image_url && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentQrFile(null)
                        setForm((current) => ({
                          ...current,
                          payment_qris_image_url: ''
                        }))
                      }}
                      className="ui-secondary text-rose-700"
                    >
                      Hapus QRIS
                    </button>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {field(
                      'payment_bank_name',
                      'Nama bank',
                      'BCA, BRI, dan lainnya'
                    )}
                    {field('payment_bank_account_name', 'Pemilik rekening')}
                  </div>
                  {field('payment_bank_account_number', 'Nomor rekening')}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {field(
                      'payment_ewallet_name',
                      'Nama e-wallet',
                      'DANA, OVO, GoPay'
                    )}
                    {field('payment_ewallet_number', 'Nomor e-wallet')}
                  </div>
                  {field(
                    'payment_notes',
                    'Catatan pembayaran (opsional)',
                    'Petunjuk pembayaran untuk pelanggan',
                    2
                  )}
                </Disclosure>

                <Disclosure
                  title="Promo"
                  description="Opsional, ditampilkan saat promo aktif"
                >
                  {field(
                    'promo_text',
                    'Isi promo',
                    'Contoh: gratis sambal untuk pembelian hari ini',
                    2
                  )}
                  {field(
                    'promo_expires_at',
                    'Akhir promo',
                    undefined,
                    undefined,
                    'datetime-local'
                  )}
                  <p className="text-xs text-slate-500">
                    Tanggal kosong: promo aktif sampai Anda menghapus teksnya.
                  </p>
                </Disclosure>
              </>
            )}

            <div className="ui-form-actions">
              <button
                type="button"
                onClick={cancelEditing}
                className="ui-secondary"
              >
                Batal
              </button>
              <button type="submit" disabled={saving} className="ui-primary">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </fieldset>
        </form>
      ) : role === 'vendor' ? (
        <div className="space-y-3">
          <Disclosure
            title="Informasi toko"
            description={[
              profile.category_primary
                ? formatVendorCategoryLabel(profile.category_primary)
                : null,
              profile.is_verified ? 'Terverifikasi' : 'Menunggu verifikasi'
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <dl className="space-y-3 text-sm">
              {[
                [
                  'Jam operasional',
                  getOperatingHoursText(profile.operating_hours)
                ],
                ['Area berjualan', profile.service_area],
                ['Cara berkeliling', formatMobility(profile.mobility_type)],
                [
                  'Radius layanan',
                  formatVendorServiceRadius(profile.service_radius_km)
                ],
                ['Rute biasa', profile.route_description],
                ['Titik berhenti', profile.stopping_points]
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-slate-500">{label}</dt>
                    <dd className="mt-0.5 break-words text-slate-800">
                      {value}
                    </dd>
                  </div>
                ))}
              <div>
                <dt className="text-xs text-slate-500">Lokasi toko</dt>
                <dd className="mt-0.5 text-slate-800">
                  {getVendorCoordinates(profile.location)
                    ? 'Lokasi tersimpan'
                    : 'Belum diatur'}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => void saveCurrentLocation()}
              disabled={savingLocation}
              className="ui-secondary w-full"
            >
              {savingLocation ? 'Menyimpan lokasi...' : 'Perbarui lokasi toko'}
            </button>
          </Disclosure>

          <Disclosure title="Pembayaran" description={readyPaymentLabel}>
            {[
              { label: 'QRIS', payment: qrisPaymentDetails },
              { label: 'Transfer bank', payment: bankPaymentDetails },
              { label: 'E-wallet', payment: ewalletPaymentDetails }
            ].map(({ label, payment }) => {
              return (
                <div
                  key={label}
                  className="border-b border-slate-100 pb-3 last:border-0 last:pb-0"
                >
                  <h4 className="text-sm font-semibold text-slate-800">
                    {label}
                  </h4>
                  {payment.imageUrl && (
                    <img
                      src={payment.imageUrl}
                      alt="QRIS toko"
                      className="mt-2 max-h-48 w-full rounded-xl border border-slate-200 object-contain p-2"
                    />
                  )}
                  {payment.ready ? (
                    payment.rows.map((row) => (
                      <p
                        key={row.label}
                        className="mt-1 break-words text-sm text-slate-600"
                      >
                        <span className="text-slate-500">{row.label}: </span>
                        {row.value}
                      </p>
                    ))
                  ) : (
                    <p className="mt-1 text-sm text-slate-500">Belum diatur</p>
                  )}
                </div>
              )
            })}
            {vendorPaymentDetails.payment_notes && (
              <p className="text-sm text-slate-600">
                {vendorPaymentDetails.payment_notes}
              </p>
            )}
          </Disclosure>
          {hasActivePromo && (
            <Disclosure
              title="Promo aktif"
              description={formatVendorPromoExpiry(profile)}
            >
              <p className="break-words text-sm leading-6 text-slate-700">
                {promoText}
              </p>
            </Disclosure>
          )}
        </div>
      ) : null}
    </div>
  )
}
