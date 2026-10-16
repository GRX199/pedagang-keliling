import { useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AccountStatus } from '../../types/domain.types'
import { errorMessage } from '../../shared/lib/utils'
import { useAdminVendors } from './useAdminVendors'
import VendorVerification from './VendorVerification'
import { useToast } from '../../shared/components/ToastProvider'
import { useAdminVendorMutation } from './useAdminVendorMutation'
import type { AdminVendorAction } from './admin-api'
import {
  formatVendorCategoryLabel,
  formatVendorServiceMode,
  formatVendorServiceRadius,
  getOperatingHoursText,
} from '../../lib/vendor'

function getAccountStatusLabel(value: string) {
  switch (value) {
    case 'suspended':
      return 'Ditangguhkan'
    case 'blocked':
      return 'Diblokir'
    case 'active':
    default:
      return 'Aktif'
  }
}

function getAccountStatusTone(value: string) {
  switch (value) {
    case 'suspended':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
    case 'blocked':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
    case 'active':
    default:
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
  }
}

function getCompatibilityMessage(error: unknown, fallback: string) {
  const message = errorMessage(error, '')
  if (
    message.toLowerCase().includes('account_status') ||
    message.toLowerCase().includes('admin_actions')
  ) {
    return 'Database admin belum lengkap. Jalankan supabase/admin-foundation.sql lalu coba lagi.'
  }
  return message || fallback
}

function SummaryCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: number
  hint: string
  tone?: 'default' | 'primary' | 'warning'
}) {
  const toneClass =
    tone === 'primary'
      ? 'bg-slate-900 text-white'
      : tone === 'warning'
        ? 'bg-amber-50 text-slate-900 ring-1 ring-amber-100'
        : 'bg-white text-slate-900 ring-1 ring-slate-200'

  const hintClass = tone === 'primary' ? 'text-slate-300' : 'text-slate-500'

  return (
    <div
      className={`min-w-0 rounded-[18px] p-3 sm:rounded-[24px] sm:p-4 ${toneClass}`}
    >
      <div className="break-words text-xs font-medium uppercase tracking-[0.12em] opacity-80 sm:tracking-[0.16em]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold sm:mt-2 sm:text-3xl">
        {value}
      </div>
      <div className={`mt-1 hidden text-sm sm:block ${hintClass}`}>{hint}</div>
    </div>
  )
}

const EMPTY_VENDORS: NonNullable<ReturnType<typeof useAdminVendors>['data']> =
  []

