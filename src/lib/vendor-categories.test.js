import { describe, expect, it } from 'vitest'
import { VENDOR_CATEGORIES, getVendorCategoryDefinition, getVendorMarkerOptions } from './vendor-categories'

describe('vendor merchandise categories', () => {
  it('keeps the five proposal groups separate from mobility', () => {
    expect(VENDOR_CATEGORIES).toHaveLength(5)
    for (const category of VENDOR_CATEGORIES) expect(getVendorCategoryDefinition(category.label)).toEqual(category)
    expect(getVendorCategoryDefinition('walking').id).toBe('other')
  })
  it.each([['Bakso', 'food'], ['Kopi', 'drinks'], ['Roti', 'snacks'], ['sayur', 'groceries'], ['Gas', 'groceries'], ['', 'other'], ['Tidak dikenal', 'other']])('maps legacy %s without rewriting saved data', (value, id) => {
    expect(getVendorCategoryDefinition(value).id).toBe(id)
  })
  it('uses distinct pictograms and colors with touch-sized markers', () => {
    expect(new Set(VENDOR_CATEGORIES.map(item => item.path)).size).toBe(5)
    expect(new Set(VENDOR_CATEGORIES.map(item => item.color)).size).toBe(5)
    expect(getVendorMarkerOptions('Bakso').iconSize).toEqual([44, 52])
  })
  it('never inserts user supplied markup into marker HTML', () => {
    expect(getVendorMarkerOptions('<img src=x onerror=alert(1)>').html).not.toContain('onerror')
  })
})
