import { createClient } from '@supabase/supabase-js'

// The publishable (anon) key is designed to live in client bundles. Data
// access is protected by RLS, not by hiding this key. Baking the defaults in
// removes the silent-failure mode where a build without VITE_ env vars
// shipped a null client and every auth surface reported "not configured"
// (bit us on the traphawk.io cutover, 2026-07-12). Env vars still override.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  || 'https://pcjhulzyqmhrhsrgvwvx.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  || 'sb_publishable_qowqvYmWYRgCNDYZxkfV8g_nFh-_kkr'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
