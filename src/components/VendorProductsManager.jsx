import React, { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { uploadImageFile } from '../lib/media'
import { supabase } from '../lib/supabase'
import { useToast } from './ToastProvider'

function formatPrice(price) {
  if (price === null || typeof price === 'undefined') return 'Harga belum diatur'
  return `Rp ${Number(price).toLocaleString('id-ID')}`
}

export default function VendorProductsManager({ vendorId: propVendorId }) {
  const { user } = useAuth()
  const toast = useToast()
  const vendorId = propVendorId || user?.id

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  const [editing, setEditing] = useState(false)
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editFile, setEditFile] = useState(null)
  const [editPreview, setEditPreview] = useState(null)

  useEffect(() => {
    if (!vendorId) return
    fetchProducts()
  }, [vendorId])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => () => {
    if (editPreview) URL.revokeObjectURL(editPreview)
  }, [editPreview])

  async function fetchProducts() {
    if (!vendorId) return

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setProducts(data || [])
    } catch (error) {
      console.error('fetchProducts', error)
      toast.push(error.message || 'Gagal memuat produk', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  function resetCreateForm() {
    setName('')
    setDescription('')
    setPrice('')
    setFile(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }

  function onFileChange(event) {
    const nextFile = event.target.files?.[0] || null
    setFile(nextFile)

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }

    if (nextFile) setPreviewUrl(URL.createObjectURL(nextFile))
  }

  function onEditFileChange(event) {
    const nextFile = event.target.files?.[0] || null
    setEditFile(nextFile)

    if (editPreview) {
      URL.revokeObjectURL(editPreview)
      setEditPreview(null)
    }

    if (nextFile) setEditPreview(URL.createObjectURL(nextFile))
  }

  function openEditModal(product) {
    setEditing(true)
    setEditId(product.id)
    setEditName(product.name || '')
    setEditDescription(product.description || '')
    setEditPrice(product.price ?? '')
    setEditFile(null)
    if (editPreview) {
      URL.revokeObjectURL(editPreview)
      setEditPreview(null)
    }
  }

  function closeEditModal() {
    setEditing(false)
    setEditId(null)
    setEditFile(null)
    if (editPreview) {
      URL.revokeObjectURL(editPreview)
      setEditPreview(null)
    }
  }

  async function addProduct(event) {
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
      const imageUrl = file
        ? await uploadImageFile({ file, vendorId, folder: 'products' })
        : null

      const payload = {
        vendor_id: vendorId,
        name: name.trim(),
        description: description.trim() || null,
        price: price === '' ? null : Number(price),
        image_url: imageUrl,
      }

      const { error } = await supabase.from('products').insert([payload])
      if (error) throw error

      toast.push('Produk berhasil ditambahkan', { type: 'success' })
      resetCreateForm()
      fetchProducts()
    } catch (error) {
      console.error('addProduct', error)
      toast.push(error.message || 'Gagal menambahkan produk', { type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function saveEdit(event) {
    event.preventDefault()

    if (!editId) return

    setSubmitting(true)
    try {
      const payload = {
        name: editName.trim(),
        description: editDescription.trim() || null,
        price: editPrice === '' ? null : Number(editPrice),
      }

      if (editFile) {
        payload.image_url = await uploadImageFile({
          file: editFile,
          vendorId,
          folder: 'products',
        })
      }

      const { error } = await supabase.from('products').update(payload).eq('id', editId)
      if (error) throw error

      toast.push('Perubahan produk disimpan', { type: 'success' })
      closeEditModal()
      fetchProducts()
    } catch (error) {
      console.error('saveEdit', error)
      toast.push(error.message || 'Gagal menyimpan perubahan produk', { type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteProduct(id) {
    if (!id || !window.confirm('Hapus produk ini?')) return

    setDeletingId(id)
    try {
      const { error } = await supabase.from('products').delete().eq('id', id)
      if (error) throw error

      toast.push('Produk berhasil dihapus', { type: 'success' })
      fetchProducts()
    } catch (error) {
      console.error('deleteProduct', error)
      toast.push(error.message || 'Gagal menghapus produk', { type: 'error' })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
        <h2 className="text-xl font-semibold text-gray-900">Produk Saya</h2>
        <p className="mt-1 text-sm text-gray-500">Tambah produk baru agar pelanggan bisa langsung melihat dagangan Anda.</p>

        <form onSubmit={addProduct} className="mt-4 space-y-3">
          <input
            className="w-full rounded-xl border border-gray-300 px-3 py-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nama produk"
            required
          />

          <textarea
            className="min-h-[120px] w-full rounded-xl border border-gray-300 px-3 py-2"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Deskripsi produk"
          />

          <input
            type="number"
            className="w-full rounded-xl border border-gray-300 px-3 py-2"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="Harga (Rp)"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700">Foto produk</label>
            <input type="file" accept="image/*" className="mt-2" onChange={onFileChange} />
            {previewUrl && <img src={previewUrl} alt="preview" className="mt-3 h-36 w-36 rounded-xl object-cover" />}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:bg-blue-300"
            >
              {submitting ? 'Menyimpan...' : 'Tambah Produk'}
            </button>
            <button type="button" onClick={resetCreateForm} className="rounded-lg border border-gray-300 px-4 py-2">
              Reset
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Daftar Produk</h3>
            <p className="text-sm text-gray-500">Produk akan ditampilkan di peta dan profil toko.</p>
          </div>
          <button onClick={fetchProducts} className="rounded-lg border border-gray-300 px-3 py-1 text-sm">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-500">Memuat produk...</div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
            Belum ada produk.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {products.map((product) => (
              <div key={product.id} className="overflow-hidden rounded-2xl border border-gray-200">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="h-44 w-full object-cover" />
                ) : (
                  <div className="flex h-44 items-center justify-center bg-gray-100 text-sm text-gray-400">
                    Belum ada gambar
                  </div>
                )}

                <div className="space-y-2 p-4">
                  <div className="font-semibold text-gray-900">{product.name}</div>
                  <div className="text-sm text-gray-600">{product.description || 'Tanpa deskripsi'}</div>
                  <div className="text-sm font-medium text-gray-900">{formatPrice(product.price)}</div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(product)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteProduct(product.id)}
                      disabled={deletingId === product.id}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 disabled:opacity-60"
                    >
                      {deletingId === product.id ? 'Menghapus...' : 'Hapus'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Edit Produk</h3>
              <button onClick={closeEditModal} className="rounded-lg border border-gray-300 px-3 py-1 text-sm">
                Tutup
              </button>
            </div>

            <form onSubmit={saveEdit} className="space-y-3">
              <input
                className="w-full rounded-xl border border-gray-300 px-3 py-2"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Nama produk"
                required
              />

              <textarea
                className="min-h-[120px] w-full rounded-xl border border-gray-300 px-3 py-2"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                placeholder="Deskripsi produk"
              />

              <input
                type="number"
                className="w-full rounded-xl border border-gray-300 px-3 py-2"
                value={editPrice}
                onChange={(event) => setEditPrice(event.target.value)}
                placeholder="Harga (Rp)"
              />

              <div>
                <label className="block text-sm font-medium text-gray-700">Ganti foto produk</label>
                <input type="file" accept="image/*" className="mt-2" onChange={onEditFileChange} />
                {editPreview && <img src={editPreview} alt="preview" className="mt-3 h-36 w-36 rounded-xl object-cover" />}
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeEditModal} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:bg-blue-300"
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
