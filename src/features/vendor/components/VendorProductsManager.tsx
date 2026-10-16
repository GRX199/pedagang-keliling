import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Product } from '../../../types/domain.types'
import type { TablesUpdate } from '../../../types/database.types'
import { errorMessage } from '../../../shared/lib/utils'
import { reportError } from '../../../shared/lib/error-reporting'
import { useProducts, useProductMutation } from '../useProducts'
import { useAuth } from '../../auth/AuthProvider'
import { uploadImageFile } from '../../../shared/lib/media'
import { isSchemaCompatibilityError } from '../../../lib/orders'
import { useToast } from '../../../shared/components/ToastProvider'

function formatPrice(price: number | null) {
  if (price === null || typeof price === 'undefined') return 'Harga belum diatur'
  return `Rp ${Number(price).toLocaleString('id-ID')}`
}

function hasManagedStock(product: Product) {
  return product.stock !== null
}

function getManagedStockNumber(product: Product) {
  if (!hasManagedStock(product)) return null
  const stock = Number(product.stock)
  return Number.isFinite(stock) ? stock : null
}

function getProductStockLabel(product: Product) {
  const stock = getManagedStockNumber(product)
  if (stock === null) return 'Stok fleksibel'
  if (stock <= 0) return 'Stok habis'
  const reservedStock = Number(product?.reserved_stock || 0)
  return reservedStock > 0 ? `Stok: ${stock} • Dipesan: ${reservedStock}` : `Stok: ${stock}`
}

function isProductOrderable(product: Product) {
  const stock = getManagedStockNumber(product)
  if (product?.is_available === false) return false
  if (stock !== null && stock <= 0) return false
  return true
}

const EMPTY_PRODUCTS: Product[] = []

