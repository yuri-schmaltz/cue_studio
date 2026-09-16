/**
 * Studio preference persistence: localStorage per-mode settings plus the
 * serialized server mirror of sticky choices.
 *
 * This is the persistence half of the Studio store. The in-memory store
 * keeps file-bearing / per-gen inputs for the current session; only the
 * persisted snapshot is pruned (see EPHEMERAL_PARAM_FIELDS below). Moving
 * this layer here keeps the write-on-location and read-on-boot logic
 * testable against a fake localStorage without instantiating the store.
 */
import type { StudioPreferenceUpdate } from '../api/client'
import type { GenerateParams, GenerationMode, StudioImageWorkflow, StudioVideoWorkflow } from '../types'
import {
  buildStudioPreferencePayload,
  durableGenerationMode,
  type StudioPreferenceState,
} from './studioPreferences'

export const STORAGE_KEY = 'cue-studio_mode_settings'

// Persistence schema version. Bump when changing the LoRA-key strategy or
// adding fields that need migration. Currently:
//   v1: savedLoraPerMode is keyed by lora_id (e.g. `civitai:12345`) instead
//       of filename, so settings survive LoRA version bumps. A snapshot of
//       lora_id → filename at save time is embedded for fast load-time
//       translation; reconciliation against the fresh map (fetched from
//       /api/v1/loras/installed) happens after boot in `loadModels()`.
export const PERSIST_VERSION = 1

export type LoraModeBlob = { activated_loras: string[]; loras_multipliers: string; loraWeights: Record<string, number[]>; availableLoras: string[] }

/** Per-mode params snapshot stored in localStorage. Holds whatever
 *  GenerateParams the user had set in that mode, plus a couple of
 *  top-level store fields (filmGrain*) that conceptually belong to
 *  the mode but live outside `params`. Each mode keeps its own
 *  complete snapshot so settings don't leak between modes — this
 *  fixed bugs where e.g. `repeat_generation: 10` set in image mode
 *  would queue up 10 videos when the user switched to video mode,
 *  or `video_prompt_type: 'KFI'` (frames injection) would persist
 *  on a mode where it didn't apply. Partial<GenerateParams> because
 *  the user almost never sets every field. */
export type SavedModeParams = Partial<GenerateParams> & {
  filmGrainIntensity?: number
  filmGrainSaturation?: number
  /** Top-level store field (NOT in GenerateParams), saved per-mode so
   *  audio's 600/1800 slider.max doesn't leak into video on mode switch.
   *  See setGenerationMode for the save/restore wiring. */
  durationSeconds?: number
}

export interface PersistedModeSettings {
  generationMode: GenerationMode
  selectedModelPerMode: Partial<Record<GenerationMode, string>>
  savedParamsPerMode: Partial<Record<GenerationMode, SavedModeParams>>
  /** Runtime shape (filename-keyed). The on-disk shape is lora_id-keyed
   *  starting with v1; the persistence layer translates transparently. */
  savedLoraPerMode: Partial<Record<GenerationMode, LoraModeBlob>>
  /** Per-mode main prompt (lyrics in audio mode). Tracked separately from
   *  the params snapshot in memory. Still written for shape stability but
   *  NO LONGER rehydrated on boot — a refresh starts with a clean prompt
   *  (see the partial-hydration note in loadModels). */
  savedPromptPerMode?: Partial<Record<GenerationMode, string>>
  /** Small UI choices that intentionally survive a full restart. Working
   *  prompts, media, seeds, LoRAs, and general Advanced values do not. */
  studioVideoWorkflow?: StudioVideoWorkflow
  studioImageWorkflow?: StudioImageWorkflow
  audioSubMode?: import('../types').AudioSubMode
  selectedModelPerAudioSubMode?: Partial<Record<import('../types').AudioSubMode, string>>
  h3OptimizationPreferences?: {
    override_attention?: '' | 'sol' | 'sla' | 'sdpa'
    skip_steps_cache_type?: '' | 'first_block'
    skip_steps_multiplier?: number
    skip_steps_start_step_perc?: number
  }
  /** Snapshot of lora_id → filename captured at last save. Returned by
   *  `loadModeSettings` for use in mid-session reconciliation when the fresh
   *  lora map arrives, so we can rewrite filenames that changed since save. */
  _loraFilenameSnapshot?: Record<string, string>
}

