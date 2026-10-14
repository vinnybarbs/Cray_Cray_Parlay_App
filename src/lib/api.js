import { supabase } from './supabaseClient'
import { API_BASE_URL as API_BASE } from '../config'

// fetch with the signed in user's token, so the server can tell a Pro
// member from a visitor when the paywall is on. A visitor's request is
// the same plain fetch it always was.
export async function apiFetch(path, opts = {}) {
  let token = null
  try {
    const { data } = await supabase.auth.getSession()
    token = data?.session?.access_token || null
  } catch { /* signed out */ }
  const headers = { ...(opts.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(`${API_BASE}${path}`, { ...opts, headers })
}