export default function VendorProductsManager({ vendorId: propVendorId }: { vendorId?: string }) {
  const { user } = useAuth()
  const toast = useToast()
  const vendorId = propVendorId || user?.id

  const productQuery = useProducts(vendorId)
  const products = productQuery.data || EMPTY_PRODUCTS
  const loading = productQuery.isPending
  const { mutateAsync: mutateProduct } = useProductMutation(vendorId)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [availabilityId, setAvailabilityId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [isAvailable, setIsAvailable] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editStock, setEditStock] = useState('')
  const [editCategoryName, setEditCategoryName] = useState('')
  const [editIsAvailable, setEditIsAvailable] = useState(true)
  const [editFile, setEditFile] = useState<File | null>(null)
  const [editPreview, setEditPreview] = useState<string | null>(null)

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl]
  )

  useEffect(
    () => () => {
      if (editPreview) URL.revokeObjectURL(editPreview)
    },
    [editPreview]
  )

  function resetCreateForm() {
    setName('')
    setDescription('')
    setPrice('')
    setStock('')
    setCategoryName('')
    setIsAvailable(true)
    setFile(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] || null
    setFile(nextFile)

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }

    if (nextFile) setPreviewUrl(URL.createObjectURL(nextFile))
  }

  function onEditFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] || null
    setEditFile(nextFile)

    if (editPreview) {
      URL.revokeObjectURL(editPreview)
      setEditPreview(null)
    }

    if (nextFile) setEditPreview(URL.createObjectURL(nextFile))
  }

  function openEditModal(product: Product) {
    setEditing(true)
    setEditId(product.id)
    setEditName(product.name || '')
    setEditDescription(product.description || '')
    setEditPrice(product.price === null ? '' : String(product.price))
    setEditStock(product.stock === null ? '' : String(product.stock))
    setEditCategoryName(product.category_name || '')
    setEditIsAvailable(product.is_available !== false)
    setEditFile(null)
    if (editPreview) {
      URL.revokeObjectURL(editPreview)
      setEditPreview(null)
    }
  }

  function closeEditModal() {
    setEditing(false)
    setEditId(null)
    setEditStock('')
    setEditCategoryName('')
    setEditIsAvailable(true)
    setEditFile(null)
    if (editPreview) {
      URL.revokeObjectURL(editPreview)
      setEditPreview(null)
    }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!vendorId) {
      toast.push('Vendor tidak terdeteksi', { type: 'error' })
      return
    }

    if (!name.trim()) {
      toast.push('Nama produk wajib diisi', { type: 'error' })
      return
    }

    setSubmitting(true)
    try {
      const imageUrl = file ? await uploadImageFile({ file, vendorId, folder: 'products' }) : null

      const payload = {
        vendor_id: vendorId,
        name: name.trim(),
        description: description.trim() || null,
        price: price === '' ? null : Number(price),
        stock: stock === '' ? null : Number(stock),
        category_name: categoryName.trim() || null,
        is_available: isAvailable,
        image_url: imageUrl,
      }

      await mutateProduct({ kind: 'create', payload })

      toast.push('Produk berhasil ditambahkan', { type: 'success' })
      resetCreateForm()
    } catch (error) {
      void reportError(error, 'products')
      if (isSchemaCompatibilityError(error)) {
        toast.push(
          'Database belum memuat field stok, kategori, dan availability terbaru. Jalankan phase1-foundation.sql lalu coba lagi.',
          { type: 'error' }
        )
        return
      }
      toast.push(errorMessage(error) || 'Gagal menambahkan produk', { type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!editId || !vendorId) return

    setSubmitting(true)
    try {
      const payload: TablesUpdate<'products'> = {
        name: editName.trim(),
        description: editDescription.trim() || null,
        price: editPrice === '' ? null : Number(editPrice),
        stock: editStock === '' ? null : Number(editStock),
        category_name: editCategoryName.trim() || null,
        is_available: editIsAvailable,
      }

      if (editFile) {
        payload.image_url = await uploadImageFile({
          file: editFile,
          vendorId,
          folder: 'products',
        })
      }

      await mutateProduct({ kind: 'update', id: editId, payload })

      toast.push('Perubahan produk disimpan', { type: 'success' })
      closeEditModal()
    } catch (error) {
      void reportError(error, 'products')
      if (isSchemaCompatibilityError(error)) {
        toast.push(
          'Database belum memuat field operasional produk terbaru. Jalankan phase1-foundation.sql lalu coba lagi.',
          { type: 'error' }
        )
        return
      }
      toast.push(errorMessage(error) || 'Gagal menyimpan perubahan produk', { type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteProduct(id: string) {
    if (!id || !window.confirm('Hapus produk ini?')) return

    setDeletingId(id)
    try {
      await mutateProduct({ kind: 'delete', id })

      toast.push('Produk berhasil dihapus', { type: 'success' })
    } catch (error) {
      void reportError(error, 'products')
      toast.push(errorMessage(error) || 'Gagal menghapus produk', { type: 'error' })
    } finally {
      setDeletingId(null)
    }
  }

  async function toggleProductSoldOut(product: Product) {
    if (!product?.id) return

    const productIsOrderable = isProductOrderable(product)
    const stock = getManagedStockNumber(product)
    const nextPayload = productIsOrderable
      ? { is_available: false }
      : {
          is_available: true,
          stock: stock !== null && stock <= 0 ? null : product.stock,
        }

    setAvailabilityId(product.id)
    try {
      await mutateProduct({ kind: 'update', id: product.id, payload: nextPayload })
      toast.push(productIsOrderable ? 'Produk ditandai habis' : 'Produk tersedia lagi', {
        type: 'success',
      })
    } catch (error) {
      void reportError(error, 'products')
      toast.push(errorMessage(error) || 'Gagal memperbarui ketersediaan produk', { type: 'error' })
    } finally {
      setAvailabilityId(null)
    }
  }

  const availableProductCount = products.filter((product) => isProductOrderable(product)).length
  const unavailableProductCount = products.length - availableProductCount

  return (
    <div className="min-w-0 space-y-3 sm:space-y-4">
      {productQuery.error ? (
        <p role="alert" className="text-sm text-amber-800">
          Produk belum diperbarui.{' '}
          <button
            type="button"
            onClick={() => {
              void productQuery.refetch()
            }}
          >
            Coba lagi
          </button>
        </p>
      ) : null}
      <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">Produk Saya</h2>
            <p className="mt-1 hidden text-sm leading-6 text-slate-500 sm:block">
              Kelola menu, harga, foto, dan stok opsional. Kosongkan stok jika jumlahnya fleksibel.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateForm((current) => !current)}
            className="rounded-full bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {showCreateForm ? 'Tutup' : 'Tambah Produk'}
          </button>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-sm">
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-2 font-medium text-slate-700">
            Total <strong>{products.length}</strong>
          </span>
          <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-2 font-medium text-emerald-700">
            Aktif <strong>{availableProductCount}</strong>
          </span>
          <span className="shrink-0 rounded-full bg-rose-50 px-3 py-2 font-medium text-rose-700">
            Habis <strong>{unavailableProductCount}</strong>
          </span>
        </div>

        {showCreateForm && (
          <form onSubmit={addProduct} className="mt-4 space-y-3">
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nama produk"
              required
            />

            <textarea
              className="min-h-[96px] w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Deskripsi produk"
            />

            <input
              type="number"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="Harga (Rp)"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="Kategori produk, misalnya sayur atau minuman"
              />
              <input
                type="number"
                min="0"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={stock}
                onChange={(event) => setStock(event.target.value)}
                placeholder="Stok (opsional)"
              />
            </div>

            <div className="hidden rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500 sm:block">
              Stok boleh dikosongkan untuk produk fleksibel seperti sayur timbang, jajanan campur,
              atau menu yang jumlahnya tidak tetap.
            </div>

            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isAvailable}
                onChange={(event) => setIsAvailable(event.target.checked)}
              />
              Produk ini sedang tersedia untuk dipesan
            </label>

            <div>
              <label className="block text-sm font-medium text-slate-700">Foto produk</label>
              <input
                type="file"
                accept="image/*"
                className="mt-2 max-w-full text-sm"
                onChange={onFileChange}
              />
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="preview"
                  className="mt-3 h-28 w-28 rounded-xl object-cover sm:h-36 sm:w-36"
                />
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-400"
              >
                {submitting ? 'Menyimpan...' : 'Tambah Produk'}
              </button>
              <button
                type="button"
                onClick={resetCreateForm}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
              >
                Reset
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-slate-200/80 sm:rounded-[28px] sm:p-5">
        <div className="mb-4">
          <div>
            <h3 className="font-semibold text-slate-900">Daftar Produk</h3>
            <p className="hidden text-sm text-slate-500 sm:block">
              Produk aktif akan tampil di profil toko dan checkout pelanggan.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Memuat produk...</div>
        ) : products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Belum ada produk.
          </div>
        ) : (
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {products.map((product) => {
              const orderable = isProductOrderable(product)

              return (
                <div
                  key={product.id}
                  className="flex min-w-0 gap-3 overflow-hidden rounded-[18px] border border-slate-200 bg-white p-3 sm:block sm:rounded-[24px] sm:p-0"
                >
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="h-20 w-20 shrink-0 rounded-xl object-cover sm:h-44 sm:w-full sm:rounded-none"
                    />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-center text-xs text-slate-400 sm:h-44 sm:w-full sm:rounded-none sm:text-sm">
                      Tanpa foto
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-2 sm:p-4">
                    <div className="break-words font-semibold text-slate-900">{product.name}</div>
                    <div className="hidden break-words text-sm leading-6 text-slate-600 sm:line-clamp-2">
                      {product.description || 'Tanpa deskripsi'}
                    </div>
                    <div className="text-sm font-medium text-slate-900">
                      {formatPrice(product.price)}
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2 text-xs">
                      <span
                        className={`max-w-full break-words rounded-full px-3 py-1 font-medium leading-tight ${
                          orderable
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                            : 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                        }`}
                      >
                        {orderable ? 'Tersedia' : 'Habis'}
                      </span>
                      <span
                        className={`max-w-full break-words rounded-full px-3 py-1 font-medium leading-tight ${
                          orderable
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                        }`}
                      >
                        {getProductStockLabel(product)}
                      </span>
                      {product.category_name && (
                        <span className="max-w-full break-words rounded-full bg-slate-100 px-3 py-1 font-medium leading-tight text-slate-700">
                          {product.category_name}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void toggleProductSoldOut(product)}
                        disabled={availabilityId === product.id}
                        className={`col-span-2 rounded-xl px-2 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm ${
                          orderable
                            ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                      >
                        {availabilityId === product.id
                          ? 'Menyimpan...'
                          : orderable
                            ? 'Tandai Habis'
                            : 'Tersedia Lagi'}
                      </button>
                      <button
                        onClick={() => openEditModal(product)}
                        className="rounded-xl border border-slate-200 px-2 py-2 text-xs font-medium text-slate-700 sm:text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteProduct(product.id)}
                        disabled={deletingId === product.id}
                        className="rounded-xl border border-red-200 bg-red-50 px-2 py-2 text-xs font-medium text-red-600 disabled:opacity-60 sm:text-sm"
                      >
                        {deletingId === product.id ? 'Menghapus...' : 'Hapus'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-t-[24px] bg-white p-4 shadow-xl sm:rounded-[28px]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Edit Produk</h3>
              <button
                onClick={closeEditModal}
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={saveEdit} className="space-y-3">
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Nama produk"
                required
              />

              <textarea
                className="min-h-[96px] w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                placeholder="Deskripsi produk"
              />

              <input
                type="number"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={editPrice}
                onChange={(event) => setEditPrice(event.target.value)}
                placeholder="Harga (Rp)"
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={editCategoryName}
                  onChange={(event) => setEditCategoryName(event.target.value)}
                  placeholder="Kategori produk"
                />
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                  value={editStock}
                  onChange={(event) => setEditStock(event.target.value)}
                  placeholder="Stok (opsional)"
                />
              </div>

              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={editIsAvailable}
                  onChange={(event) => setEditIsAvailable(event.target.checked)}
                />
                Produk ini sedang tersedia untuk dipesan
              </label>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Ganti foto produk
                </label>
                <input
                  type="file"
                  accept="image/*"
                  className="mt-2 max-w-full text-sm"
                  onChange={onEditFileChange}
                />
                {editPreview && (
                  <img
                    src={editPreview}
                    alt="preview"
                    className="mt-3 h-28 w-28 rounded-xl object-cover sm:h-36 sm:w-36"
                  />
                )}
              </div>

              <div className="flex flex-col justify-end gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-400"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
