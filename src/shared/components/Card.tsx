import type { HTMLAttributes } from 'react'
import { cn } from '../lib/utils'
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4',
        className
      )}
      {...props}
    />
  )
}
