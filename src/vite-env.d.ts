/// <reference types="vite/client" />
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database.types'
declare global {
  interface Window {
    supabase?: SupabaseClient<Database>
    __APP_ENV__?: Record<string, string | undefined>
  }
}
