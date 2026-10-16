import { LoaderCircle } from 'lucide-react'
export function Spinner({ label = 'Memuat...' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-4 text-sm text-slate-500">
      <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}
