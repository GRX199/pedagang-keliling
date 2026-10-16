import { useOnlineStatus } from '../hooks/useOnlineStatus'
import type { SyncConnection } from '../hooks/useRealtimeQuerySync'

export function syncStatusLabel(
  online: boolean,
  failed: boolean,
  updatedAt: number,
  connection?: SyncConnection,
  catchingUp = false
) {
  if (!online) return 'Offline · data terakhir'
  if (failed) return 'Pembaruan tertunda'
  if (catchingUp) return 'Memulihkan pesan...'
  if (!updatedAt) return 'Menunggu data'
  if (connection === 'polling') return 'Sinkronisasi berkala'
  if (connection === 'connecting') return 'Menghubungkan...'
  return `Diperbarui ${new Date(updatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
}

export function SyncStatus({
  failed = false,
  updatedAt,
  connection,
  catchingUp = false
}: {
  failed?: boolean
  updatedAt: number
  connection?: SyncConnection
  catchingUp?: boolean
}) {
  const online = useOnlineStatus()
  const warning = !online || failed || connection === 'polling'
  return (
    <span
      role="status"
      className={`text-xs ${warning ? 'text-amber-800' : 'text-slate-500'}`}
    >
      {syncStatusLabel(online, failed, updatedAt, connection, catchingUp)}
    </span>
  )
}

export function ConnectionNotice() {
  const online = useOnlineStatus()
  return online ? null : (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-900"
    >
      Tidak ada koneksi. Data terakhir tetap terlihat; transaksi tidak dikirim
      otomatis.
    </div>
  )
}
