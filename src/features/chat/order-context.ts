import { getBuyerPaymentActions, isActiveOrderStatus } from '../../lib/orders'
import type { Order } from '../../types/domain.types'

export function pickFeaturedOrder<T extends Pick<Order, 'id' | 'status'>>(
  rows: readonly T[],
  preferredId: string | null = null,
): T | null {
  const active = rows.filter((row) => isActiveOrderStatus(row.status))
  return active.find((row) => row.id === preferredId) || active[0] || null
}

export function shouldShowPaymentProofShortcut(
  order: Partial<Order> | null,
  user: { id: string } | null,
) {
  return (
    !!order &&
    !!user &&
    order.buyer_id === user.id &&
    getBuyerPaymentActions(order).length > 0
  )
}
