// src/components/ToastProvider.jsx
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'

const ToastContext = createContext({ push: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const push = useCallback((msg, { type = 'info', timeout = 3500 } = {}) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, type }])
    if (timeout) {
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), timeout)
    }
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed inset-x-3 top-3 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:top-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`max-w-full break-words rounded-2xl px-4 py-3 text-sm shadow sm:max-w-sm ${
              t.type === 'error' ? 'bg-red-600 text-white' : t.type === 'success' ? 'bg-green-600 text-white' : 'bg-black text-white/90'
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
