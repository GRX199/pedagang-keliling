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
      <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded shadow text-sm max-w-sm ${
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
