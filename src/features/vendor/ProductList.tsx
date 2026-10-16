import type { Product } from '../../types/domain.types'
import type { Cart } from '../orders/cart'
import { getProductStockLabel, isProductOrderable } from '../orders/cart'
import { formatPriceLabel } from '../../lib/orders'

type Props = {
  products: Product[]
  cart: Cart
  isOwner: boolean
  submittingOrder: boolean
  expandedProductNoteIds: Record<string, boolean>
  updateQuantity: (product: Product, quantity: number) => void
  toggleProductNote: (id: string, expanded: boolean) => void
  updateNote: (id: string, note: string) => void
}
export default function ProductList({
  products: productCards,
  cart,
  isOwner,
  submittingOrder,
  expandedProductNoteIds,
  updateQuantity,
  toggleProductNote,
  updateNote,
}: Props) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 lg:gap-4">
      {productCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          Belum ada produk yang dipublikasikan.
        </div>
      ) : (
        productCards.map((product) => {
          const quantity = cart[product.id]?.quantity || 0
          const note = cart[product.id]?.note || ''
          const orderable = isOwner || isProductOrderable(product)
          const noteExpanded =
            expandedProductNoteIds[product.id] ?? Boolean(note)

          return (
            <div
              key={product.id}
              className={`min-w-0 overflow-hidden rounded-[22px] border bg-white shadow-sm sm:rounded-[24px] ${
                orderable
                  ? 'border-slate-200'
                  : 'border-slate-200/70 opacity-80'
              }`}
            >
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="h-20 w-full object-cover sm:h-44"
                />
              ) : (
                <div className="flex h-20 items-center justify-center bg-slate-100 text-sm text-slate-400 sm:h-44">
                  Belum ada gambar
                </div>
              )}

              <div className="space-y-2.5 p-3 sm:space-y-3 sm:p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="break-words font-semibold text-slate-900">
                      {product.name}
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        orderable
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {orderable ? 'Siap' : 'Habis'}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-1 break-words text-sm leading-6 text-slate-600 sm:line-clamp-2">
                    {product.description || 'Tanpa deskripsi'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                    {formatPriceLabel(product.price)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                    {getProductStockLabel(product)}
                  </span>
                  {product.category_name && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                      {product.category_name}
                    </span>
                  )}
                </div>

                {!isOwner && (
                  <div className="space-y-3 rounded-2xl bg-slate-50 p-3">
                    {!orderable ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                        Sedang habis.
                      </div>
                    ) : quantity === 0 ? (
                      <button
                        type="button"
                        onClick={() => updateQuantity(product, 1)}
                        disabled={submittingOrder}
                        className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                      >
                        Tambah
                      </button>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-700">
                            Jumlah
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(product, quantity - 1)
                              }
                              disabled={submittingOrder}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700"
                            >
                              -
                            </button>
                            <div className="min-w-8 text-center text-sm font-semibold text-slate-900">
                              {quantity}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(product, quantity + 1)
                              }
                              disabled={submittingOrder}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              toggleProductNote(product.id, noteExpanded)
                            }
                            disabled={submittingOrder}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            {noteExpanded
                              ? 'Tutup catatan'
                              : note
                                ? 'Edit catatan'
                                : 'Catatan'}
                          </button>
                          {note && !noteExpanded && (
                            <div className="min-w-0 flex-1 truncate text-right text-xs text-slate-500">
                              {note}
                            </div>
                          )}
                        </div>

                        {noteExpanded && (
                          <textarea
                            value={note}
                            disabled={submittingOrder}
                            onChange={(event) =>
                              updateNote(product.id, event.target.value)
                            }
                            maxLength={140}
                            rows={2}
                            className="min-h-[68px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                            placeholder="Catatan opsional"
                          />
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
