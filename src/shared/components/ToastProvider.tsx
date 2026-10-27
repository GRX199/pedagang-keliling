// src/components/ToastProvider.jsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type PropsWithChildren
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type ToastOptions = {
  type?: 'info' | 'success' | 'error' | 'warning'
  timeout?: number
}
type Toast = {
  id: number
  msg: string
  type: 'info' | 'success' | 'error' | 'warning'
}
const ToastContext = createContext<{
  push: (msg: string, options?: ToastOptions) => void
  clear: () => void
  registerLayer: (host: HTMLElement) => () => void
}>({
  push: () => {},
  clear: () => {},
  registerLayer: () => () => {}
})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [host, setHost] = useState<HTMLElement | null>(null)
  const layers = useRef<HTMLElement[]>([])
  const registerLayer = useCallback((element: HTMLElement) => {
    layers.current.push(element)
    setHost(element)
    return () => {
      layers.current = layers.current.filter((layer) => layer !== element)
      setHost(layers.current.at(-1) || null)
    }
  }, [])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])
  const clear = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    setToasts([])
  }, [])
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const push = useCallback(
    (msg: string, { type = 'info', timeout = 3500 }: ToastOptions = {}) => {
      const id = Date.now() + Math.random()
      setToasts((t) => [...t.slice(-2), { id, msg, type }])
      if (timeout) {
        timers.current.set(
          id,
          setTimeout(() => {
            timers.current.delete(id)
            setToasts((t) => t.filter((x) => x.id !== id))
          }, timeout)
        )
      }
    },
    []
  )

  const value = useMemo(
    () => ({ push, clear, registerLayer }),
    [push, clear, registerLayer]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-3 top-[calc(var(--app-header-height)+0.75rem)] z-[1800] flex flex-col gap-2 sm:inset-x-auto sm:right-4"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex max-w-full items-center gap-2 break-words rounded-2xl py-1 pl-4 pr-1 text-sm shadow-lg sm:max-w-sm ${
                t.type === 'error'
                  ? 'bg-red-600 text-white'
                  : t.type === 'success'
                    ? 'bg-teal-800 text-white'
                    : t.type === 'warning'
                      ? 'bg-amber-100 text-amber-950'
                      : 'bg-slate-900 text-white'
              }`}
            >
              <span className="min-w-0 flex-1 py-2">{t.msg}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Tutup notifikasi"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/10"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>,
        host || document.body
      )}
    </ToastContext.Provider>
  )
}
