import { describe, expect, it } from 'vitest'
import {
  isNotificationVisible,
  mergeNotificationRows,
  notificationCounts,
  reconcileNotificationSnapshot,
  type Notification,
} from './notification-model'

const row = (id: string, patch: Partial<Notification> = {}): Notification => ({
  id,
  user_id: 'buyer',
  type: 'message_received',
  title: 'Pesan baru',
  body: 'Ani: Halo',
  entity_type: 'chat',
  entity_id: 'chat',
  is_read: false,
  read_at: null,
  created_at: '2026-10-16T08:00:00Z',
  updated_at: '2026-10-16T08:00:00Z',
  ...patch,
})
describe('notification inbox', () => {
  it('keeps distinct IDs even at the same timestamp', () => {
    expect(
      mergeNotificationRows([row('a')], [row('b'), row('a')]).map(
        (item) => item.id,
      ),
    ).toEqual(['a', 'b'])
  })
  it('does not overwrite a newer read state with an old realtime row', () => {
    const read = row('a', {
      is_read: true,
      updated_at: '2026-10-16T09:00:00Z',
    })
    expect(mergeNotificationRows([read], [row('a')])[0].is_read).toBe(true)
  })
  it('preserves a read flag across equal instants with different timezone formats', () => {
    const read = row('a', { is_read: true })
    const replay = row('a', { updated_at: '2026-10-16T09:00:00+01:00' })
    expect(mergeNotificationRows([read], [replay])[0].is_read).toBe(true)
  })
  it('preserves realtime arrivals during a slow initial snapshot', () => {
    expect(
      reconcileNotificationSnapshot([row('old')], [], [row('live')]).map(
        (item) => item.id,
      ),
    ).toEqual(['live', 'old'])
  })
  it('does not resurrect an optimistic read when a late snapshot returns unread', () => {
    const unread = row('a')
    const read = {
      ...unread,
      is_read: true,
      updated_at: '2026-10-16T09:00:00Z',
    }
    expect(
      reconcileNotificationSnapshot([unread], [unread], [read])[0].is_read,
    ).toBe(true)
  })
  it('removes cached notifications already read on another device', () => {
    const cached = row('a')
    expect(reconcileNotificationSnapshot([], [cached], [cached])).toEqual([])
  })
  it('recognizes chat embedded in the dashboard', () => {
    expect(
      isNotificationVisible(row('a'), {
        pathname: '/dashboard',
        search: '?tab=chats',
        role: 'vendor',
        activeChatId: 'chat',
      }),
    ).toBe(true)
  })
  it('does not mark an inbox or another room as read', () => {
    const route = { pathname: '/chat', search: '', role: 'vendor' as const }
    expect(isNotificationVisible(row('a'), route)).toBe(false)
    expect(
      isNotificationVisible(row('a'), { ...route, activeChatId: 'other-chat' }),
    ).toBe(false)
  })
  it('does not hide a different order while tracking one order', () => {
    const order = row('a', {
      type: 'order_ready',
      entity_type: 'order',
      entity_id: 'other',
    })
    const route = {
      pathname: '/orders/current',
      search: '',
      role: 'customer' as const,
    }
    expect(isNotificationVisible(order, route)).toBe(false)
    expect(notificationCounts([order], route)).toEqual({
      messages: 0,
      orders: 1,
    })
  })
  it('excludes read and visible rows from badges', () => {
    expect(
      notificationCounts(
        [
          row('a'),
          row('b', { is_read: true }),
          row('c', { type: 'order_created' }),
        ],
        { pathname: '/chat', search: '', role: 'vendor', activeChatId: 'chat' },
      ),
    ).toEqual({ messages: 0, orders: 1 })
  })
})
