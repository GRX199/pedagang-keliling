// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_PUBLIC_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY in .env.local')
  // don't throw here to avoid breaking HMR; but UI will show errors if used
}

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_PUBLIC_KEY ?? '')

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.supabase = supabase
  window.__APP_ENV__ = {
    VITE_SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_BUCKET: import.meta.env.VITE_SUPABASE_BUCKET,
    VITE_SERVER_URL: import.meta.env.VITE_SERVER_URL,
  }
}