/** Build a lora_id-keyed copy of a single LoraModeBlob using filename → lora_id.
 *
 *  Multi-version disambiguation: if two filenames in the same blob share a
 *  lora_id (e.g. user keeps v1 + v2 of the same CivitAI model on disk for
 *  A/B testing), use a `{lora_id}#{filename}` suffix for the collision so
 *  each file's settings persist independently. Without this, the second
 *  file's loraWeights overwrite the first's via Object.fromEntries, and
 *  cross-session A/B silently loses one version's weights. */
export function modeBlobToLoraIdKeyed(
  m: LoraModeBlob,
  filenameToLoraId: Record<string, string>
): LoraModeBlob {
  const baseId = (fname: string) => filenameToLoraId[fname] || `local:${fname}`
  // Detect collisions across the whole blob: count how many filenames in
  // (activated_loras ∪ loraWeights ∪ availableLoras) map to each base id.
  const idCounts: Record<string, number> = {}
  const seen = new Set<string>([
    ...(m.activated_loras || []),
    ...Object.keys(m.loraWeights || {}),
    ...(m.availableLoras || []),
  ])
  for (const fname of seen) {
    const bid = baseId(fname)
    idCounts[bid] = (idCounts[bid] || 0) + 1
  }
  const id = (fname: string): string => {
    const bid = baseId(fname)
    return (idCounts[bid] || 0) > 1 ? `${bid}#${fname}` : bid
  }
  return {
    ...m,
    activated_loras: (m.activated_loras || []).map(id),
    loraWeights: Object.fromEntries(
      Object.entries(m.loraWeights || {}).map(([fname, w]) => [id(fname), w])
    ),
    availableLoras: (m.availableLoras || []).map(id),
  }
}

/** Reverse: lora_id-keyed blob → filename-keyed using lora_id → filename map.
 *
 *  Disambiguated keys (`{loraId}#{filename}`) carry the filename in the
 *  suffix — extract it directly so multi-version A/B state round-trips
 *  losslessly. */
export function modeBlobToFilenameKeyed(
  m: LoraModeBlob,
  loraIdToFilename: Record<string, string>
): LoraModeBlob {
  const fname = (id: string): string => {
    const hashIdx = id.indexOf('#')
    if (hashIdx > 0) return id.slice(hashIdx + 1)
    return loraIdToFilename[id] || (id.startsWith('local:') ? id.slice(6) : id)
  }
  return {
    ...m,
    activated_loras: (m.activated_loras || []).map(fname),
    loraWeights: Object.fromEntries(
      Object.entries(m.loraWeights || {}).map(([id, w]) => [fname(id), w])
    ),
    availableLoras: (m.availableLoras || []).map(fname),
  }
}

/** Fields in SavedModeParams that hold file paths or per-gen ephemeral
 *  inputs which should NEVER persist across browser sessions. Persisting
 *  these caused the "ghost reference" bug: on page reload the cached
 *  paths would rehydrate from localStorage and the next generation
 *  would submit them, so users would silently get image-to-image edits
 *  against stale uploads they no longer had selected. Same pattern hit
 *  frame-injection positions in LTX-2 video mode and audio guide refs
 *  in TTS modes.
 *
 *  Rule of thumb: anything pointing to a path under app/uploads/ or any
 *  ephemeral per-job input belongs here. Anything the user genuinely
 *  wants remembered (model settings, slider values, video_prompt_type
 *  letter codes, etc.) stays out of this list and continues to persist.
 *
 *  Workaround for users on a Maestro version before this fix: use a
 *  private/incognito browser window (skips localStorage rehydration).
 */
const EPHEMERAL_PARAM_FIELDS: ReadonlyArray<keyof SavedModeParams> = [
  'image_start',
  'image_end',
  'image_refs',
  'image_guide',
  'image_mask',
  'video_guide',
  'video_mask',
  'video_source',
  'audio_guide',
  'audio_guide2',
  'audio_guide3',
  'audio_guide4',
  'audio_guide5',
  'audio_guide6',
  'frames_positions',
]

