import { useId, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import type { MapFilters } from '../../../types/domain.types'
import { Input } from '../../../shared/components/Input'
import { Modal } from '../../../shared/components/Modal'
import { formatVendorCategoryLabel } from '../../../lib/vendor'
import { MOBILITY_OPTIONS } from '../../../lib/pickup'

type Props = {
  filters: MapFilters
  onChange: <K extends keyof MapFilters>(name: K, value: MapFilters[K]) => void
  onReset: () => void
  categories: { value: string; label: string }[]
  customer: boolean
  favoritesEnabled: boolean
  favoritesCount: number
  totalCount: number
  resultCount: number
  nearbyCount: number
  locationAvailable: boolean
}

export default function MapSearchFilters({
  filters,
  onChange,
  onReset,
  categories,
  customer,
  favoritesEnabled,
  favoritesCount,
  totalCount,
  resultCount,
  nearbyCount,
  locationAvailable
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const categoryId = useId()
  const count = [
    filters.rating !== 'all',
    filters.mobility && filters.mobility !== 'all',
    filters.withinRadius,
    filters.promo,
    filters.favorites
  ].filter(Boolean).length
  const hasFilters =
    !!filters.query.trim() || filters.category !== 'all' || count > 0

  function toggle(
    label: string,
    name: 'withinRadius' | 'promo' | 'favorites',
    disabled = false
  ) {
    return (
      <button
        type="button"
        aria-pressed={filters[name]}
        disabled={disabled}
        onClick={() => onChange(name, !filters[name])}
        className={
          'min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ' +
          (filters[name]
            ? 'border-teal-700 bg-teal-50 text-teal-900'
            : 'border-slate-200 bg-white text-slate-700')
        }
      >
        {label}
      </button>
    )
  }

  return (
    <div className="ui-surface p-3">
      <div className="flex min-w-0 gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Cari pedagang atau produk</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400"
          />
          <Input
            type="search"
            value={filters.query}
            onChange={(event) => onChange('query', event.target.value)}
            placeholder="Cari toko atau barang"
            className="min-h-11 py-2.5 pl-9 pr-2"
          />
        </label>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={expanded}
          onClick={() => setExpanded(true)}
          className="ui-secondary gap-1.5 px-3"
        >
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
          Filter{count > 0 ? ' (' + count + ')' : ''}
        </button>
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <label htmlFor={categoryId} className="sr-only">
          Kategori
        </label>
        <select
          id={categoryId}
          value={filters.category}
          onChange={(event) => onChange('category', event.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
        >
          <option value="all">Semua kategori</option>
          {categories.map((option) => (
            <option key={option.value} value={option.value}>
              {formatVendorCategoryLabel(option.label)}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={onReset}
            className="min-h-11 px-2 text-sm font-semibold text-teal-800"
          >
            Reset
          </button>
        )}
      </div>
      <p role="status" className="mt-2 text-xs leading-5 text-slate-500">
        <strong className="font-medium text-slate-700">
          {resultCount} dari {totalCount} toko online
        </strong>
        {locationAvailable && <span> · {nearbyCount} dalam radius</span>}
      </p>

      <Modal
        open={expanded}
        title="Filter pedagang"
        onClose={() => setExpanded(false)}
        presentation="sheet"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {toggle(
              'Dalam radius',
              'withinRadius',
              !locationAvailable && !filters.withinRadius
            )}
            {customer && toggle('Promo', 'promo')}
            {customer &&
              favoritesEnabled &&
              toggle(
                'Favorit',
                'favorites',
                !favoritesCount && !filters.favorites
              )}
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Radius (km)
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              step="0.1"
              value={filters.radius}
              onChange={(event) => {
                const radius = event.target.valueAsNumber
                if (Number.isFinite(radius) && radius >= 0.1)
                  onChange('radius', radius)
              }}
              className="ui-field mt-1.5"
            />
          </label>
          {!locationAvailable && (
            <p className="text-xs text-slate-500">
              Aktifkan lokasi untuk mencari dalam radius.
            </p>
          )}
          <label className="block text-sm font-medium text-slate-700">
            Rating
            <select
              aria-label="Rating"
              value={filters.rating}
              onChange={(event) =>
                onChange('rating', event.target.value as MapFilters['rating'])
              }
              className="ui-field mt-1.5"
            >
              <option value="all">Semua rating</option>
              <option value="4">4.0 ke atas</option>
              <option value="4.5">4.5 ke atas</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Cara berkeliling
            <select
              aria-label="Cara berkeliling"
              value={filters.mobility || 'all'}
              onChange={(event) =>
                onChange(
                  'mobility',
                  event.target.value as MapFilters['mobility']
                )
              }
              className="ui-field mt-1.5"
            >
              <option value="all">Semua mobilitas</option>
              {MOBILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[auto_1fr] gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onReset} className="ui-secondary">
              Reset
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="ui-primary"
            >
              Lihat {resultCount} toko
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
