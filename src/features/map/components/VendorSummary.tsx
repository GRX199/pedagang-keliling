import { ArrowRight, Heart, MessageCircle, X } from 'lucide-react'
import type { VendorMapItem } from '../../../types/domain.types'
import {
  formatVendorCategoryLabel,
  getVendorPromoText,
  isVendorPromoActive
} from '../../../lib/vendor'
import {
  getVendorCategory,
  getVendorReviewCount,
  formatVendorRatingMeta
} from '../map-model'

type Props = {
  vendor: VendorMapItem
  isOwner: boolean
  distance: string
  presence: string
  favorite: boolean
  favoriteBusy: boolean
  canFavorite: boolean
  onFavorite: () => void
  onVisit: () => void
  onChat: () => void
  onProfile: () => void
  onClose?: () => void
}

export default function VendorSummary({
  vendor,
  isOwner,
  distance,
  presence,
  favorite,
  favoriteBusy,
  canFavorite,
  onFavorite,
  onVisit,
  onChat,
  onProfile,
  onClose
}: Props) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-teal-50 text-xl font-semibold text-teal-800">
          {vendor.photo_url ? (
            <img
              src={vendor.photo_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            (vendor.name || 'P')[0]
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-lg font-semibold leading-6 text-slate-900">
            {vendor.name}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {[
              getVendorCategory(vendor)
                ? formatVendorCategoryLabel(getVendorCategory(vendor))
                : null,
              distance
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-1 text-xs font-medium text-teal-800">{presence}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup detail toko"
            className="ui-icon-button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      {getVendorReviewCount(vendor) > 0 && (
        <p className="text-sm font-medium text-amber-800">
          {formatVendorRatingMeta(vendor)}
        </p>
      )}
      {vendor.description && (
        <p className="line-clamp-3 break-words text-sm leading-6 text-slate-600">
          {vendor.description}
        </p>
      )}
      {isVendorPromoActive(vendor) && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {getVendorPromoText(vendor)}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onVisit}
          className="ui-primary min-w-0 flex-1"
        >
          {isOwner ? 'Kelola Produk' : 'Lihat produk'}
          <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        </button>
        <button
          type="button"
          onClick={isOwner ? onProfile : onChat}
          className="ui-secondary"
        >
          {!isOwner && <MessageCircle aria-hidden="true" className="h-4 w-4" />}
          {isOwner ? 'Profil' : 'Chat'}
        </button>
        {canFavorite && !isOwner && (
          <button
            type="button"
            onClick={onFavorite}
            disabled={favoriteBusy}
            aria-label={favorite ? 'Hapus favorit' : 'Simpan Favorit'}
            aria-pressed={favorite}
            className="ui-icon-button text-rose-700"
          >
            <Heart
              aria-hidden="true"
              className={'h-5 w-5 ' + (favorite ? 'fill-current' : '')}
            />
          </button>
        )}
      </div>
    </div>
  )
}
