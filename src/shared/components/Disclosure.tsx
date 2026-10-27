import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

export function Disclosure({
  title,
  description,
  children,
  defaultOpen = false
}: {
  title: string
  description?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details className="ui-disclosure" open={defaultOpen || undefined}>
      <summary>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">
            {title}
          </span>
          {description && (
            <span className="mt-0.5 block text-xs text-slate-500">
              {description}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="ui-disclosure-chevron h-4 w-4 shrink-0 text-slate-500 transition-transform"
        />
      </summary>
      <div className="space-y-3 border-t border-slate-100 p-4">{children}</div>
    </details>
  )
}
