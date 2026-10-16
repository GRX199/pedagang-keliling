import { useState, type SetStateAction } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Role } from '../../types/domain.types'
import { VENDOR_CATEGORIES } from '../../lib/vendor-categories'
import { formatMobility, MOBILITY_OPTIONS } from '../../lib/pickup'
import { useToast } from '../../shared/components/ToastProvider'
import { useAuth } from '../auth/AuthProvider'
import { useGeolocation } from '../../shared/hooks/useGeolocation'
import { errorMessage } from '../../shared/lib/utils'
import { useProfile } from './useProfile'
import { buildProfileForm, type ProfileForm } from './profile-form'
import { getVendorCoordinates } from '../../shared/lib/coordinates'
import {
  formatVendorCategoryLabel,
  formatVendorPromoExpiry,
  getVendorPaymentMethodDetails,
  getVendorPaymentSetupSummary,
  formatVendorServiceRadius,
  getOperatingHoursText,
  getVendorLocationUpdatedAtLabel,
  getVendorPromoText,
  isVendorPromoActive,
  normalizeVendorPaymentDetails,
} from '../../lib/vendor'

export default function ProfilePanel({ currentUser, role }: { currentUser: User; role: Role }) {
  const { refreshAuth } = useAuth()
  const toast = useToast()
  const profileQuery = useProfile(currentUser, role)
  const profile = profileQuery.data
  const [draft, setDraft] = useState<ProfileForm | null>(null)
  const form = draft ?? buildProfileForm(profile)
  const editing = draft !== null
  function setForm(update: SetStateAction<ProfileForm>) {
    setDraft((previous) => (typeof update === 'function' ? update(previous ?? form) : update))
  }
  const [showPaymentPreview, setShowPaymentPreview] = useState(false)
  const [showVendorPromoEditor, setShowVendorPromoEditor] = useState(false)
  const [showVendorPaymentEditor, setShowVendorPaymentEditor] = useState(false)
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
      setShowVendorPromoEditor(false)
      setShowVendorPaymentEditor(false)
      setPhotoFile(null)
      setPaymentQrFile(null)
    } catch (error) {
      toast.push(errorMessage(error, 'Gagal menyimpan profil'), { type: 'error' })
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
      toast.push(errorMessage(error, 'Gagal menyimpan lokasi toko'), { type: 'error' })
    }
  }
  if (profileQuery.isPending)
    return (
      <div role="status" className="rounded-2xl bg-white p-4 text-sm text-slate-500">
        Memuat profil...
      </div>
    )
  if (!profile)
    return (
      <div role="alert" className="rounded-2xl bg-white p-4 text-sm text-amber-800">
        {profileQuery.error ? 'Profil belum dapat dimuat.' : 'Profil toko belum tersedia.'}{' '}
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

  const vendorPaymentDetails = normalizeVendorPaymentDetails(profile.payment_details)
  const vendorPaymentSummary = getVendorPaymentSetupSummary(profile.payment_details)
  const qrisPaymentDetails = getVendorPaymentMethodDetails(profile.payment_details, 'qris')
  const bankPaymentDetails = getVendorPaymentMethodDetails(profile.payment_details, 'bank_transfer')
  const ewalletPaymentDetails = getVendorPaymentMethodDetails(profile.payment_details, 'ewallet')
  const hasActivePromo = isVendorPromoActive(profile)
  const promoText = getVendorPromoText(profile)
  const readyPaymentCount = vendorPaymentSummary.filter((entry) => entry.ready).length
  const readyPaymentLabel =
    readyPaymentCount > 0 ? `${readyPaymentCount} metode siap` : 'Belum diatur'

  return (
    <div className="min-w-0 rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
      {profileQuery.error ? (
        <p role="alert" className="mb-3 text-sm text-amber-800">
          Pembaruan profil tertunda. Draft Anda tetap tersimpan.
        </p>
      ) : null}
      {geo.error ? (
        <p role="alert" className="mb-3 text-sm text-amber-800">
          {geo.error}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 sm:h-16 sm:w-16">
            {profile.photo_url ? (
              <img src={profile.photo_url} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <div className="text-xl font-semibold text-slate-500">{(profile.name || 'U')[0]}</div>
            )}
          </div>

          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-900">
              {profile.name || profile.email}
            </div>
            <div className="text-sm text-slate-500">
              {role === 'vendor' ? 'Pedagang' : role === 'admin' ? 'Admin' : 'Pelanggan'}
            </div>
          </div>
        </div>

        {!editing ? (
          <button
            onClick={() => {
              setShowPaymentPreview(false)
              setShowVendorPromoEditor(false)
              setShowVendorPaymentEditor(false)
              setDraft(buildProfileForm(profile))
            }}
            className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Edit
          </button>
        ) : null}
      </div>

      <div className="mt-4">
        {!editing ? (
          <>
            <div className="rounded-2xl bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-600 sm:px-4">
              <span className="line-clamp-3 block">
                {role === 'vendor'
                  ? profile.description ||
                    'Tambahkan deskripsi singkat agar pelanggan lebih percaya.'
                  : 'Kelola nama dan foto akun Anda dari tombol edit.'}
              </span>
            </div>

            {role === 'vendor' && (
              <div className="mt-3 space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">Ringkasan toko</div>
                      <div className="mt-1 truncate text-sm text-slate-500">
                        {getVendorCoordinates(profile.location)
                          ? 'Lokasi toko tersimpan'
                          : 'Lokasi toko belum diatur'}
                      </div>
                    </div>
                    <button
                      onClick={saveCurrentLocation}
                      disabled={savingLocation}
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-70"
                    >
                      {savingLocation ? 'Memperbarui...' : 'Update Lokasi'}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {profile.is_verified ? 'Terverifikasi' : 'Belum diverifikasi'}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {formatVendorCategoryLabel(profile.category_primary)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {formatVendorServiceRadius(profile.service_radius_km)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {formatMobility(profile.mobility_type)}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-400">Jam</div>
                      <div className="mt-0.5 line-clamp-1 font-medium text-slate-800">
                        {getOperatingHoursText(profile.operating_hours)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-400">Pembayaran</div>
                      <div className="mt-0.5 font-medium text-slate-800">{readyPaymentLabel}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-400">Sinkron</div>
                      <div className="mt-0.5 line-clamp-1 font-medium text-slate-800">
                        {getVendorLocationUpdatedAtLabel(profile.location)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">Promo</div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${hasActivePromo ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {hasActivePromo ? 'Aktif' : 'Kosong'}
                      </span>
                    </div>
                    {hasActivePromo ? (
                      <>
                        <div className="mt-2 line-clamp-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                          {promoText}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Sampai {formatVendorPromoExpiry(profile)}
                        </div>
                      </>
                    ) : (
                      <div className="mt-2 text-sm text-slate-500">Belum ada promo aktif.</div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">Pembayaran</div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {readyPaymentLabel}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {vendorPaymentSummary.map((entry) => (
                        <span
                          key={entry.method}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            entry.ready
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {entry.label}
                        </span>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowPaymentPreview((current) => !current)}
                      className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      {showPaymentPreview ? 'Tutup detail' : 'Detail pembayaran'}
                    </button>

                    <div
                      className={`${showPaymentPreview ? 'grid' : 'hidden'} mt-3 gap-3 md:col-span-2 lg:grid-cols-3`}
                    >
                      <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          QRIS
                        </div>
                        {qrisPaymentDetails.ready ? (
                          <div className="mt-3 space-y-3">
                            <img
                              src={qrisPaymentDetails.imageUrl}
                              alt="QRIS toko"
                              className="h-40 w-full rounded-2xl border border-slate-200 bg-white object-contain p-2"
                            />
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-slate-500">Belum ada foto QRIS.</div>
                        )}
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          Transfer Bank
                        </div>
                        {bankPaymentDetails.ready ? (
                          <div className="mt-3 space-y-2 text-sm text-slate-600">
                            {bankPaymentDetails.rows.map((row) => (
                              <div key={row.label}>
                                <div className="text-xs uppercase tracking-[0.12em] text-slate-400">
                                  {row.label}
                                </div>
                                <div className="mt-1 font-medium text-slate-900">{row.value}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-slate-500">
                            Belum ada rekening bank.
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          E-Wallet
                        </div>
                        {ewalletPaymentDetails.ready ? (
                          <div className="mt-3 space-y-2 text-sm text-slate-600">
                            {ewalletPaymentDetails.rows.map((row) => (
                              <div key={row.label}>
                                <div className="text-xs uppercase tracking-[0.12em] text-slate-400">
                                  {row.label}
                                </div>
                                <div className="mt-1 font-medium text-slate-900">{row.value}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-slate-500">
                            Belum ada nomor e-wallet.
                          </div>
                        )}
                      </div>
                    </div>

                    {vendorPaymentDetails.payment_notes && (
                      <div
                        className={`${showPaymentPreview ? 'block' : 'hidden'} mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600`}
                      >
                        Catatan pembayaran: {vendorPaymentDetails.payment_notes}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <fieldset disabled={saving} className="min-w-0 space-y-3">
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={form.name}
              aria-label="Nama profil"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nama toko atau nama pengguna"
            />

            {role === 'vendor' && (
              <>
                <textarea
                  className="min-h-[120px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={form.description}
                  aria-label="Deskripsi toko"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Deskripsi singkat toko"
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    value={form.category_primary}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, category_primary: event.target.value }))
                    }
                    aria-label="Kategori dagangan"
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
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    value={form.service_radius_km}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, service_radius_km: event.target.value }))
                    }
                    placeholder="Radius layanan (km)"
                  />
                </div>

                <label className="block text-sm text-slate-600">
                  Cara berkeliling
                  <select
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3"
                    value={form.mobility_type}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, mobility_type: event.target.value }))
                    }
                  >
                    <option value="">Belum diisi</option>
                    {MOBILITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    ['service_area', 'Area berjualan', 240],
                    ['route_description', 'Rute biasa (deskriptif)', 500],
                    ['stopping_points', 'Titik berhenti untuk pengambilan', 500],
                  ] as const
                ).map(([field, label, maxLength]) => (
                  <label key={field} className="block text-sm text-slate-600">
                    {label}
                    <input
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3"
                      maxLength={maxLength}
                      value={form[field] || ''}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [field]: event.target.value }))
                      }
                    />
                  </label>
                ))}
                <p className="text-xs text-slate-500">
                  Pelanggan mengusulkan titik sesuai rute Anda. Anda tidak wajib mengantar.
                </p>

                <textarea
                  className="min-h-[96px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={form.operating_hours_text}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, operating_hours_text: event.target.value }))
                  }
                  placeholder="Contoh: Senin-Sabtu 07.00-12.00, Minggu libur"
                />

                <div className="rounded-[24px] border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Promo Ringan</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowVendorPromoEditor((current) => !current)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:hidden"
                    >
                      {showVendorPromoEditor ? 'Tutup' : 'Buka'}
                    </button>
                  </div>

                  <div
                    className={`${showVendorPromoEditor ? 'mt-4 block' : 'hidden'} space-y-3 sm:mt-4 sm:block`}
                  >
                    <textarea
                      className="min-h-[96px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                      value={form.promo_text}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, promo_text: event.target.value }))
                      }
                      placeholder="Contoh: Gratis sambal dan bawang goreng untuk pembelian hari ini"
                    />
                    <input
                      type="datetime-local"
                      aria-label="Akhir promo"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                      value={form.promo_expires_at}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, promo_expires_at: event.target.value }))
                      }
                    />
                    <div className="text-xs text-slate-500">
                      Kosongkan tanggal berakhir jika promo ingin tetap aktif sampai Anda menghapus
                      teks promosinya.
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Pembayaran Non-Tunai
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowVendorPaymentEditor((current) => !current)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:hidden"
                    >
                      {showVendorPaymentEditor ? 'Tutup' : 'Buka'}
                    </button>
                  </div>

                  <div
                    className={`${showVendorPaymentEditor ? 'mt-4 block' : 'hidden'} space-y-4 sm:mt-4 sm:block`}
                  >
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Foto QRIS</label>
                      {form.payment_qris_image_url && (
                        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
                          <img
                            src={form.payment_qris_image_url}
                            alt="QRIS toko"
                            className="h-52 w-full rounded-xl object-contain"
                          />
                        </div>
                      )}
                      {paymentQrFile && (
                        <div className="mt-2 text-xs text-slate-500">
                          File dipilih: {paymentQrFile.name}
                        </div>
                      )}
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(event) => setPaymentQrFile(event.target.files?.[0] || null)}
                        />
                        {form.payment_qris_image_url && (
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentQrFile(null)
                              setForm((current) => ({ ...current, payment_qris_image_url: '' }))
                            }}
                            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                          >
                            Hapus QRIS
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        value={form.payment_bank_name}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            payment_bank_name: event.target.value,
                          }))
                        }
                        placeholder="Nama bank, misalnya BCA atau BRI"
                      />
                      <input
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        value={form.payment_bank_account_name}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            payment_bank_account_name: event.target.value,
                          }))
                        }
                        placeholder="Nama pemilik rekening"
                      />
                    </div>

                    <input
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                      value={form.payment_bank_account_number}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          payment_bank_account_number: event.target.value,
                        }))
                      }
                      placeholder="Nomor rekening transfer"
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        value={form.payment_ewallet_name}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            payment_ewallet_name: event.target.value,
                          }))
                        }
                        placeholder="Nama e-wallet, misalnya DANA, OVO, GoPay"
                      />
                      <input
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        value={form.payment_ewallet_number}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            payment_ewallet_number: event.target.value,
                          }))
                        }
                        placeholder="Nomor e-wallet"
                      />
                    </div>

                    <textarea
                      className="min-h-[96px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                      value={form.payment_notes}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, payment_notes: event.target.value }))
                      }
                      placeholder="Catatan opsional, misalnya: kirim bukti bayar lewat chat setelah transfer"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700">Foto profil</label>
              <input
                type="file"
                accept="image/*"
                className="mt-2"
                onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                disabled={saving}
                onClick={saveProfile}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-400"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button
                onClick={() => {
                  setShowPaymentPreview(false)
                  setShowVendorPromoEditor(false)
                  setShowVendorPaymentEditor(false)
                  setDraft(null)
                  setPhotoFile(null)
                  setPaymentQrFile(null)
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
              >
                Batal
              </button>
            </div>
          </fieldset>
        )}
      </div>
    </div>
  )
}
