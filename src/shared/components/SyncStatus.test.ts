import { describe, expect, it } from 'vitest'
import { syncStatusLabel } from './SyncStatus'

describe('honest sync status', () => {
  it('prioritizes offline and failed reads over a connected socket', () => {
    expect(syncStatusLabel(false, false, Date.now(), 'connected')).toBe(
      'Offline · data terakhir'
    )
    expect(syncStatusLabel(true, true, Date.now(), 'connected')).toBe(
      'Pembaruan tertunda'
    )
  })
  it('never calls an uninitialized or failed subscription realtime', () => {
    expect(syncStatusLabel(true, false, 0, 'connected')).toBe('Menunggu data')
    expect(syncStatusLabel(true, false, Date.now(), 'polling')).toBe(
      'Sinkronisasi berkala'
    )
    expect(syncStatusLabel(true, false, Date.now(), 'connecting')).toBe(
      'Menghubungkan...'
    )
    expect(syncStatusLabel(true, false, Date.now(), 'connected')).toMatch(
      /^Diperbarui /
    )
  })
  it('distinguishes catch-up from a fully updated conversation', () => {
    expect(syncStatusLabel(true, false, Date.now(), 'connected', true)).toBe(
      'Memulihkan pesan...'
    )
    expect(syncStatusLabel(false, false, Date.now(), 'connected', true)).toBe(
      'Offline · data terakhir'
    )
    expect(syncStatusLabel(true, true, Date.now(), 'connected', true)).toBe(
      'Pembaruan tertunda'
    )
  })
})
