// Lightweight client-side telemetry (A24).
//
// Opt-in (localStorage `cue-telemetry-optin` === '1'). Payloads are
// sanitized to drop PII (prompts, media, absolute paths, tokens). The
// transport is best-effort over apiFetch; failures are swallowed so
// telemetry never breaks the app or blocks the UI.

import { apiFetch } from '../api/transport'

export const TELEMETRY_OPT_IN_KEY = 'cue-telemetry-optin'

const PII_KEY_FRAGMENTS = [
  'prompt',
  'media',
  'path',
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'file',
  'image',
  'video',
  'audio',
]

function isPiiKey(key: string): boolean {
  const k = key.toLowerCase()
  return PII_KEY_FRAGMENTS.some((frag) => k.includes(frag))
}

export function isTelemetryEnabled(): boolean {
  try {
    return localStorage.getItem(TELEMETRY_OPT_IN_KEY) === '1'
  } catch {
    return false
  }
}

export function setTelemetryEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(TELEMETRY_OPT_IN_KEY, '1')
    else localStorage.removeItem(TELEMETRY_OPT_IN_KEY)
  } catch {
    /* ignore */
  }
}

export function sanitizeTelemetryFields(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!input || typeof input !== 'object') return out
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isPiiKey(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      // Drop anything that looks like an absolute path or a token-ish
      // blob.
      if (value.startsWith('/') || value.startsWith('\\') || value.length > 256) continue
      out[key] = value
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
    } else if (Array.isArray(value)) {
      const cleaned = value
        .map((v) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null))
        .filter((v) => v !== null)
      if (cleaned.length) out[key] = cleaned
    } else if (typeof value === 'object') {
      const nested = sanitizeTelemetryFields(value)
      if (Object.keys(nested).length) out[key] = nested
    }
  }
  return out
}

export async function emitTelemetry(name: string, fields?: Record<string, unknown>): Promise<void> {
  if (!isTelemetryEnabled()) return
  const payload = {
    ts: Date.now(),
    name,
    ...sanitizeTelemetryFields(fields),
  }
  try {
    await apiFetch('/api/v1/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    /* degrade gracefully */
  }
}
