import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Single Supabase client for the app. URL + publishable key are safe in the
// browser (public by design) because every table is protected by Row Level
// Security (members-only). Defaults let the deployed build work with no env
// config; override via VITE_SUPABASE_* for a different backend.
const DEFAULT_URL = 'https://jvjhqdwlhaggoqsnenfw.supabase.co'
const DEFAULT_KEY = 'sb_publishable_f0DmKuM5XGy5YXikIgoLNw_bNjJjPPb'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_KEY

export const supabaseReady = !!(url && key)

export const supabase: SupabaseClient = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})