export default function AdminPanel({ currentUser }: { currentUser: User }) {
  const toast = useToast()
  const adminQuery = useAdminVendors()
  const vendors = adminQuery.data || EMPTY_VENDORS
  const loading = adminQuery.isPending
  const refreshing = adminQuery.isFetching && !loading
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const mutation = useAdminVendorMutation(currentUser.id)
  const savingKey =
    mutation.isPending && mutation.variables
      ? mutation.variables.kind === 'verification'
        ? 'verify:' + mutation.variables.id
        : 'status:' + mutation.variables.id + ':' + mutation.variables.value
      : null

  async function run(action: AdminVendorAction, message: string) {
    try {
      const result = await mutation.execute(action)
      if (!result) return
      toast.push(
        result.auditRecorded
          ? message
          : message + '. Pencatatan audit belum berhasil; periksa koneksi.',
        { type: result.auditRecorded ? 'success' : 'warning' },
      )
    } catch (error) {
      toast.push(getCompatibilityMessage(error, 'Perubahan belum tersimpan.'), {
        type: 'error',
      })
    }
  }
  function updateVerification(
    vendor: (typeof vendors)[number],
    value: boolean,
  ) {
    return run(
      {
        kind: 'verification',
        id: vendor.id,
        expected: vendor.is_verified,
        value,
      },
      value
        ? 'Pedagang berhasil diverifikasi'
        : 'Status verifikasi pedagang diperbarui',
    )
  }
  function updateAccountStatus(
    vendor: (typeof vendors)[number],
    value: AccountStatus,
  ) {
    return run(
      {
        kind: 'account',
        id: vendor.id,
        expected: vendor.account_status,
        value,
      },
      'Status akun pedagang diubah menjadi ' + getAccountStatusLabel(value),
    )
  }

  const filteredVendors = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return vendors.filter((vendor) => {
      const haystack =
        `${vendor.name || ''} ${vendor.description || ''} ${vendor.category_primary || ''} ${vendor.profile?.display_name || ''}`.toLowerCase()
      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false

      if (filter === 'verification') return !vendor.is_verified
      if (filter === 'suspended') return vendor.account_status === 'suspended'
      if (filter === 'blocked') return vendor.account_status === 'blocked'
      if (filter === 'verified') return vendor.is_verified

      return true
    })
  }, [filter, query, vendors])

  if (loading) {
    return (
      <div className="rounded-[28px] bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/80">
        Memuat panel admin...
      </div>
    )
  }

  const pendingVerificationCount = vendors.filter(
    (vendor) => !vendor.is_verified,
  ).length
  const suspendedCount = vendors.filter(
    (vendor) => vendor.account_status === 'suspended',
  ).length
  const blockedCount = vendors.filter(
    (vendor) => vendor.account_status === 'blocked',
  ).length

  return (
    <div className="min-w-0 space-y-3 sm:space-y-4">
      {adminQuery.error ? (
        <p role="alert" className="text-sm text-amber-800">
          {getCompatibilityMessage(adminQuery.error, 'Panel belum termuat.')}{' '}
          <button
            type="button"
            onClick={() => {
              void adminQuery.refetch()
            }}
          >
            Coba lagi
          </button>
        </p>
      ) : null}
      <section className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500 sm:tracking-[0.18em]">
              Admin
            </div>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Verifikasi Pedagang
            </h3>
          </div>

          <div className="text-xs text-slate-400 sm:text-right">
            {refreshing ? 'Memperbarui...' : 'Realtime aktif'}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 md:grid-cols-4">
          <SummaryCard
            label="Total"
            value={vendors.length}
            hint="Semua vendor yang terdaftar di sistem."
            tone="primary"
          />
          <SummaryCard
            label="Perlu Verifikasi"
            value={pendingVerificationCount}
            hint="Pedagang yang belum diberi status terverifikasi."
            tone="warning"
          />
          <SummaryCard
            label="Ditangguhkan"
            value={suspendedCount}
            hint="Akun yang perlu ditinjau lagi sebelum aktif."
          />
          <SummaryCard
            label="Diblokir"
            value={blockedCount}
            hint="Akun bermasalah yang ditahan oleh admin."
          />
        </div>
      </section>

      <section className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              Cari
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nama toko atau kategori"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
            />
          </label>

          <div className="flex min-w-0 flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`rounded-full px-3 py-2 text-sm font-medium transition sm:px-4 ${
                filter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              Semua
            </button>
            <button
              onClick={() => setFilter('verification')}
              className={`rounded-full px-3 py-2 text-sm font-medium transition sm:px-4 ${
                filter === 'verification'
                  ? 'bg-amber-500 text-white'
                  : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              Verifikasi
            </button>
            <button
              onClick={() => setFilter('suspended')}
              className={`rounded-full px-3 py-2 text-sm font-medium transition sm:px-4 ${
                filter === 'suspended'
                  ? 'bg-amber-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              Suspend
            </button>
            <button
              onClick={() => setFilter('blocked')}
              className={`rounded-full px-3 py-2 text-sm font-medium transition sm:px-4 ${
                filter === 'blocked'
                  ? 'bg-rose-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              Diblokir
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {filteredVendors.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Tidak ada pedagang yang cocok.
            </div>
          ) : (
            filteredVendors.map((vendor) => {
              return (
                <div
                  key={vendor.id}
                  className="min-w-0 rounded-[20px] border border-slate-200 bg-slate-50/70 p-3 sm:rounded-[24px] sm:p-4"
                >
                  <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="break-words text-base font-semibold text-slate-900 sm:text-lg">
                          {vendor.name ||
                            vendor.profile?.display_name ||
                            'Pedagang'}
                        </div>
                        <span
                          className={`max-w-full break-words rounded-full px-3 py-1 text-xs font-medium leading-tight ${vendor.is_verified ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'}`}
                        >
                          {vendor.is_verified
                            ? 'Terverifikasi'
                            : 'Belum diverifikasi'}
                        </span>
                        <span
                          className={`max-w-full break-words rounded-full px-3 py-1 text-xs font-medium leading-tight ${getAccountStatusTone(vendor.account_status)}`}
                        >
                          {getAccountStatusLabel(vendor.account_status)}
                        </span>
                        <span
                          className={`max-w-full break-words rounded-full px-3 py-1 text-xs font-medium leading-tight ${vendor.online ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-100' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}`}
                        >
                          {vendor.online ? 'Sedang online' : 'Sedang offline'}
                        </span>
                      </div>

                      <div className="mt-2 line-clamp-1 break-words text-sm leading-6 text-slate-600 sm:line-clamp-2">
                        {vendor.description || 'Belum ada deskripsi toko.'}
                      </div>

                      <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-xs text-slate-500">
                        <span className="max-w-full break-words rounded-full bg-white px-3 py-1 leading-tight ring-1 ring-slate-200">
                          {formatVendorCategoryLabel(vendor.category_primary)}
                        </span>
                        <span className="max-w-full break-words rounded-full bg-white px-3 py-1 leading-tight ring-1 ring-slate-200">
                          {formatVendorServiceMode(vendor.service_mode)}
                        </span>
                        <span className="max-w-full break-words rounded-full bg-white px-3 py-1 leading-tight ring-1 ring-slate-200">
                          {formatVendorServiceRadius(vendor.service_radius_km)}
                        </span>
                        <span className="hidden max-w-full break-words rounded-full bg-white px-3 py-1 leading-tight ring-1 ring-slate-200 sm:inline-flex">
                          {getOperatingHoursText(vendor.operating_hours)}
                        </span>
                      </div>

                      <div className="mt-2 text-xs text-slate-400 sm:mt-3">
                        Update terakhir:{' '}
                        {vendor.updated_at
                          ? new Date(vendor.updated_at).toLocaleString('id-ID')
                          : '-'}
                      </div>
                    </div>

                    <VendorVerification
                      vendor={vendor}
                      savingKey={savingKey}
                      disabled={mutation.isPending || adminQuery.isError}
                      onVerification={(value) =>
                        void updateVerification(vendor, value)
                      }
                      onStatus={(value) =>
                        void updateAccountStatus(vendor, value)
                      }
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
