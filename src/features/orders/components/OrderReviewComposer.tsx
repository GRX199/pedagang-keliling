import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Order, Review } from '../../../types/domain.types'
import type { TablesInsert } from '../../../types/database.types'
import type { OrderBundle } from '../api'
import { updateOrderLists } from '../order-list'
import { reportError } from '../../../shared/lib/error-reporting'
import { errorMessage } from '../../../shared/lib/utils'
import { useToast } from '../../../shared/components/ToastProvider'
import { isSchemaCompatibilityError } from '../../../lib/orders'
import {
  canBuyerReviewOrder,
  formatReviewScore,
  getReviewRatingLabel,
  normalizeReviewRating,
} from '../../../lib/reviews'
import { supabase } from '../../../shared/lib/supabase'

function RatingOption({
  value,
  active,
  onSelect,
}: {
  value: number
  active: boolean
  onSelect: (value: number) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(value)}
      className={`min-w-0 rounded-2xl px-2 py-2 text-sm font-semibold transition sm:px-3 ${
        active
          ? 'bg-slate-900 text-white shadow-sm'
          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {value}
    </button>
  )
}

export default function OrderReviewComposer({
  order,
  existingReview = null,
  viewerId,
  buyerName = 'Pelanggan',
  onSaved,
  compact = false,
}: {
  order: Order
  existingReview?: Review | null
  viewerId?: string
  buyerName?: string | null
  onSaved?: (review: Review) => void
  compact?: boolean
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (payload: TablesInsert<'reviews'>) => {
      const { data, error } = await supabase
        .from('reviews')
        .upsert([payload], { onConflict: 'order_id' })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: async (review) => {
      await client.cancelQueries({ queryKey: ['order-details', viewerId, order.id] })
      client.setQueryData<OrderBundle>(['order-details', viewerId, order.id], (previous) =>
        previous ? { ...previous, review } : undefined
      )
      if (viewerId) updateOrderLists(client, viewerId,
        rows => rows.map(row => row.id === order.id ? { ...row, review } : row))
      void client.invalidateQueries({ queryKey: ['vendor'] })
      void client.invalidateQueries({ queryKey: ['map-vendors'] })
    },
  })
  const saving = mutation.isPending
  const [rating, setRating] = useState(existingReview?.rating || 5)
  const [comment, setComment] = useState(existingReview?.comment || '')

  useEffect(() => {
    setRating(existingReview?.rating || 5)
    setComment(existingReview?.comment || '')
    setEditing(false)
  }, [existingReview?.comment, existingReview?.id, existingReview?.rating, order?.id])

  if (!canBuyerReviewOrder(order, viewerId)) {
    return null
  }

  async function saveReview() {
    if (!order?.id || !viewerId) return

    try {
      const payload = {
        order_id: order.id,
        vendor_id: order.vendor_id,
        buyer_id: viewerId,
        buyer_name: buyerName || 'Pelanggan',
        rating: normalizeReviewRating(rating),
        comment: String(comment || '').trim() || null,
      }

      const data = await mutation.mutateAsync(payload)

      toast.push(
        existingReview ? 'Ulasan berhasil diperbarui' : 'Terima kasih, ulasan berhasil dikirim',
        { type: 'success' }
      )
      setEditing(false)
      onSaved?.(data)
    } catch (error) {
      void reportError(error, 'orders')
      if (isSchemaCompatibilityError(error)) {
        toast.push(
          'Database belum memuat tabel ulasan. Jalankan reviews-and-ratings.sql lalu coba lagi.',
          { type: 'error' }
        )
        return
      }
      toast.push(errorMessage(error) || 'Gagal menyimpan ulasan', { type: 'error' })
    }
  }

  const wrapperClass = compact
    ? 'min-w-0 overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50 p-3 sm:rounded-[22px] sm:p-4'
    : 'mt-4 min-w-0 overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50 p-3 sm:rounded-[22px] sm:p-4'

  return (
    <div className={wrapperClass}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">Ulasan Anda</div>
          <div className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500 sm:line-clamp-none">
            {existingReview
              ? `Rating ${formatReviewScore(existingReview.rating)} • ${getReviewRatingLabel(existingReview.rating)}`
              : 'Bantu pelanggan lain menilai toko ini.'}
          </div>
        </div>

        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {existingReview ? 'Ubah' : 'Beri Ulasan'}
          </button>
        )}
      </div>

      {!editing && existingReview && (
        <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-600 break-words">
          {existingReview.comment || 'Tanpa komentar tambahan.'}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
          <div>
            <div className="text-sm font-medium text-slate-900">Rating</div>
            <div className="mt-2 grid grid-cols-5 gap-1.5 sm:mt-3 sm:flex sm:flex-wrap sm:gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <RatingOption
                  key={value}
                  value={value}
                  active={normalizeReviewRating(rating) === value}
                  onSelect={setRating}
                />
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-500">{getReviewRatingLabel(rating)}</div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-900">Komentar opsional</label>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={240}
              rows={3}
              className="mt-2 min-h-[76px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 sm:mt-3 sm:min-h-[84px]"
              placeholder="Contoh: pedagang ramah, datang tepat waktu, atau produk sesuai harapan"
            />
            <div className="mt-1 text-right text-xs text-slate-400">{comment.length}/240</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={saveReview}
              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-400"
            >
              {saving ? 'Menyimpan...' : existingReview ? 'Simpan' : 'Kirim'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setRating(existingReview?.rating || 5)
                setComment(existingReview?.comment || '')
              }}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
