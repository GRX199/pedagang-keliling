import { useProducts } from '../useProducts'

function formatPrice(price: number | null) {
  if (price === null || typeof price === 'undefined') return 'Harga belum diatur'
  return `Rp ${Number(price).toLocaleString('id-ID')}`
}

export default function VendorProductsPreview({
  vendorId,
  limit = 4,
}: {
  vendorId: string
  limit?: number
}) {
  const query = useProducts(vendorId)
  const products = (query.data || []).slice(0, limit)
  const loading = query.isPending

  if (loading) {
    return <div className="text-sm text-gray-500">Memuat produk...</div>
  }

  if (query.error && !query.data)
    return (
      <div role="alert" className="text-sm text-amber-800">
        Produk belum dapat dimuat.{' '}
        <button
          type="button"
          onClick={() => {
            void query.refetch()
          }}
        >
          Coba lagi
        </button>
      </div>
    )

  if (products.length === 0) {
    return <div className="text-sm text-gray-500">Produk belum tersedia.</div>
  }

  return (
    <div className="grid gap-3">
      {products.map((product) => (
        <div
          key={product.id}
          className="flex items-center gap-3 rounded-xl border border-gray-200 p-3"
        >
          <div className="h-14 w-14 overflow-hidden rounded-lg bg-gray-100">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-gray-400">
                Tanpa foto
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-gray-900">{product.name}</div>
            <div className="text-sm text-gray-500">{formatPrice(product.price)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
