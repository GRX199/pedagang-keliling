import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
      className="m-auto w-[calc(100%-24px)] max-w-md rounded-2xl border-0 bg-white p-4 text-slate-900 backdrop:bg-slate-900/40"
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <Button aria-label="Tutup" onClick={onClose}>
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </header>
      {children}
    </dialog>
  )
}
