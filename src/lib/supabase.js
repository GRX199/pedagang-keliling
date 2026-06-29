// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_PUBLIC_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY
const REMEMBER_SESSION_KEY = 'kelilingku:remember-session'

if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY in .env.local')
  // don't throw here to avoid breaking HMR; but UI will show errors if used
}

function getAuthStorage() {
  if (typeof window === 'undefined') return undefined

  return {
    getItem(key) {
      let rememberSession = window.localStorage.getItem(REMEMBER_SESSION_KEY) === '1'
      if (!rememberSession && window.localStorage.getItem(key) && !window.sessionStorage.getItem(key)) {
        window.localStorage.setItem(REMEMBER_SESSION_KEY, '1')
        rememberSession = true
      }
      return (rememberSession ? window.localStorage : window.sessionStorage).getItem(key)
    },
    setItem(key, value) {
      const rememberSession = window.localStorage.getItem(REMEMBER_SESSION_KEY) === '1'
      const primaryStorage = rememberSession ? window.localStorage : window.sessionStorage
      const secondaryStorage = rememberSession ? window.sessionStorage : window.localStorage
      primaryStorage.setItem(key, value)
      secondaryStorage.removeItem(key)
    },
    removeItem(key) {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    },
  }
}

export function setRememberSessionPreference(rememberSession) {
  if (typeof window === 'undefined') return

  if (rememberSession) {
    window.localStorage.setItem(REMEMBER_SESSION_KEY, '1')
  } else {
    window.localStorage.removeItem(REMEMBER_SESSION_KEY)
  }

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
        storage.removeItem(key)
      }
    }
  }
}

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_PUBLIC_KEY ?? '', {
  auth: {
    persistSession: true,
    storage: getAuthStorage(),
  },
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.supabase = supabase
  window.__APP_ENV__ = {
    VITE_SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_BUCKET: import.meta.env.VITE_SUPABASE_BUCKET,
    VITE_SERVER_URL: import.meta.env.VITE_SERVER_URL,
  }
}
