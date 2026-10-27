import type { HTMLAttributes } from 'react'
import { cn } from '../lib/utils'
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('ui-surface space-y-3 p-4 sm:p-5', className)}
      {...props}
    />
  )
}
