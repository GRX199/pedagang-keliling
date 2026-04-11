import React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import ChatWorkspace from '../components/ChatWorkspace'

export default function ChatsPage() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const initialVendorId = params.id || searchParams.get('vendor')

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:py-6">
        <div className="mb-4 rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <h1 className="text-2xl font-semibold text-slate-900">Percakapan</h1>
          <p className="text-sm leading-6 text-slate-500">
            Semua chat dengan pedagang dan pelanggan akan tampil di sini.
          </p>
        </div>

        <ChatWorkspace initialVendorId={initialVendorId} />
      </div>
    </div>
  )
}
