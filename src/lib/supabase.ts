import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Single Supabase client for the app. URL + publishable key are safe in the
// browser because every table is protected by Row Level Security (members-only).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseReady = !!(url && key)

export const supabase: SupabaseClient = createClient(url || 'http://localhost', key || 'anon', {
  auth: { persistSession: true, autoRefreshToken: true },
})
