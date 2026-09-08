import React, { useId, useState } from 'react'
import { formatVendorCategoryLabel } from '../lib/vendor'

export default function MapSearchFilters({
  filters, onChange, onReset, categories, customer, favoritesEnabled,
  favoritesCount, totalCount, resultCount, nearbyCount, locationAvailable,
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const extraFilterCount = [filters.rating !== 'all', filters.withinRadius, filters.promo, filters.favorites].filter(Boolean).length
  const hasFilters = Boolean(filters.query.trim()) || filters.category !== 'all' || extraFilterCount > 0

  function toggle(label, name, disabled = false) {
    return (
      <button
        type="button"
        aria-pressed={filters[name]}
        disabled={disabled}
        onClick={() => onChange(name, !filters[name])}
        className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
          filters[name] ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="min-w-0 rounded-[22px] border border-slate-200/80 bg-white p-3 shadow-sm sm:p-4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="relative min-w-0">
          <span className="sr-only">Cari pedagang atau produk</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400">
            <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" />
          </svg>
          <input
            type="search"
            value={filters.query}
            onChange={(event) => onChange('query', event.target.value)}
            placeholder="Cari toko atau produk"
            className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-3 text-base text-slate-900 transition focus:border-teal-600 focus:bg-white sm:text-sm"
          />
        </label>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((current) => !current)}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium ${expanded ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          Filter{extraFilterCount > 0 ? ` (${extraFilterCount})` : ''}
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}><path d="m5 7 5 5 5-5" /></svg>
        </button>
        <label className="col-span-2 flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 px-3">
          <span className="text-sm text-slate-500">Kategori</span>
          <select
            value={filters.category}
            onChange={(event) => onChange('category', event.target.value)}
            className="min-h-11 min-w-0 flex-1 bg-transparent py-2 text-base font-medium text-slate-800 sm:text-sm"
          >
            <option value="all">Semua kategori</option>
            {categories.map((option) => <option key={option.value} value={option.value}>{formatVendorCategoryLabel(option.label)}</option>)}
          </select>
        </label>
      </div>

      <div id={panelId} hidden={!expanded}>
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-2">
            {toggle('Dalam radius', 'withinRadius', !locationAvailable && !filters.withinRadius)}
            {customer && toggle('Promo', 'promo')}
            {customer && favoritesEnabled && toggle('Favorit', 'favorites', favoritesCount === 0 && !filters.favorites)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="min-w-0 space-y-1 text-sm text-slate-600">
              <span>Rating</span>
              <select value={filters.rating} onChange={(event) => onChange('rating', event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-2 text-base sm:text-sm">
                <option value="all">Semua rating</option><option value="4">4.0 ke atas</option><option value="4.5">4.5 ke atas</option>
              </select>
            </label>
            <label className="min-w-0 space-y-1 text-sm text-slate-600">
              <span>Radius (km)</span>
              <input type="number" inputMode="decimal" min="0.1" step="0.1" value={filters.radius}
                onChange={(event) => {
                  const radius = event.target.valueAsNumber
                  if (Number.isFinite(radius) && radius >= 0.1) onChange('radius', radius)
                }}
                className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-base sm:text-sm"
              />
            </label>
          </div>
          {!locationAvailable && <p className="text-xs text-slate-500">Aktifkan lokasi untuk mencari dalam radius.</p>}
        </div>
      </div>

      <div className="mt-2 flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500" role="status">
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-slate-700">{resultCount} dari {totalCount} toko online</span>
          {locationAvailable && <span className="ml-2">{nearbyCount} dalam radius</span>}
        </span>
        {hasFilters && <button type="button" onClick={() => { onReset(); setExpanded(false) }} className="min-h-11 shrink-0 rounded-lg px-2 font-medium text-teal-700 hover:bg-teal-50">Reset</button>}
      </div>
    </div>
  )
}
