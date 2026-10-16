import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
        'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base sm:text-sm',
          className
        )}
        {...props}
      />
    )
  }
)
