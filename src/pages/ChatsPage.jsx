import React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import ChatWorkspace from '../components/ChatWorkspace'

export default function ChatsPage() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const initialVendorId = params.id || searchParams.get('vendor')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl p-4">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Percakapan</h1>
          <p className="text-sm text-gray-500">
            Semua chat dengan pedagang dan pelanggan akan tampil di sini.
          </p>
        </div>

        <ChatWorkspace initialVendorId={initialVendorId} />
      </div>
    </div>
  )
}
