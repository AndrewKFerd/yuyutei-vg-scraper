// Push hint over Supabase Realtime Broadcast: the pipeline sends a message on
// the "catalog" channel after each upload (pipeline/notify-realtime.js), and
// this wakes the live-update check immediately instead of at the next poll.
// The message carries nothing the page trusts -- it only triggers a read of
// /api/meta -- so the anon key it uses can be public.
//
// Loaded on demand (its own chunk). With no VITE_SUPABASE_* configured, or if
// the socket never connects, connectRealtime resolves null and the page keeps
// polling.

const CHANNEL = 'catalog'
const EVENT = 'updated'

/**
 * Subscribes to the catalog channel.
 * @param {{ onUpdated: () => void, onStatus?: (connected: boolean) => void }} handlers
 * @returns {Promise<(() => void) | null>}  a function that disconnects, or null when push is unavailable
 */
export async function connectRealtime({ onUpdated, onStatus }) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  try {
    const { RealtimeClient } = await import('@supabase/realtime-js')
    const client = new RealtimeClient(`${url.replace(/^http/, 'ws').replace(/\/+$/, '')}/realtime/v1`, {
      params: { apikey: anonKey },
    })
    const channel = client.channel(CHANNEL, { config: { broadcast: { self: false } } })
    channel.on('broadcast', { event: EVENT }, () => onUpdated())
    channel.subscribe((status) => onStatus?.(status === 'SUBSCRIBED'))
    return () => {
      onStatus?.(false)
      channel.unsubscribe()
      client.disconnect()
    }
  } catch {
    return null
  }
}
