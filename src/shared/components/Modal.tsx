import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'
import { useToast } from './ToastProvider'

export function Modal({
  open,
  title,
  children,
  onClose,
  presentation = 'dialog'
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  presentation?: 'dialog' | 'sheet'
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const { registerLayer } = useToast()
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
    if (open && dialog.current) return registerLayer(dialog.current)
  }, [open, registerLayer])
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      data-presentation={presentation}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={() => {
        if (open) onClose()
      }}
      className="ui-modal"
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
