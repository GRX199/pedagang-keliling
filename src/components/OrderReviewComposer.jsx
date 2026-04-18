import React, { useEffect, useState } from 'react'
import { useToast } from './ToastProvider'
import { isSchemaCompatibilityError } from '../lib/orders'
import {
  canBuyerReviewOrder,
  formatReviewScore,
  getReviewRatingLabel,
  normalizeReviewRating,
} from '../lib/reviews'
import { supabase } from '../lib/supabase'

function RatingOption({ value, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`rounded-2xl px-3 py-2 text-sm font-medium transition ${
        active
          ? 'bg-slate-900 text-white'
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
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
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

    setSaving(true)
    try {
      const payload = {
        order_id: order.id,
        vendor_id: order.vendor_id,
        buyer_id: viewerId,
        buyer_name: buyerName,
        rating: normalizeReviewRating(rating),
        comment: String(comment || '').trim() || null,
      }

      const { data, error } = await supabase
        .from('reviews')
        .upsert([payload], { onConflict: 'order_id' })
        .select()
        .single()

      if (error) throw error

      toast.push(existingReview ? 'Ulasan berhasil diperbarui' : 'Terima kasih, ulasan berhasil dikirim', { type: 'success' })
      setEditing(false)
      onSaved?.(data)
    } catch (error) {
      console.error('saveReview', error)
      if (isSchemaCompatibilityError(error)) {
        toast.push('Database belum memuat tabel ulasan. Jalankan reviews-and-ratings.sql lalu coba lagi.', { type: 'error' })
        return
      }
      toast.push(error.message || 'Gagal menyimpan ulasan', { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const wrapperClass = compact
    ? 'rounded-2xl border border-slate-200 bg-slate-50 p-4'
    : 'mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4'

  return (
    <div className={wrapperClass}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Ulasan Anda</div>
          <div className="mt-1 text-sm text-slate-500">
            {existingReview ? `Rating ${formatReviewScore(existingReview.rating)} • ${getReviewRatingLabel(existingReview.rating)}` : 'Bagikan pengalaman Anda agar pelanggan lain punya gambaran yang lebih jelas.'}
          </div>
        </div>

        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {existingReview ? 'Ubah Ulasan' : 'Beri Ulasan'}
          </button>
        )}
      </div>

      {!editing && existingReview && (
        <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-600">
          {existingReview.comment || 'Tanpa komentar tambahan.'}
        </div>
      )}

      {editing && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-sm font-medium text-slate-900">Nilai pengalaman Anda</div>
            <div className="mt-3 flex flex-wrap gap-2">
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
              className="mt-3 min-h-[96px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
              placeholder="Contoh: pedagang ramah, datang tepat waktu, atau produk sesuai harapan"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={saving}
              onClick={saveReview}
              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-400"
            >
              {saving ? 'Menyimpan...' : existingReview ? 'Simpan Perubahan' : 'Kirim Ulasan'}
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
