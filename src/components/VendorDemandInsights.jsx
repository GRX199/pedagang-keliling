import React from 'react'
import { formatPriceLabel } from '../lib/orders'
import { buildVendorTerritoryInsights } from '../lib/territory'

function HeatLevel({ intensity }) {
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4].map((level) => (
        <span
          key={level}
          className={`h-2.5 w-7 rounded-full ${
            level <= intensity ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-slate-200'
          }`}
        />
      ))}
    </div>
  )
}

function formatRelativeTime(value) {
  if (!value) return 'Baru saja masuk'

  const distanceMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(distanceMs) || distanceMs < 0) return 'Baru saja diperbarui'

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (distanceMs < hour) {
    const minutes = Math.max(1, Math.round(distanceMs / minute))
    return `${minutes} menit lalu`
  }

  if (distanceMs < day) {
    const hours = Math.max(1, Math.round(distanceMs / hour))
    return `${hours} jam lalu`
  }

  const days = Math.max(1, Math.round(distanceMs / day))
  return `${days} hari lalu`
}

export default function VendorDemandInsights({ orders }) {
  const insights = buildVendorTerritoryInsights(orders)

  if (!insights.hotspotCount) {
    return (
      <section className="rounded-[24px] border border-amber-100 bg-gradient-to-br from-amber-50 via-orange-50 to-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-amber-700">Area Permintaan</div>
            <h4 className="mt-2 text-lg font-semibold text-slate-900">Hotspot wilayah akan muncul otomatis</h4>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Insight ini membaca titik temu dan lokasi pelanggan dari pesanan terbaru. Saat data lokasi mulai terkumpul,
              Anda akan melihat area yang paling sering meminta dagangan Anda.
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-amber-100">
            Belum cukup data
          </span>
        </div>
      </section>
    )
  }

  const leadHotspot = insights.leadHotspot

  return (
    <section className="rounded-[24px] border border-amber-100 bg-gradient-to-br from-amber-50 via-orange-50 to-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-amber-700">Area Permintaan</div>
          <h4 className="mt-2 text-lg font-semibold text-slate-900">Wilayah yang paling sering meminta dagangan Anda</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Ringkasan ini memakai data order dan titik temu {insights.lookbackDays} hari terakhir. Tujuannya sederhana:
            membantu Anda melihat area yang layak diprioritaskan saat keliling.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:w-[360px] lg:grid-cols-1">
          <div className="rounded-[20px] bg-white p-4 shadow-sm ring-1 ring-amber-100">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Hotspot</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{insights.hotspotCount}</div>
            <div className="mt-1 text-sm text-slate-500">Area permintaan yang sudah terbaca.</div>
          </div>
          <div className="rounded-[20px] bg-white p-4 shadow-sm ring-1 ring-amber-100">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Order Bertitik</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{insights.mappedOrderCount}</div>
            <div className="mt-1 text-sm text-slate-500">Pesanan yang punya area temu atau lokasi.</div>
          </div>
          <div className="rounded-[20px] bg-white p-4 shadow-sm ring-1 ring-amber-100">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Titip Nanti</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{insights.preorderCount}</div>
            <div className="mt-1 text-sm text-slate-500">Pre-order yang ikut memberi sinyal area.</div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-[24px] bg-slate-900 p-5 text-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
              Area Utama Saat Ini
            </span>
            <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-medium text-amber-100">
              {leadHotspot.strengthLabel}
            </span>
          </div>

          <div className="mt-3 text-2xl font-semibold tracking-tight">{leadHotspot.label}</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Area ini paling layak dipantau lebih dulu. Ada {leadHotspot.orderCount} permintaan yang terbaca, dengan{' '}
            {leadHotspot.activeCount} yang masih aktif dan {leadHotspot.preorderCount} titip pesanan untuk nanti.
          </p>

          <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full bg-white/10 px-3 py-1 text-slate-100">{leadHotspot.orderCount} total</span>
            <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-emerald-100">{leadHotspot.activeCount} aktif</span>
            <span className="rounded-full bg-sky-400/15 px-3 py-1 text-sky-100">{leadHotspot.preorderCount} titip nanti</span>
            <span className="rounded-full bg-amber-400/15 px-3 py-1 text-amber-100">
              Selesai {formatPriceLabel(leadHotspot.totalCompletedValue)}
            </span>
          </div>

          <div className="mt-5 rounded-[20px] bg-white/5 p-4 ring-1 ring-white/10">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-100">Intensitas permintaan</div>
              <div className="text-xs text-slate-300">Update {formatRelativeTime(leadHotspot.latestAt)}</div>
            </div>
            <div className="mt-3">
              <HeatLevel intensity={leadHotspot.intensity} />
            </div>
            <div className="mt-3 text-sm leading-6 text-slate-300">
              Gunakan area ini sebagai acuan rute berikutnya, terutama saat Anda ingin menggabungkan order aktif dan
              titip pesanan di lokasi yang berdekatan.
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {insights.hotspots.map((hotspot, index) => (
            <article key={hotspot.id} className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                      #{index + 1}
                    </span>
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                      {hotspot.strengthLabel}
                    </span>
                  </div>
                  <div className="mt-2 text-base font-semibold text-slate-900">{hotspot.label}</div>
                  <div className="mt-1 text-sm text-slate-500">Update terakhir {formatRelativeTime(hotspot.latestAt)}</div>
                </div>

                <div className="text-right">
                  <div className="text-2xl font-semibold text-slate-900">{hotspot.orderCount}</div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">permintaan</div>
                </div>
              </div>

              <div className="mt-3">
                <HeatLevel intensity={hotspot.intensity} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{hotspot.activeCount} aktif</span>
                <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700">{hotspot.preorderCount} titip</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{hotspot.completedCount} selesai</span>
                {hotspot.totalCompletedValue > 0 ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                    {formatPriceLabel(hotspot.totalCompletedValue)}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