export function stripEphemeralParams(perMode: Partial<Record<GenerationMode, SavedModeParams>>): Partial<Record<GenerationMode, SavedModeParams>> {
  const cleaned: Partial<Record<GenerationMode, SavedModeParams>> = {}
  for (const [mode, params] of Object.entries(perMode || {})) {
    if (!params) continue
    const copy: SavedModeParams = { ...params }
    for (const field of EPHEMERAL_PARAM_FIELDS) {
      delete copy[field]
    }
    // The "T" temporal-alignment flag only means something alongside a
    // video_source — which is ephemeral-stripped above. Persisting a lone
    // "T" produced a ghost Advanced badge (counts as an active process
    // choice while displaying as nothing). Strip it on the way in AND out
    // so existing users' stale snapshots heal on next load. Only a TRAILING
    // "T" is the flag — an internal "T" is the depth_temporal control letter
    // (TVG/PTVG/TEVG) and a global strip silently downgraded those to plain
    // pose/spatial, so use /T$/.
    if (typeof copy.video_prompt_type === 'string' && copy.video_prompt_type.endsWith('T')) {
      copy.video_prompt_type = copy.video_prompt_type.replace(/T$/, '')
    }
    cleaned[mode as GenerationMode] = copy
  }
  return cleaned
}

/**
 * Persist mode settings. The on-disk shape is lora_id-keyed (so that
 * filename changes from LoRA version bumps are transparent on reload),
 * with an embedded `_loraFilenameSnapshot` so the next load can translate
 * back to filenames immediately without waiting for the fresh map.
 *
 * If no map is provided (e.g. very early in boot before /installed has
 * returned), we skip translation and write the legacy filename-keyed shape
 * with no version flag. The next save with a populated map will upgrade it.
 */
export function saveModeSettings(
  state: PersistedModeSettings,
  filenameToLoraId?: Record<string, string>,
) {
  try {
    // Older save call sites intentionally pass only the core per-mode state.
    // Preserve the explicitly sticky UI fields already on disk so a later
    // LoRA/model save cannot accidentally erase them.
    let previous: Partial<PersistedModeSettings> = {}
    try {
      previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    } catch { /* malformed legacy storage is replaced below */ }
    const sticky = {
      studioVideoWorkflow: state.studioVideoWorkflow ?? previous.studioVideoWorkflow,
      studioImageWorkflow: state.studioImageWorkflow ?? previous.studioImageWorkflow,
      audioSubMode: state.audioSubMode ?? previous.audioSubMode,
      selectedModelPerAudioSubMode: state.selectedModelPerAudioSubMode ?? previous.selectedModelPerAudioSubMode,
      h3OptimizationPreferences: state.h3OptimizationPreferences ?? previous.h3OptimizationPreferences,
    }
    // Strip file-bearing / ephemeral fields BEFORE serializing so they
    // never round-trip through localStorage. The in-memory store keeps
    // them for the current session; only the persisted snapshot is
    // pruned. See EPHEMERAL_PARAM_FIELDS comment for the full rationale.
    const sanitizedParamsPerMode = stripEphemeralParams(state.savedParamsPerMode || {})

    if (filenameToLoraId && Object.keys(filenameToLoraId).length > 0) {
      // Translate savedLoraPerMode → lora_id keys
      const translatedPerMode: Partial<Record<GenerationMode, LoraModeBlob>> = {}
      for (const [mode, m] of Object.entries(state.savedLoraPerMode || {})) {
        if (m) translatedPerMode[mode as GenerationMode] = modeBlobToLoraIdKeyed(m, filenameToLoraId)
      }
      // Snapshot: lora_id → filename (so load can translate back instantly)
      const snapshot: Record<string, string> = {}
      for (const [fname, id] of Object.entries(filenameToLoraId)) snapshot[id] = fname
      const payload = {
        _version: PERSIST_VERSION,
        _loraFilenameSnapshot: snapshot,
        generationMode: state.generationMode,
        selectedModelPerMode: state.selectedModelPerMode,
        savedParamsPerMode: sanitizedParamsPerMode,
        savedLoraPerMode: translatedPerMode,
        savedPromptPerMode: state.savedPromptPerMode,
        ...sticky,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } else {
      // No map yet — write legacy filename-keyed shape, no version. Will be
      // upgraded on next save with a populated map. Still apply the ephemeral
      // strip on the way out.
      const sanitizedState = {
        ...state,
        ...sticky,
        savedParamsPerMode: sanitizedParamsPerMode,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizedState))
    }
  } catch { /* quota exceeded or private browsing */ }
}

