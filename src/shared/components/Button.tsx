import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '../lib/utils'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, busy = false, disabled, variant = 'secondary', type = 'button', children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary'
          ? 'border-teal-700 bg-teal-700 text-white'
          : variant === 'danger'
            ? 'border-rose-200 text-rose-700'
            : 'border-slate-200 bg-white text-slate-800',
        className
      )}
      {...props}
    >
      {busy && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
})
