import type { Tables } from '../../types/database.types'
import type { Role } from '../../types/domain.types'

export type Notification = Tables<'notifications'>
export type NotificationRoute = {
  pathname: string
  search: string
  role: Role | null
  activeChatId?: string | null
}
export const notificationBucket = (row: Pick<Notification, 'type'>) =>
  row.type === 'message_received' ? 'messages' : 'orders'

export function isNotificationVisible(
  row: Notification,
  route: NotificationRoute,
): boolean {
  const tab = new URLSearchParams(route.search).get('tab')
  const bucket = notificationBucket(row)
  if (bucket === 'messages') {
    return (
      row.entity_type === 'chat' &&
      row.entity_id === route.activeChatId &&
      (route.pathname === '/chat' ||
        route.pathname.startsWith('/chat/') ||
        (route.pathname === '/dashboard' && tab === 'chats'))
    )
  }
  if (route.pathname === '/dashboard') {
    return tab === 'orders' || (!tab && route.role === 'customer')
  }
  return (
    row.entity_type === 'order' && route.pathname === `/orders/${row.entity_id}`
  )
}

export function mergeNotificationRows(
  current: Notification[],
  incoming: Notification[],
): Notification[] {
  const rows = new Map(current.map((row) => [row.id, row]))
  for (const row of incoming) {
    const previous = rows.get(row.id)
    const version = Date.parse(row.updated_at)
    const previousVersion = previous ? Date.parse(previous.updated_at) : -Infinity
    if (!previous || version > previousVersion || (version === previousVersion && (!previous.is_read || row.is_read)))
      rows.set(row.id, row)
  }
  return [...rows.values()].sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id),
  )
}

// Preserve realtime inserts and optimistic reads that arrived while the HTTP snapshot was in flight.
export function reconcileNotificationSnapshot(
  snapshot: Notification[],
  before: Notification[],
  latest: Notification[],
) {
  const old = new Map(before.map((row) => [row.id, row]))
  return mergeNotificationRows(
    snapshot,
    latest.filter((row) => old.get(row.id) !== row),
  )
}

export function notificationCounts(
  rows: Notification[],
  route: NotificationRoute,
) {
  const counts = { messages: 0, orders: 0 }
  for (const row of rows)
    if (!row.is_read && !isNotificationVisible(row, route))
      counts[notificationBucket(row)]++
  return counts
}
