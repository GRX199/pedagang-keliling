import React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import ChatWorkspace from '../components/ChatWorkspace'

export default function ChatsPage() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const initialVendorId = params.id || searchParams.get('vendor')
  const initialOrderId = searchParams.get('order')

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
        <div className="mb-3 rounded-[22px] bg-white p-3 shadow-sm ring-1 ring-slate-200/80 sm:mb-4 sm:rounded-[28px] sm:p-5">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Percakapan</h1>
          <p className="hidden text-sm leading-6 text-slate-500 sm:block">
            Semua chat dengan pedagang dan pelanggan akan tampil di sini.
          </p>
        </div>

        <ChatWorkspace initialVendorId={initialVendorId} initialOrderId={initialOrderId} />
      </div>
    </div>
  )
}