export function loadModeSettings(): PersistedModeSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // v1+: savedLoraPerMode is lora_id-keyed; use the embedded snapshot to
    // translate back to filenames immediately. Reconciliation against the
    // fresh map happens in loadModels() once /installed returns.
    if (parsed && parsed._version === PERSIST_VERSION && parsed._loraFilenameSnapshot) {
      const snapshot: Record<string, string> = parsed._loraFilenameSnapshot
      const translated: Partial<Record<GenerationMode, LoraModeBlob>> = {}
      for (const [mode, m] of Object.entries(parsed.savedLoraPerMode || {})) {
        if (m) translated[mode as GenerationMode] = modeBlobToFilenameKeyed(m as LoraModeBlob, snapshot)
      }
      return {
        generationMode: parsed.generationMode,
        selectedModelPerMode: parsed.selectedModelPerMode || {},
        // Strip ephemeral file-bearing fields at load too — protects existing
        // users whose localStorage was written by a pre-fix version and still
        // contains stale image_start / image_refs / etc. paths. New saves will
        // be already-clean from saveModeSettings; this is the migration safety
        // net so the first post-update page load can't immediately rehydrate
        // ghost references.
        savedParamsPerMode: stripEphemeralParams(parsed.savedParamsPerMode || {}),
        savedLoraPerMode: translated,
        savedPromptPerMode: parsed.savedPromptPerMode || {},
        studioVideoWorkflow: parsed.studioVideoWorkflow,
        studioImageWorkflow: parsed.studioImageWorkflow,
        audioSubMode: parsed.audioSubMode,
        selectedModelPerAudioSubMode: parsed.selectedModelPerAudioSubMode || {},
        h3OptimizationPreferences: parsed.h3OptimizationPreferences || {},
        _loraFilenameSnapshot: snapshot,
      }
    }
    // Legacy (no version): blob is already filename-keyed, return as-is —
    // but still strip ephemeral fields out for the same migration-safety reason.
    const legacy = parsed as PersistedModeSettings
    return {
      ...legacy,
      savedParamsPerMode: stripEphemeralParams(legacy.savedParamsPerMode || {}),
    }
  } catch { return null }
}

/** State consumed by `persistStickyStudioPreferences`. */
export type StickyStudioState = StudioPreferenceState & {
  savedParamsPerMode: Partial<Record<GenerationMode, SavedModeParams>>
  savedLoraPerMode: Partial<Record<GenerationMode, LoraModeBlob>>
  savedPromptPerMode?: Partial<Record<GenerationMode, string>>
  loraIdByFilename: Record<string, string>
}

/** Serialized chain for the server mirror of sticky preferences. */
let _preferencesSaveTask: Promise<void> = Promise.resolve()

/** Persist only navigation/model choices and H3 acceleration preferences.
 *  This deliberately does not restore project state, prompts, uploads,
 *  seeds, LoRAs, or general Advanced controls. The server mirror makes the
 *  choices survive Pinokio assigning a different browser origin/port.
 *
 *  `saveSettings` writes the localStorage half; `updatePreferences` mirrors
 *  it to the backend. Both are injected so this module stays pure for tests
 *  (the localStorage half is covered directly, and the API task chain can be
 *  asserted without a network stack). */
export function persistStickyStudioPreferences(
  state: StickyStudioState,
  saveSettings: (settings: PersistedModeSettings, filenameToLoraId?: Record<string, string>) => void,
  updatePreferences: (update: StudioPreferenceUpdate) => Promise<unknown>,
): void {
  const persistedGenerationMode = durableGenerationMode(state)
  const h3OptimizationPreferences = state.h3OptimizationPreferences
  saveSettings({
    generationMode: persistedGenerationMode,
    selectedModelPerMode: state.selectedModelPerMode,
    savedParamsPerMode: state.savedParamsPerMode,
    savedLoraPerMode: state.savedLoraPerMode,
    savedPromptPerMode: state.savedPromptPerMode,
    studioVideoWorkflow: state.studioVideoWorkflow,
    studioImageWorkflow: state.studioImageWorkflow,
    audioSubMode: state.audioSubMode,
    selectedModelPerAudioSubMode: state.selectedModelPerAudioSubMode,
    h3OptimizationPreferences,
  }, state.loraIdByFilename)

  const update = buildStudioPreferencePayload(state)
  _preferencesSaveTask = _preferencesSaveTask
    .catch(() => { /* a later preference save should still run */ })
    .then(async () => {
      await updatePreferences(update)
    })
    .catch(error => {
      console.warn('Failed to save Studio preferences:', error)
    })
}