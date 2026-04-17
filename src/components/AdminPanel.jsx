import React, { useEffect, useMemo, useState } from 'react'
import { useToast } from './ToastProvider'
import { supabase } from '../lib/supabase'
import {
  formatVendorCategoryLabel,
  formatVendorServiceMode,
  formatVendorServiceRadius,
  getOperatingHoursText,
} from '../lib/vendor'

function getAccountStatusLabel(value) {
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

function getAccountStatusTone(value) {
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

function getCompatibilityMessage(error, fallback) {
  const message = String(error?.message || '')
  if (message.toLowerCase().includes('account_status') || message.toLowerCase().includes('admin_actions')) {
    return 'Database admin belum lengkap. Jalankan supabase/admin-foundation.sql lalu coba lagi.'
  }
  return message || fallback
}

function SummaryCard({ label, value, hint, tone = 'default' }) {
  const toneClass = tone === 'primary'
    ? 'bg-slate-900 text-white'
    : tone === 'warning'
      ? 'bg-amber-50 text-slate-900 ring-1 ring-amber-100'
      : 'bg-white text-slate-900 ring-1 ring-slate-200'

  const hintClass = tone === 'primary' ? 'text-slate-300' : 'text-slate-500'

  return (
    <div className={`rounded-[24px] p-4 ${toneClass}`}>
      <div className="text-xs font-medium uppercase tracking-[0.16em] opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className={`mt-1 text-sm ${hintClass}`}>{hint}</div>
    </div>
  )
}

export default function AdminPanel({ currentUser }) {
  const toast = useToast()
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [savingKey, setSavingKey] = useState(null)

  async function fetchAdminVendors({ background = false, silent = false } = {}) {
    if (!currentUser?.id) return

    if (background) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    try {
      const { data: vendorRows, error: vendorError } = await supabase
        .from('vendors')
        .select('id, name, description, photo_url, online, is_verified, category_primary, service_radius_km, service_mode, operating_hours, updated_at')
        .order('updated_at', { ascending: false })

      if (vendorError) throw vendorError

      const vendorIds = (vendorRows || []).map((vendor) => vendor.id).filter(Boolean)
      let profileRows = []

      if (vendorIds.length > 0) {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('id, display_name, role, account_status, updated_at')
            .in('id', vendorIds)

          if (error) throw error
          profileRows = data || []
        } catch (profileError) {
          const message = String(profileError?.message || '').toLowerCase()
          if (!message.includes('account_status')) throw profileError

          const { data, error } = await supabase
            .from('profiles')
            .select('id, display_name, role, updated_at')
            .in('id', vendorIds)

          if (error) throw error
          profileRows = (data || []).map((profile) => ({
            ...profile,
            account_status: 'active',
          }))
        }
      }

      const profileMap = Object.fromEntries((profileRows || []).map((profile) => [profile.id, profile]))
      setVendors((vendorRows || []).map((vendor) => ({
        ...vendor,
        profile: profileMap[vendor.id] || null,
        account_status: profileMap[vendor.id]?.account_status || 'active',
      })))
    } catch (error) {
      console.error('fetchAdminVendors', error)
      if (!silent) {
        toast.push(getCompatibilityMessage(error, 'Gagal memuat panel admin'), { type: 'error' })
      }
    } finally {
      if (background) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }

  async function logAdminAction(targetUserId, actionType, note) {
    if (!currentUser?.id || !targetUserId) return

    try {
      const { error } = await supabase
        .from('admin_actions')
        .insert([{
          admin_id: currentUser.id,
          target_user_id: targetUserId,
          action_type: actionType,
          entity_type: 'vendor',
          entity_id: targetUserId,
          note,
        }])

      if (error) throw error
    } catch (error) {
      console.warn('logAdminAction', error)
    }
  }

  async function updateVerification(vendor, nextVerified) {
    const actionKey = `verify:${vendor.id}`
    setSavingKey(actionKey)

    try {
      const { error } = await supabase
        .from('vendors')
        .update({ is_verified: nextVerified })
        .eq('id', vendor.id)

      if (error) throw error

      await logAdminAction(
        vendor.id,
        nextVerified ? 'verify_vendor' : 'remove_vendor_verification',
        nextVerified ? 'Vendor diverifikasi oleh admin.' : 'Status verifikasi vendor dicabut oleh admin.'
      )

      toast.push(nextVerified ? 'Pedagang berhasil diverifikasi' : 'Status verifikasi pedagang diperbarui', { type: 'success' })
      void fetchAdminVendors({ background: true, silent: true })
    } catch (error) {
      console.error('updateVerification', error)
      toast.push(getCompatibilityMessage(error, 'Gagal memperbarui status verifikasi'), { type: 'error' })
    } finally {
      setSavingKey(null)
    }
  }

  async function updateAccountStatus(vendor, nextStatus) {
    const actionKey = `status:${vendor.id}:${nextStatus}`
    setSavingKey(actionKey)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ account_status: nextStatus })
        .eq('id', vendor.id)

      if (error) throw error

      if (nextStatus !== 'active') {
        const { error: vendorError } = await supabase
          .from('vendors')
          .update({ online: false })
          .eq('id', vendor.id)

        if (vendorError) throw vendorError
      }

      await logAdminAction(
        vendor.id,
        `account_${nextStatus}`,
        `Status akun vendor diubah menjadi ${nextStatus} oleh admin.`
      )

      toast.push(`Status akun pedagang diubah menjadi ${getAccountStatusLabel(nextStatus)}`, { type: 'success' })
      void fetchAdminVendors({ background: true, silent: true })
    } catch (error) {
      console.error('updateAccountStatus', error)
      toast.push(getCompatibilityMessage(error, 'Gagal memperbarui status akun'), { type: 'error' })
    } finally {
      setSavingKey(null)
    }
  }

  useEffect(() => {
    if (!currentUser?.id) return undefined

    void fetchAdminVendors()

    const vendorsChannel = supabase
      .channel(`admin-vendors-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors' }, () => {
        void fetchAdminVendors({ background: true, silent: true })
      })
      .subscribe()

    const profilesChannel = supabase
      .channel(`admin-profiles-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        void fetchAdminVendors({ background: true, silent: true })
      })
      .subscribe()

    const intervalId = window.setInterval(() => {
      void fetchAdminVendors({ background: true, silent: true })
    }, 10000)

    return () => {
      window.clearInterval(intervalId)
      try {
        supabase.removeChannel(vendorsChannel)
        supabase.removeChannel(profilesChannel)
      } catch (error) {
        console.error('removeAdminChannels', error)
      }
    }
  }, [currentUser?.id])

  const filteredVendors = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return vendors.filter((vendor) => {
      const haystack = `${vendor.name || ''} ${vendor.description || ''} ${vendor.category_primary || ''} ${vendor.profile?.display_name || ''}`.toLowerCase()
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

  const pendingVerificationCount = vendors.filter((vendor) => !vendor.is_verified).length
  const suspendedCount = vendors.filter((vendor) => vendor.account_status === 'suspended').length
  const blockedCount = vendors.filter((vendor) => vendor.account_status === 'blocked').length

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Admin Foundation</div>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Verifikasi pedagang dan moderasi dasar</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Panel ini sengaja dibuat ringan: fokus ke vendor yang perlu diverifikasi, ditangguhkan, atau diblokir lebih dulu.
              Analytics dan laporan lanjutan bisa menyusul setelah fondasi operasional ini stabil.
            </p>
          </div>

          <div className="text-xs text-slate-400">
            {refreshing ? 'Menyegarkan data admin...' : 'Update berjalan di background'}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <SummaryCard
            label="Total Pedagang"
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

      <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Cari pedagang</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nama toko, kategori, atau deskripsi"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                filter === 'all' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              Semua
            </button>
            <button
              onClick={() => setFilter('verification')}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                filter === 'verification' ? 'bg-amber-500 text-white' : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              Perlu verifikasi
            </button>
            <button
              onClick={() => setFilter('suspended')}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                filter === 'suspended' ? 'bg-amber-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              Ditangguhkan
            </button>
            <button
              onClick={() => setFilter('blocked')}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                filter === 'blocked' ? 'bg-rose-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              Diblokir
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {filteredVendors.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Tidak ada pedagang yang cocok dengan filter admin saat ini.
            </div>
          ) : (
            filteredVendors.map((vendor) => {
              const verificationActionKey = `verify:${vendor.id}`
              const activeStatusActionKey = `status:${vendor.id}:active`
              const suspendedStatusActionKey = `status:${vendor.id}:suspended`
              const blockedStatusActionKey = `status:${vendor.id}:blocked`

              return (
                <div key={vendor.id} className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold text-slate-900">{vendor.name || vendor.profile?.display_name || 'Pedagang'}</div>
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${vendor.is_verified ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'}`}>
                          {vendor.is_verified ? 'Terverifikasi' : 'Belum diverifikasi'}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${getAccountStatusTone(vendor.account_status)}`}>
                          {getAccountStatusLabel(vendor.account_status)}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${vendor.online ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-100' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}`}>
                          {vendor.online ? 'Sedang online' : 'Sedang offline'}
                        </span>
                      </div>

                      <div className="mt-2 text-sm leading-6 text-slate-600">
                        {vendor.description || 'Belum ada deskripsi toko.'}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                          {formatVendorCategoryLabel(vendor.category_primary)}
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                          {formatVendorServiceMode(vendor.service_mode)}
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                          {formatVendorServiceRadius(vendor.service_radius_km)}
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                          {getOperatingHoursText(vendor.operating_hours)}
                        </span>
                      </div>

                      <div className="mt-3 text-xs text-slate-400">
                        Update terakhir: {vendor.updated_at ? new Date(vendor.updated_at).toLocaleString('id-ID') : '-'}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 xl:w-[260px]">
                      <button
                        onClick={() => updateVerification(vendor, !vendor.is_verified)}
                        disabled={savingKey === verificationActionKey}
                        className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                          vendor.is_verified
                            ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                      >
                        {savingKey === verificationActionKey
                          ? 'Menyimpan...'
                          : vendor.is_verified ? 'Cabut Verifikasi' : 'Verifikasi Pedagang'}
                      </button>

                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => updateAccountStatus(vendor, 'active')}
                          disabled={savingKey === activeStatusActionKey}
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          {savingKey === activeStatusActionKey ? '...' : 'Aktifkan'}
                        </button>
                        <button
                          onClick={() => updateAccountStatus(vendor, 'suspended')}
                          disabled={savingKey === suspendedStatusActionKey}
                          className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
                        >
                          {savingKey === suspendedStatusActionKey ? '...' : 'Suspend'}
                        </button>
                        <button
                          onClick={() => updateAccountStatus(vendor, 'blocked')}
                          disabled={savingKey === blockedStatusActionKey}
                          className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
                        >
                          {savingKey === blockedStatusActionKey ? '...' : 'Blokir'}
                        </button>
                      </div>
                    </div>
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
