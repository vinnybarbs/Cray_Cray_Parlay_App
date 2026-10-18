import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { mergeTracked, pruneTracked, itemTime } from './trackedKeys'

// The tracked bets list (owner 2026-10-16). One module level store the
// Track bet buttons and the Tracked page all read. The list lives in
// local storage on this device, and for a signed in user also in the
// tracked_bets table under RLS, written straight from the browser. On
// sign in the device list moves into the account, so nothing a visitor
// tracked before signing up is lost.

const STORAGE_KEY = 'traphawk.tracked.v1'

let items = load()
let userId = null
let synced = false
const listeners = new Set()

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return pruneTracked(Array.isArray(parsed) ? parsed : [])
  } catch { return [] }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch { /* private mode */ }
}

function set(next) {
  items = next
  save()
  listeners.forEach(fn => fn())
}

function rowFor(uid, it) {
  return {
    user_id: uid,
    item_key: it.key,
    kind: it.kind,
    item: it,
    game_time: itemTime(it) != null ? new Date(itemTime(it)).toISOString() : null,
    created_at: it.tracked_at || new Date().toISOString(),
  }
}

async function pull(uid) {
  try {
    const { data, error } = await supabase.from('tracked_bets').select('item_key, item, created_at').eq('user_id', uid)
    if (error) throw error
    const remote = (data || []).map(r => ({ ...r.item, key: r.item_key, tracked_at: r.item.tracked_at || r.created_at }))
    const remoteKeys = new Set(remote.map(r => r.key))
    const localOnly = items.filter(it => !remoteKeys.has(it.key))
    set(mergeTracked(items, remote))
    if (localOnly.length > 0) {
      const { error: upErr } = await supabase.from('tracked_bets').upsert(localOnly.map(it => rowFor(uid, it)), { onConflict: 'user_id,item_key' })
      if (upErr) throw upErr
    }
    synced = true
  } catch { /* the device copy stands until the next sign in or load */ }
}

/** Called by the hook when the signed in user changes. */
function setUser(uid) {
  if (uid === userId) return
  userId = uid || null
  synced = false
  if (userId) pull(userId)
}

export function isTracked(key) {
  return items.some(it => it.key === key)
}

export async function track(item) {
  if (!item?.key || isTracked(item.key)) return
  const it = { ...item, tracked_at: new Date().toISOString() }
  set(mergeTracked(items, [it]))
  if (userId) {
    try { await supabase.from('tracked_bets').upsert(rowFor(userId, it), { onConflict: 'user_id,item_key' }) } catch { /* local copy stands */ }
  }
}

export async function untrack(key) {
  if (!isTracked(key)) return
  set(items.filter(it => it.key !== key))
  if (userId) {
    try { await supabase.from('tracked_bets').delete().eq('user_id', userId).eq('item_key', key) } catch { /* local copy stands */ }
  }
}

/** Track several items at once, the legs of a parlay tracked together. */
export async function trackMany(list) {
  const now = new Date().toISOString()
  const fresh = (list || []).filter(it => it?.key && !isTracked(it.key)).map(it => ({ ...it, tracked_at: now }))
  if (fresh.length === 0) return
  set(mergeTracked(items, fresh))
  if (userId) {
    try { await supabase.from('tracked_bets').upsert(fresh.map(it => rowFor(userId, it)), { onConflict: 'user_id,item_key' }) } catch { /* local copy stands */ }
  }
}

/** Untrack several items at once, a whole parlay. */
export async function untrackMany(keys) {
  const drop = new Set((keys || []).filter(isTracked))
  if (drop.size === 0) return
  set(items.filter(it => !drop.has(it.key)))
  if (userId) {
    try { await supabase.from('tracked_bets').delete().eq('user_id', userId).in('item_key', [...drop]) } catch { /* local copy stands */ }
  }
}

export function toggle(item) {
  return isTracked(item.key) ? untrack(item.key) : track(item)
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const getSnapshot = () => items

/** The tracked list, live, with the account copy merged in when signed in. */
export function useTracked() {
  const { user } = useAuth()
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => { setUser(user?.id || null) }, [user?.id])
  return { items: list, isTracked: (key) => list.some(it => it.key === key), track, untrack, toggle, trackMany, untrackMany, synced }
}
