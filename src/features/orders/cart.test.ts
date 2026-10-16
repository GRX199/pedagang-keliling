import { describe, expect, it } from 'vitest'
import type { Product } from '../../types/domain.types'
import { getCartEntries, getCartTotals, getManagedStockNumber, isProductOrderable } from './cart'

const product: Product = {
  id: 'product',
  vendor_id: 'vendor',
  name: 'Tomat',
  price: 5000,
  stock: 10,
  reserved_stock: 3,
  is_available: true,
  description: null,
  image_url: null,
  category_name: null,
  created_at: '',
  updated_at: '',
}
describe('typed checkout cart', () => {
  it('uses only unreserved stock without changing the product row', () => {
    expect(getManagedStockNumber(product)).toBe(7)
    expect(getCartEntries({ product: { quantity: 9, note: '  Matang  ' } }, [product])).toEqual([
      { product, quantity: 7, note: 'Matang' },
    ])
    expect(product.stock).toBe(10)
    expect(product.reserved_stock).toBe(3)
  })
  it('supports optional unmanaged stock', () => {
    const unlimited = { ...product, stock: null }
    expect(getManagedStockNumber(unlimited)).toBeNull()
    expect(getCartEntries({ product: { quantity: 99, note: '' } }, [unlimited])[0].quantity).toBe(
      99
    )
  })
  it.each([
    { ...product, price: null },
    { ...product, is_available: false },
    { ...product, stock: 3 },
  ])('excludes unorderable products', (row) => {
    expect(isProductOrderable(row)).toBe(false)
    expect(getCartEntries({ product: { quantity: 1, note: '' } }, [row])).toEqual([])
  })
  it.each([NaN, Infinity, -1, 0])('excludes invalid quantity: %s', (quantity) => {
    expect(getCartEntries({ product: { quantity, note: '' } }, [product])).toEqual([])
  })
  it('calculates totals from integer quantities and actual catalog prices', () => {
    expect(
      getCartTotals(getCartEntries({ product: { quantity: 2.8, note: '' } }, [product]))
    ).toEqual({ items: 2, types: 1, estimatedTotal: 10000 })
  })
})
