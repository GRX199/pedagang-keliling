import type { AccountStatus, Vendor } from '../../types/domain.types'

type Props = {
  vendor: Pick<Vendor, 'id' | 'is_verified'>
  disabled: boolean
  savingKey: string | null
  onVerification: (value: boolean) => void
  onStatus: (value: AccountStatus) => void
}
export default function VendorVerification({
  vendor,
  disabled,
  savingKey,
  onVerification,
  onStatus,
}: Props) {
  const verificationActionKey = 'verify:' + vendor.id
  const activeStatusActionKey = 'status:' + vendor.id + ':active'
  const suspendedStatusActionKey = 'status:' + vendor.id + ':suspended'
  const blockedStatusActionKey = 'status:' + vendor.id + ':blocked'
  return (
    <div className="grid min-w-0 gap-2 xl:w-[260px]">
      <button
        onClick={() => onVerification(!vendor.is_verified)}
        disabled={disabled}
        className={`min-w-0 whitespace-normal rounded-2xl px-4 py-3 text-sm font-medium leading-tight transition ${
          vendor.is_verified
            ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            : 'bg-emerald-600 text-white hover:bg-emerald-700'
        }`}
      >
        {savingKey === verificationActionKey
          ? 'Menyimpan...'
          : vendor.is_verified
            ? 'Cabut Verifikasi'
            : 'Verifikasi'}
      </button>

      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => onStatus('active')}
          disabled={disabled}
          className="min-w-0 whitespace-normal rounded-2xl border border-slate-200 bg-white px-2 py-3 text-xs font-medium leading-tight text-slate-700 transition hover:bg-slate-50 sm:px-3"
        >
          {savingKey === activeStatusActionKey ? '...' : 'Aktifkan'}
        </button>
        <button
          onClick={() => onStatus('suspended')}
          disabled={disabled}
          className="min-w-0 whitespace-normal rounded-2xl border border-amber-200 bg-amber-50 px-2 py-3 text-xs font-medium leading-tight text-amber-700 transition hover:bg-amber-100 sm:px-3"
        >
          {savingKey === suspendedStatusActionKey ? '...' : 'Suspend'}
        </button>
        <button
          onClick={() => onStatus('blocked')}
          disabled={disabled}
          className="min-w-0 whitespace-normal rounded-2xl border border-rose-200 bg-rose-50 px-2 py-3 text-xs font-medium leading-tight text-rose-700 transition hover:bg-rose-100 sm:px-3"
        >
          {savingKey === blockedStatusActionKey ? '...' : 'Blokir'}
        </button>
      </div>
    </div>
  )
}
