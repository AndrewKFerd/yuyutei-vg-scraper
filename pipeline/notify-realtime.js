'use strict';

/**
 * Tells connected browsers that a new catalog is out, over Supabase Realtime
 * Broadcast (no table involved). The message is only a hint: clients answer it
 * by reading /api/meta, so a missing, late or spoofed one costs nothing but
 * a poll. Everything here is best-effort -- upload-cards.js never fails a run
 * over it.
 *
 * Needs SUPABASE_URL (https://<ref>.supabase.co) and SUPABASE_SERVICE_KEY in
 * the environment (see .env.example); without them it does nothing.
 */

const CHANNEL_TOPIC = 'catalog';
const CHANNEL_EVENT = 'updated';
const TIMEOUT_MS = 10 * 1000;

/** The broadcast request body for a new catalog. */
function buildBroadcastBody(generatedAt) {
  return {
    messages: [{ topic: CHANNEL_TOPIC, event: CHANNEL_EVENT, payload: { generatedAt }, private: false }],
  };
}

/**
 * Sends the broadcast. Resolves { sent, reason? }; never rejects.
 * `fetchImpl` and `env` are injectable for tests.
 */
async function notifyRealtime(generatedAt, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!base || !key) return { sent: false, reason: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not set' };
  try {
    const res = await fetchImpl(`${base.replace(/\/+$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildBroadcastBody(generatedAt)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { sent: false, reason: `HTTP ${res.status}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

module.exports = { CHANNEL_TOPIC, CHANNEL_EVENT, buildBroadcastBody, notifyRealtime };
