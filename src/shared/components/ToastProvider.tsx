// src/components/ToastProvider.jsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type PropsWithChildren,
} from 'react'

type ToastOptions = { type?: 'info' | 'success' | 'error' | 'warning'; timeout?: number }
type Toast = { id: number; msg: string; type: 'info' | 'success' | 'error' | 'warning' }
const ToastContext = createContext<{ push: (msg: string, options?: ToastOptions) => void; clear: () => void }>({
  push: () => {},
  clear: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const clear = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    setToasts([])
  }, [])
  useEffect(() => {
    const pending = timers.current
    return () => { for (const timer of pending.values()) clearTimeout(timer); pending.clear() }
  }, [])

  const push = useCallback((msg: string, { type = 'info', timeout = 3500 }: ToastOptions = {}) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, msg, type }])
    if (timeout) {
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id)
        setToasts((t) => t.filter((x) => x.id !== id))
      }, timeout))
    }
  }, [])

  const value = useMemo(() => ({ push, clear }), [push, clear])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed inset-x-3 top-[4.75rem] z-[1600] flex flex-col gap-2 sm:inset-x-auto sm:right-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={`max-w-full break-words rounded-2xl px-4 py-3 text-sm shadow sm:max-w-sm ${
              t.type === 'error'
                ? 'bg-red-600 text-white'
                : t.type === 'success'
                  ? 'bg-green-600 text-white'
                  : 'bg-black text-white/90'
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
