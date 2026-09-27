/**
 * Pure helpers extracted from useStore.ts. These do not depend on the
 * store state and are safe to import from anywhere without dragging the
 * entire store graph into the bundle.
 *
 * Anything that mutates state, talks to localStorage, the api client,
 * or window/fetch stays in useStore.ts.
 */

import type { CivitAIDownload, PipelineRepairState, GenerateParams } from '../types'
import type { SavedModeParams } from './studioPersistence'

// --- Outpaint aspect (used both inside the store and by inference helpers) ---

export type OutpaintAspect = 'source' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4'

export const OUTPAINT_ASPECT_RATIOS: Array<[Exclude<OutpaintAspect, 'source'>, number]> = [
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
]

// --- Generic record/string coercion ---

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

// --- H3 sliding window overlap normalization ---

export function normalizeSlidingWindowOverlap(
  value: number,
  defaults?: Record<string, number> | null,
): number {
  if (!defaults) return Math.max(0, Math.round(value))
  const minimum = defaults.overlap_min ?? 1
  const maximum = defaults.overlap_max ?? Math.max(minimum, value)
  const step = Math.max(1, defaults.overlap_step ?? 1)
  const offset = defaults.overlap_offset ?? minimum
  const normalized = offset + Math.round((value - offset) / step) * step
  return Math.max(minimum, Math.min(maximum, normalized))
}

// --- Outpaint aspect inference from pixel dimensions ---

export function inferOutpaintAspect(width: number, height: number): OutpaintAspect | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const ratio = width / height
  let nearest: Exclude<OutpaintAspect, 'source'> | null = null
  let nearestError = Number.POSITIVE_INFINITY
  for (const [aspect, target] of OUTPAINT_ASPECT_RATIOS) {
    const relativeError = Math.abs(ratio - target) / target
    if (relativeError < nearestError) {
      nearest = aspect
      nearestError = relativeError
    }
  }
  // Grid alignment can move either dimension by several pixels. Four percent
  // safely recognizes those canvases without pretending an arbitrary ratio
  // is one of the six choices supported by the composer.
  return nearestError <= 0.04 ? nearest : null
}

// --- Pipeline repair polling status check ---

const DIRECTOR_REPAIR_ACTIVE_STATUSES = new Set(['queued', 'running', 'cancelling'])

export function repairNeedsPolling(repair: PipelineRepairState | null | undefined): boolean {
  return !!repair && DIRECTOR_REPAIR_ACTIVE_STATUSES.has(repair.status)
}

// --- Director LoRA state coercion (API payload → typed record) ---

interface DirectorLoraState {
  activated_loras: string[]
  loras_multipliers: string
  loraWeights: Record<string, number[]>
  availableLoras: string[]
}

export function directorLoraState(value: unknown): DirectorLoraState {
  const source = record(value)
  return {
    activated_loras: stringArray(source.activated_loras),
    loras_multipliers: typeof source.loras_multipliers === 'string'
      ? source.loras_multipliers : '',
    loraWeights: record(source.loraWeights) as Record<string, number[]>,
    availableLoras: stringArray(source.availableLoras),
  }
}

// --- Asset filename extraction (used by Director image asset previews) ---

export function assetName(path: string | null | undefined, fallback: string): string {
  const normalized = String(path || '').replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || fallback
}

export function directorAssetItem(
  manifest: Record<string, unknown>,
  key: string,
  index?: number,
): Record<string, unknown> {
  const raw = manifest[key]
  const value = index == null
    ? raw
    : Array.isArray(raw) ? raw[index] : undefined
  return record(value)
}

export function directorServePath(
  manifest: Record<string, unknown>,
  key: string,
  fallbackPath?: string | null,
  index?: number,
): string | null {
  const item = directorAssetItem(manifest, key, index)
  const served = typeof item.serve_path === 'string' ? item.serve_path : ''
  if (served) return served
  // Legacy projects usually stored a plain workspace filename. Absolute
  // filesystem paths are deliberately reduced to their basename because the
  // file endpoint never accepts arbitrary host paths.
  return fallbackPath ? assetName(fallbackPath, '') || null : null
}

// --- CivitAI download timestamp normalization ---

/**
 * Normalize a CivitAI timestamp to milliseconds. Accepts seconds (10-digit)
 * or milliseconds (13-digit) and returns null when the value is missing,
 * zero, or not a finite number.
 */
export function downloadTimestampMs(value: number | null | undefined): number | null {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

/**
 * A completed download should keep polling for a short grace window so
 * the UI can show a "100% / done" state without disappearing instantly.
 */
export function downloadNeedsPolling(download: CivitAIDownload, now: number): boolean {
  if (download.status === 'downloading') return true
  if (download.status !== 'completed') return false
  const completedAt = downloadTimestampMs(download.completed_at)
  // 5 seconds is enough for the status toast to render once.
  return completedAt !== null && now - completedAt < 5_000
}

export function waitForDownloadPoll(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = window.setTimeout(done, ms)
    function done() {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

// --- Mode params snapshot/restore (persistence shape, pure projection) ---

const EPHEMERAL_PARAM_KEYS = ['model_type', 'prompt', 'activated_loras', 'loras_multipliers'] as const
const RESTORE_STRIP_KEYS = ['filmGrainIntensity', 'filmGrainSaturation', 'durationSeconds'] as const

export function snapshotModeParams(params: GenerateParams): SavedModeParams {
  const snapshot: SavedModeParams = { ...params }
  for (const key of EPHEMERAL_PARAM_KEYS) {
    delete (snapshot as Record<string, unknown>)[key]
  }
  return snapshot
}

export function restoreModeParams(snapshot?: SavedModeParams): Partial<GenerateParams> {
  const restored: SavedModeParams = { ...(snapshot || {}) }
  for (const key of RESTORE_STRIP_KEYS) {
    delete (restored as Record<string, unknown>)[key]
  }
  return restored
}
