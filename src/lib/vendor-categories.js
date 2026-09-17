// Operational merchandise groups from the revised proposal, separate from mobility.
export const VENDOR_CATEGORIES = [
  { id: 'food', label: 'Makanan siap santap', color: '#c2410c', path: '<path d="M3 11h18c0 6-4 9-9 9s-9-3-9-9ZM6 6v2m6-5v5m6-2v2M7 22h10"/>' },
  { id: 'drinks', label: 'Minuman', color: '#0369a1', path: '<path d="M5 8h12v7a6 6 0 0 1-12 0V8Zm12 1h2a3 3 0 0 1 0 6h-2M8 3v2m5-2v2M4 22h15"/>' },
  { id: 'snacks', label: 'Roti / jajanan', color: '#a16207', path: '<path d="M5 11a5 5 0 0 1 1-9h12a5 5 0 0 1 1 9v10H5V11Z"/><path d="m9 7 2 3m3-3 2 3"/>' },
  { id: 'groceries', label: 'Sayur / kebutuhan dapur', color: '#047857', path: '<path d="M19 3C8 2 3 8 6 14s14 4 13-11ZM5 21 16 7m-5 7 6 1"/>' },
  { id: 'other', label: 'Lainnya', color: '#475569', path: '<path d="M4 8h16l-1 13H5L4 8Zm4 0V6a4 4 0 0 1 8 0v2"/>' },
]

export function getVendorCategoryDefinition(value) {
  const name = String(value || '').trim().toLowerCase()
  const exact = VENDOR_CATEGORIES.find(category => category.id === name || category.label.toLowerCase() === name)
  if (exact) return exact
  const aliases = [
    ['groceries', /\b(sayur|buah|gas|sembako|dapur|ikan|telur)\b/],
    ['drinks', /\b(minuman|kopi|teh|jus|es|dawet|cendol)\b/],
    ['snacks', /\b(roti|jajanan|jajan|kue|gorengan|cilok|cimol|pentol)\b/],
    ['food', /\b(makanan|bakso|mie|mi|soto|sate|bubur|nasi|siomay|batagor)\b/],
  ]
  const id = aliases.find(([, pattern]) => pattern.test(name))?.[0] || 'other'
  return VENDOR_CATEGORIES.find(category => category.id === id)
}

export function getVendorMarkerOptions(value) {
  const category = getVendorCategoryDefinition(value)
  // Only fixed catalogue strings enter HTML; vendor names never do.
  return {
    className: 'vendor-category-marker',
    iconSize: [44, 52], iconAnchor: [22, 50], popupAnchor: [0, -47],
    html: `<div style="position:relative;width:44px;height:52px;filter:drop-shadow(0 3px 4px #0f172a55)"><svg aria-hidden="true" viewBox="0 0 44 52" width="44" height="52"><path d="M22 50C17 43 2 32 2 22a20 20 0 0 1 40 0c0 10-15 21-20 28Z" fill="${category.color}" stroke="white" stroke-width="3"/><svg x="10" y="9" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${category.path}</svg></svg></div>`,
  }
}
