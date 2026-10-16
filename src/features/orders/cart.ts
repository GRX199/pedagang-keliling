import type { Product } from '../../types/domain.types'

export type Cart = Record<string, { quantity: number; note: string }>
export type CartEntry = { product: Product; quantity: number; note: string }
export function getManagedStockNumber(product: Product) {
  if (product.stock === null) return null
  return Math.max(0, product.stock - product.reserved_stock)
}
export function isProductOrderable(product: Product) {
  const stock = getManagedStockNumber(product)
  return product.price !== null && product.is_available && (stock === null || stock > 0)
}
export function getProductStockLabel(product: Product) {
  const stock = getManagedStockNumber(product)
  return stock === null ? 'Stok fleksibel' : stock <= 0 ? 'Stok habis' : `Stok ${stock}`
}
export function getCartEntries(cart: Cart, products: Product[]): CartEntry[] {
  return products.flatMap((product) => {
    const entry = cart[product.id]
    if (!entry?.quantity || !Number.isFinite(entry.quantity) || !isProductOrderable(product))
      return []
    const quantity = Math.min(
      Math.max(0, Math.floor(entry.quantity)),
      getManagedStockNumber(product) ?? Infinity
    )
    return quantity > 0 ? [{ product, quantity, note: entry.note.trim() }] : []
  })
}
export function getCartTotals(entries: CartEntry[]) {
  return entries.reduce(
    (summary, entry) => ({
      items: summary.items + entry.quantity,
      types: summary.types + 1,
      estimatedTotal: summary.estimatedTotal + entry.quantity * (entry.product.price ?? 0),
    }),
    { items: 0, types: 0, estimatedTotal: 0 }
  )
}
