import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function formatPrice(price) {
  if (price === null || typeof price === 'undefined') return 'Harga belum diatur'
  return `Rp ${Number(price).toLocaleString('id-ID')}`
}

export default function VendorProductsPreview({ vendorId, limit = 4 }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!vendorId) return undefined

    let active = true

    async function loadProducts() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, price, image_url')
          .eq('vendor_id', vendorId)
          .order('created_at', { ascending: false })
          .limit(limit)

        if (error) throw error
        if (active) setProducts(data || [])
      } catch (error) {
        console.error('loadProductsPreview', error)
        if (active) setProducts([])
      } finally {
        if (active) setLoading(false)
      }
    }

    loadProducts()

    return () => {
      active = false
    }
  }, [limit, vendorId])

  if (loading) {
    return <div className="text-sm text-gray-500">Memuat produk...</div>
  }

  if (products.length === 0) {
    return <div className="text-sm text-gray-500">Produk belum tersedia.</div>
  }

  return (
    <div className="grid gap-3">
      {products.map((product) => (
        <div key={product.id} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3">
          <div className="h-14 w-14 overflow-hidden rounded-lg bg-gray-100">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-gray-400">
                No img
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
