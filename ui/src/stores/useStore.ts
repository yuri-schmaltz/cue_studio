import { createStudioGenerationSlice } from './studioGenerationSlice'
import { directorStepForPipelineStatus as _directorStepForPipelineStatus, computeDirectorActivity as _computeDirectorActivity, type DirectorStep } from './directorActivity'
import { createStudioModelSlice } from './studioModelSlice'
import { studioModelRuntime } from './studioModelRuntime'
import { createStudioModeSlice } from './studioModeSlice'
import { createDirectorFinishingSlice } from './directorFinishingSlice'
import { trackAnalysisProgress } from './analysisProgress'
import type { SceneSlot } from '../lib/directorTimeline'
import { create } from 'zustand'
import { reorderWindowPrompts } from '../lib/reorderWindowPrompts'
import { canonicalDirectorSkill } from '../types'
import type { DirectorError } from './directorError'
import type { GenerateParams, OutputFile, MediaFilter, AspectRatio, ResolutionPreset, ScailResolutionProfile, GenerationJob, ModelFamily, ModelDef, GenerationMode, StudioVideoWorkflow, StudioVideoCreateRoute, StudioVideoEffectiveCreateRoute, StudioImageWorkflow, ModelOptions, SystemConfig, SettingsTab, OutputMetadata, MultiClip, ServicesConfig, LlmStatus, LlmModelOption, LlmRolesState, AudioAnalysisResult, PlannedClip, ClipPlan, DirectorClipImage, DirectorImageGenProgress, DirectorAnalyzeProgress, SpeakerMapping, DirectorSkill, DirectorShotImageGuidance, ShortFilmCharacter, ShortFilmPath, CivitAIModel, CivitAIDownload, PipelineClipState, SavedPipelineState, DirectorQueueState, SystemDetectResponse, SystemStats, RecastCharacterMapping, RepaintRegionMapping, H3WindowPlan, MiniMaxH3Reference, AppMode, AppSection, ProjectSetupDefaults, ProjectsRootInfo, Workspace } from '../types'
import * as api from '../api/client'
import { applyThemePrefs, getStoredPrefs, type FamilyId, type ThemeMode, type ThemePrefs } from '../lib/theme'
import { applyDensity, getStoredDensity, type Density } from '../lib/density'
import {
  effectiveH3OmniSequenceFrames,
  h3WindowOverrideKey,
  normalizeH3ClipFrameSchedule,
  normalizeH3NativeFrames,
} from '../lib/h3Memory'
import {
  continuationFirstWindowFrames,
  durationWindowPlan,
} from '../lib/durationPlanning'
import { resolvedGenerationPlan, type ReviewPlan } from '../lib/generationPlan'
import { createWorkspaceSlice } from './workspaceSlice'
import { createStudioWorkflowSlice } from './studioWorkflowSlice'
import { createLlmSlice } from './llmSlice'
import { createDirectorQueueSlice } from './directorQueueSlice'
import { createRecipesSlice } from './recipesSlice'
import { createCivitAISlice } from './civitaiSlice'
import { createMediaOutputsSlice, computeFilteredOutputs } from './mediaOutputsSlice'
import { createShortFilmSlice } from './shortFilmSlice'
import { createDirectorPlanningSlice, DIRECTOR_NEGATIVE_PROMPT_DEBOUNCE_MS, DIRECTOR_PIPELINE_ACTIVE } from './directorPlanningSlice'
import {
  loadModeSettings as _loadSettings,
  persistStickyStudioPreferences,
  saveModeSettings as _saveSettings,
  type SavedModeParams,
} from './studioPersistence'
import {
  assetName as _assetName,
  directorAssetItem as _directorAssetItem,
  directorLoraState as _directorLoraState,
  directorServePath as _directorServePath,
  downloadNeedsPolling as _downloadNeedsPolling,
  normalizeSlidingWindowOverlap as _normalizeSlidingWindowOverlap,
  record as _record,
  restoreModeParams as _restoreModeParams,
  snapshotModeParams as _snapshotModeParams,
  stringArray as _stringArray,
  waitForDownloadPoll as _waitForDownloadPoll,
} from './utils'

let _directorAnalysisSequence = 0

// Debounce handle for auto-regenerating the project-scoped negative
// prompt from the scene description. Previously this fired on every
// onChange keystroke (which translates to one full LLM call per
// character typed) — a single 200-char brief would queue ~200 HTTP
// calls and ~15 minutes of blocked Ollama time. 1.2s of typing
// silence is the standard "user paused" signal.
let _directorNegativePromptDebounce: ReturnType<typeof setTimeout> | null = null

let _reviewSnapshot: AppState | null = null
let _reviewRequestToken = 0
// Holds the AbortController for the currently running Director v2 plan
// request ("Writing scenes...", "Writing image/video prompts..."). Lets the
// UI cancel the in-flight fetch without waiting for the server-side LLM
// call to finish — the worker thread keeps generating but the client stops
// waiting and resets loading state immediately.
let _directorV2PlanController: AbortController | null = null
// Stop handles for the Director analyze / track / image-generation
// flows. Sequence counters invalidate stale continuations (same pattern
// as _directorAnalysisSequence); controllers abort the in-flight HTTP
// request; the job id lets image generation cancel its Studio job
// server-side. Each cancel action below guards on its own phase so the
// unified cancelPlan() can call them unconditionally.
let _directorAnalyzeController: AbortController | null = null
let _directorAnalyzeStopPoll: (() => void) | null = null
let _directorTrackGenSequence = 0
let _directorTrackGenPoll: ReturnType<typeof setInterval> | null = null
let _directorTrackGenController: AbortController | null = null
let _directorImageGenSequence = 0
let _directorImageGenJob: string | null = null
let _directorImageGenPoll: ReturnType<typeof setInterval> | null = null
let _directorPipelineAttachToken = 0
let _directorPipelineReconnectAttempted = false
let _directorPipelinePollToken = 0
let _h3WindowOverrideSaveTask: Promise<void> = Promise.resolve()
const STUDIO_VIDEO_CREATE_ROUTE_KEY = 'cue-studio_studio_video_create_route_v1'

type StudioVideoRoutePreferences = {
  route: StudioVideoCreateRoute
  models: Partial<Record<StudioVideoEffectiveCreateRoute, string>>
}

function _loadStudioVideoRoutePreferences(): StudioVideoRoutePreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STUDIO_VIDEO_CREATE_ROUTE_KEY) || '{}')
    return {
      // Creation-path controls were removed in v2. Media roles always own
      // routing now, so ignore any pinned route saved by an older UI.
      route: 'auto',
      models: parsed.models && typeof parsed.models === 'object' ? parsed.models : {},
    }
  } catch {
    return { route: 'auto', models: {} }
  }
}

function _saveStudioVideoRoutePreferences(preferences: StudioVideoRoutePreferences) {
  try {
    localStorage.setItem(STUDIO_VIDEO_CREATE_ROUTE_KEY, JSON.stringify(preferences))
  } catch { /* private browsing or blocked storage */ }
}

const _initialStudioVideoRoutePreferences = _loadStudioVideoRoutePreferences()

function _adaptiveEtaJobFields(status: api.ApiJobStatus): Partial<GenerationJob> {
  return {
    currentClip: status.current_clip,
    totalClips: status.total_clips,
    currentWindow: status.current_window,
    totalWindows: status.total_windows,
    windowEtaSeconds: status.window_eta_seconds,
    clipEtaSeconds: status.clip_eta_seconds,
    generationEtaSeconds: status.generation_eta_seconds,
    projectEtaSeconds: status.project_eta_seconds,
    windowCompletionAt: status.window_completion_at,
    clipCompletionAt: status.clip_completion_at,
    generationCompletionAt: status.generation_completion_at,
    projectCompletionAt: status.project_completion_at,
    etaConfidence: status.eta_confidence,
    etaBasis: status.eta_basis,
    etaHistorySamples: status.eta_history_samples,
    etaHistoryMatch: status.eta_history_match,
  }
}

function _saveH3WindowOverrides(overrides: Record<string, number>) {
  _h3WindowOverrideSaveTask = _h3WindowOverrideSaveTask
    .catch(() => { /* a later save should still run */ })
    .then(async () => {
      await api.updateH3WindowOverrides(overrides)
    })
    .catch(error => {
      console.warn('Failed to save H3 window overrides:', error)
    })
}

function _omniEnhanceInventory(references: MiniMaxH3Reference[]): {
  imagePaths: string[]
  referenceContext?: string
} {
  let pictureIndex = 0
  let videoIndex = 0
  let audioIndex = 0
  const imagePaths: string[] = []
  const labelLines: string[] = []
  const savedCharacterMedia = new Map<string, { name: string; labels: string[] }>()
  const bindSavedCharacter = (reference: MiniMaxH3Reference, label: string) => {
    if (!reference.library_character_id) return
    const name = (reference.character_name || reference.role || 'Saved character').trim()
    const binding = savedCharacterMedia.get(reference.library_character_id) ?? { name, labels: [] }
    binding.labels.push(label)
    savedCharacterMedia.set(reference.library_character_id, binding)
  }

  for (const reference of references) {
    const note = (reference.role || reference.filename || 'reference').trim()
    if (reference.type === 'audio') {
      const intent = reference.audio_intent ?? 'voice'
      if (intent === 'drive') {
        labelLines.push(`Exact target soundtrack: ${note}; intent=AUDIO REUSE / PERFORMANCE DRIVER; retention=fully_preserved; preserve its waveform and audible timeline exactly and synchronize visible action and lip movement to it; this is target conditioning rather than a numbered Omni audio reference`)
      } else if (intent === 'style') {
        const label = `<Audio ${++audioIndex}>`
        labelLines.push(`${label}: ${note}; intent=AUDIO REFERENCE; retention=weak_reference; borrow only rhythm/style/texture and do not copy the source signal or words`)
      } else {
        const label = `<Audio ${++audioIndex}>`
        labelLines.push(`${label}: ${note}; intent=VOICE REFERENCE; retention=reference; use vocal identity/timbre/emotion/delivery for new scripted dialogue without copying source words, timing, waveform, room tone, reverberation, echo, background noise, microphone coloration, or source spatial acoustics; render the voice acoustically inside the target environment`)
        bindSavedCharacter(reference, label)
      }
    } else if (reference.type === 'image') {
      const label = `<Picture ${++pictureIndex}>`
      labelLines.push(`${label}: visual identity/appearance reference for ${note}; retention=reference for identity only; do not reproduce its background, framing, composition, or pose`)
      bindSavedCharacter(reference, label)
      if (reference.path) imagePaths.push(reference.path)
    } else {
      const nextVideoIndex = videoIndex + 1
      if ((reference.has_audio || reference.audio_path) && reference.include_audio !== false) {
        labelLines.push(`<Audio ${++audioIndex}>: soundtrack paired with <Video ${nextVideoIndex}>; intent=AUDIO REUSE / PERFORMANCE DRIVER; retention=partially_copy; preserve its audible timeline and synchronize action to it`)
      }
      videoIndex = nextVideoIndex
      const label = `<Video ${videoIndex}>`
      if (reference.video_intent === 'character') {
        labelLines.push(`${label}: identity, appearance, and characteristic-motion evidence for ${note}; compile it into that character's Subject; reject its source background, framing, camera, edit rhythm, opening frame, and action`)
        bindSavedCharacter(reference, label)
      } else if (reference.video_intent === 'scene') {
        labelLines.push(`${label}: environment, lighting, and scene-continuity reference for ${note}; do not copy incidental people as target identities`)
      } else {
        labelLines.push(`${label}: motion/camera/scene/timing reference for ${note}`)
      }
    }
  }

  const savedCharacterLines = Array.from(savedCharacterMedia.values()).map((binding, index) => {
    const subjectLabel = `<Subject ${index + 1}>`
    return (
      `Saved character "${binding.name}" is exactly ${subjectLabel}: `
      + `${binding.labels.join(' + ')} all define this one stable character. `
      + `Whenever the user names ${binding.name}, use ${subjectLabel}. Subject numbering follows `
      + `this reference inventory, while speaker IDs are assigned independently in first-vocal-event order. `
      + `Bind every listed voice Audio to this Subject and its event-ordered speaker ID. Do not create another Subject for `
      + 'a repeated media label, do not renumber this mapping, and do not emit an @ token.'
    )
  })
  const referenceContext = [...savedCharacterLines, ...labelLines].join('\n')
  return { imagePaths, referenceContext: referenceContext || undefined }
}

// Pure helpers _directorLoraState / _assetName / _directorAssetItem / _directorServePath
// moved to ./utils — see imports at the top of this file.

async function _loadDirectorImageFile(
  servePath: string | null,
  displayName: string,
): Promise<File | null> {
  if (!servePath) return null
  try {
    const response = await fetch(api.getFileUrl(servePath), { cache: 'no-store' })
    if (!response.ok) return null
    const blob = await response.blob()
    return new File([blob], displayName, { type: blob.type || 'image/png' })
  } catch {
    return null
  }
}

// Pure helpers _downloadTimestampMs / _downloadNeedsPolling / _waitForDownloadPoll
// moved to ./utils — see imports at the top of this file.
// Note: the visible-grace window constant (formerly CIVIT_DOWNLOAD_COMPLETED_VISIBLE_MS)
// is now owned by utils.ts as a literal in downloadNeedsPolling.

// --- LocalStorage persistence for per-mode settings ---
// Lives in ./studioPersistence (dry-run-safe, contract-tested). The
// snapshot/restore helpers below stay here because they are part of the
// mode-switch logic, not the persistence layer.

// Pure helpers _snapshotModeParams / _restoreModeParams moved to ./utils
// — see imports at the top of this file.

/** Fetch a model's defaults from the backend and merge primary fields
 *  into params. Shared between `selectModel` (explicit model pick) and
 *  `setGenerationMode` (mode switch where the per-mode active model
 *  may change). Without this, switching from LTX-2 (8 steps) to Flux 2
 *  Klein 9B (4 steps) or HiDream Dev (28 steps) would silently keep
 *  the slider at the previous model's value.
 *
 *  Only overrides "primary" model-tuned numeric fields. Leaves
 *  user-intent fields (prompt, seed, negative_prompt, resolution,
 *  repeat_generation, activated_loras) alone — those should survive
 *  model switches.
 *
 *  Race-safe: applies only if the same model is still active when
 *  the fetchDefaults promise resolves. Guards against rapid model
 *  switching from leaving a stale model's defaults applied.
 */
// String list — some of these (sample_solver, embedded_guidance_scale,
// audio_guidance_scale) aren't declared on GenerateParams but the
// params object is loose enough to carry them through to the backend.
const _PRIMARY_MODEL_DEFAULT_FIELDS: ReadonlyArray<string> = [
  'num_inference_steps',
  'guidance_scale',
  'flow_shift',
  'sample_solver',
  'embedded_guidance_scale',
  'audio_guidance_scale',
  // Perturbation config for the STG slider. These are inert unless
  // perturbation_switch === 2, which startGeneration derives from the
  // STG slider — the server-side fallback layers ([9]) are wrong for
  // LTX-2 22B (needs [28] from the model's settings file), so the
  // model-correct values must ride along with the request.
  // Deliberately NOT copied: perturbation_switch and stg_scale — older
  // generated settings files carry perturbation_switch: 2 / stg_scale: 1.0
  // from the settings-file era, and copying them would silently re-enable
  // STG on every generation.
  'perturbation_layers',
  'perturbation_start_perc',
  'perturbation_end_perc',
  // Default state of the Reference Pipeline toggle (10Eros defs set it to
  // true). Only copied when the model's settings carry the key, so models
  // without it keep whatever the user last chose — and startGeneration
  // strips it for models that lack the capability anyway. Unchecking the
  // toggle holds until the model is re-selected, same as steps/guidance.
  'reference_pipeline',
  // LM sampling knobs for the ACE-Step 1.5 family (and other LM-staged
  // audio models). Their handlers seed tuned values (temperature 0.85,
  // top_p 0.9, top_k off, LM CFG 2.5); without hydration the UI showed
  // and SENT its generic temperature 1.0. Only models whose defaults
  // carry these keys are affected — video model settings don't include
  // them, so nothing changes there.
  'temperature',
  'top_p',
  'top_k',
  'alt_guidance_scale',
  // Sliding-window geometry. The UI only writes sliding_window_size when
  // the user touches the Advanced slider, so without hydration a request
  // carries NO window size and the backend inherits one from unrelated
  // primary settings — SCAIL-2 (window default 81) then ran a 10s
  // generation as a single 160-frame window and overflowed VRAM at
  // resolutions that fit fine per-window. LTX-2's defaults carry 481
  // (~19s), so typical LTX generations stay single-window as before.
  'sliding_window_size',
  'sliding_window_overlap',
  // Native video-to-video editing defaults. These are model-owned controls,
  // while the uploaded source and mask paths remain ephemeral.
  'denoising_strength',
  'masking_strength',
  // Control-video coupling for the SCAIL-2 / Wan-Animate class:
  // force_fps "control" makes the output follow the guide video's frame
  // rate (user-reported: 25fps source came out 16fps without it), and
  // audio_prompt_type "R" remuxes the guide's audio track into the
  // output (user-reported: outputs were silent). Only the scail2 model
  // settings carry force_fps; every other model's audio_prompt_type
  // defaults to "" which matches the UI default, so nothing changes
  // elsewhere.
  'force_fps',
  'audio_prompt_type',
]

// Monotonic sequence for loadModelOptions staleness detection — only the
// most recently requested model's options may touch the store.

function _applyModelDefaults(
  storeGet: () => { selectedModelPerMode: Partial<Record<GenerationMode, string>>; generationMode: GenerationMode; params: GenerateParams },
  storeSet: (fn: (s: { params: GenerateParams }) => { params: GenerateParams }) => void,
  modelType: string,
): void {
  api.fetchDefaults(modelType).then((d) => {
    if (!d || typeof d !== 'object') return
    // Race guard: model may have been switched again while this fetch
    // was in flight. Apply only if still the active model in current mode.
    const state = storeGet()
    const active = state.selectedModelPerMode[state.generationMode]
    if (active !== modelType) return
    const overrides: Record<string, unknown> = {}
    for (const field of _PRIMARY_MODEL_DEFAULT_FIELDS) {
      // A one-click Full -> Pruned Turbo recommendation switches models and
      // then restores the managed low-step preset. Do not let the asynchronous
      // base-model defaults response race in afterward and put it back at
      // 20 steps. loadModelOptions applies the same Turbo contract.
      if (
        field === 'num_inference_steps'
        && modelType.startsWith('minimax_h3')
        && state.params.minimax_h3_turbo_mode === true
      ) {
        continue
      }
      if ((d as Record<string, unknown>)[field] !== undefined) {
        overrides[field] = (d as Record<string, unknown>)[field]
      }
    }
    if (Object.keys(overrides).length > 0) {
      storeSet(s => ({ params: { ...s.params, ...overrides } as GenerateParams }))
    }
  }).catch(() => { /* fetch failure shouldn't break model switch */ })
}

// Family → generation mode mapping
const familyModeMap: Record<string, GenerationMode> = {
  flux: 'image',
  flux2: 'image',
  qwen: 'image',
  z_image: 'image',
  krea2: 'image',
  hidream: 'image',
  wan: 'video',
  wan2_2: 'video',
  hunyuan: 'video',
  hunyuan_1_5: 'video',
  ltxv: 'video',
  ltx2: 'video',
  kandinsky5: 'video',
  tts: 'audio',
  longcat: 'avatar',
}

// Model types classified as Avatar even though their family is primarily Video
const avatarModelTypes = new Set([
  'multitalk',
  'multitalk_720p',
  'fantasy',
  'infinitetalk',
  'infinitetalk_multi',
  'steadydancer',
  'i2v_2_2_multitalk',
  'animate',
  'hunyuan_avatar',
])

// Model types classified as Video Edit (Kiwi Edit, Chrono Edit)
const videoEditModelTypes = new Set([
  'kiwi_edit',
  'kiwi_edit_instruct_only',
  'kiwi_edit_reference_only',
  'chrono_edit',
  'chrono_edit_distill',
  'lucy_edit_fastwan',
  'lucy_edit_fastwan_1_1',
  // Dedicated to Edit → Recast; the general SCAIL Fast profile remains in
  // Studio Video/Animate.
  'scail2_14B_recast_fast',
])

// Audio sub-families: split the single "tts" family into Speech, Music, SFX
const audioSubFamilies: ModelFamily[] = [
  { id: 'tts_speech', label: 'Text to Speech', order: 200 },
  { id: 'tts_music', label: 'Music', order: 201 },
  { id: 'tts_sfx', label: 'Sound Effects', order: 202 },
]

// Model types that belong to the Music sub-family (everything else in
// tts → Speech). Membership is prefix-based for the known music model
// lines so newly added variants (e.g. new ACE-Step checkpoints)
// classify correctly without touching this file — the XL SFT models
// were invisible in the Music group because an id list here missed
// them. Keep the explicit set for one-off ids that don't share a
// prefix with their line.
const musicModelTypes = new Set<string>([])
const musicModelPrefixes = ['ace_step', 'heartmula', 'minimax_music3']

function isMusicModelType(modelType: string): boolean {
  if (musicModelTypes.has(modelType)) return true
  return musicModelPrefixes.some(p => modelType.startsWith(p))
}

// Model types that belong to the SFX sub-family (MMAudio variants)
const sfxModelTypes = new Set([
  'mmaudio_v2',
  'mmaudio_nsfw',
])

// Virtual MMAudio model entries (injected into model list alongside backend models)
const SFX_VIRTUAL_MODELS: ModelDef[] = [
  { model_type: 'mmaudio_v2', name: 'MMAudio v2', family: 'tts', architecture: 'mmaudio', is_i2v: false, is_t2v: false, guidance_max_phases: 1, fps: 0, is_downloaded: true },
  { model_type: 'mmaudio_nsfw', name: 'MMAudio NSFW', family: 'tts', architecture: 'mmaudio', is_i2v: false, is_t2v: false, guidance_max_phases: 1, fps: 0, is_downloaded: false, nsfw_only: true },
]

// Default enabled models (shown by default in selectors)
const DEFAULT_ENABLED_MODELS = new Set([
  // Image
  // Keep the general-purpose Flux default plus the complete Krea 2 family:
  // base RAW/Turbo generation and their identity-preserving Edit variants.
  // Other image models remain opt-in through Model Visibility.
  'flux2_klein_9b',
  'krea2_raw',
  'krea2_turbo',
  'krea2_raw_edit',
  'krea2_turbo_edit',
  // Video
  // Default to just the LTX-2.3 Distilled 1.1 22B checkpoint (newer /
  // better quality). The FP8 build and every other video model
  // (Wan 2.2 t2v/i2v, GGUF quants, dev variants) stay available via
  // Settings → System → Model Visibility but off by default so the
  // first-launch picker isn't overwhelming.
  'ltx2_22B_distilled_1_1',
  // LTX-2.5's official split Distilled workflow. The large gated component
  // pack downloads only when selected for the first time.
  'ltx2_25',
  // SCAIL-2 character animation (Animate a character with a control
  // video). Fast = lightx2v distill bundled (6 steps, no CFG, ~13x).
  'scail2_14B',
  'scail2_14B_fast',
  'scail2_14B_recast_fast',
  // MiniMax H3 Base: text, first/last-frame video, and native stereo audio.
  'minimax_h3',
  'minimax_h3_full',
  // Experimental fused four-step Frames checkpoint. It is visible by
  // default, but the ordinary H3/LTX selections below remain the active
  // workflow defaults until a user explicitly chooses it.
  'minimax_h3_fused_turbo',
  // MiniMax H3 Ref2VA: ordered image, video, and audio references.
  'minimax_h3_ref2va',
  'minimax_h3_ref2va_full',
  'minimax_h3_ref2va_fused_turbo',
  // Audio — Speech
  'kugelaudio_0_open',
  'qwen3_tts_base',
  'qwen3_tts_customvoice',
  'qwen3_tts_voicedesign',
  // Audio — Music
  'ace_step_v1_5_turbo_lm_4b',
  'ace_step_v1_5_xl',
  'ace_step_v1_5_xl_turbo_lm_4b',
  'ace_step_v1_5_xl_sft',
  'ace_step_v1_5_xl_sft_lm_4b',
  'minimax_music3',
  // Audio — SFX
  'mmaudio_v2',
])

/* Version of the curated defaults list above. enabledModels is a stored
 * whitelist, so existing installs never re-read DEFAULT_ENABLED_MODELS —
 * without this, entries added to the curated list in an update stay
 * invisible for everyone who ever opened the app before. Bump the
 * version when adding entries and list them under that version below:
 * they get merged into existing installs' whitelists exactly ONCE, so
 * a user who then disables them stays disabled forever. (This is
 * deliberately narrower than auto-enabling every unknown model — only
 * the curated list's own additions are pushed.) */
const DEFAULTS_VERSION = 11
const DEFAULTS_ADDED_IN: Record<number, string[]> = {
  // v1.2.0: the ACE-Step XL SFT pair; LM_4B becomes the music default.
  2: ['ace_step_v1_5_xl_sft', 'ace_step_v1_5_xl_sft_lm_4b'],
  // v1.3.0: SCAIL-2 character animation, base + lightx2v-distilled Fast.
  3: ['scail2_14B', 'scail2_14B_fast'],
  // Dedicated Recast recipe: native replacement + official I2V LightX point.
  4: ['scail2_14B_recast_fast'],
  // Krea 2 image generation + identity-preserving image editing.
  5: ['krea2_raw', 'krea2_turbo', 'krea2_raw_edit', 'krea2_turbo_edit'],
  // MiniMax H3 Base native audio-video generation.
  6: ['minimax_h3'],
  // MiniMax H3 Base Omni Reference (Ref2VA).
  7: ['minimax_h3_ref2va'],
  // Full 33B H3 variants alongside the recommended Pruned 20B entries.
  8: ['minimax_h3_full', 'minimax_h3_ref2va_full'],
  // LTX-2.5 official Distilled T2V/I2V with synchronized native audio.
  9: ['ltx2_25'],
  // MiniMax-Music3 long-form stereo song generation.
  10: ['minimax_music3'],
  // Experimental MATLOWAI fused four-step H3 Frames + References variants.
  11: ['minimax_h3_fused_turbo', 'minimax_h3_ref2va_fused_turbo'],
}
const DEFAULTS_VERSION_KEY = 'cue-studio_defaults_version'

/* The music default changed in v1.2.0 (Turbo LM_4B -> SFT LM_4B).
 * A saved selection equal to the OLD default means the user was riding
 * the default rather than expressing a preference — follow them to the
 * new one, once, at the same version transition. Users who picked any
 * other model keep their choice. */
const OLD_MUSIC_DEFAULT = 'ace_step_v1_5_xl_turbo_lm_4b'
const NEW_MUSIC_DEFAULT = 'ace_step_v1_5_xl_sft_lm_4b'

const ENABLED_MODELS_KEY = 'cue-studio_enabled_models'
let _modelVisibilitySaveTask: Promise<void> = Promise.resolve()

function _saveEnabledModels(models: Set<string>) {
  try {
    localStorage.setItem(ENABLED_MODELS_KEY, JSON.stringify([...models]))
  } catch { /* quota exceeded */ }
  const payload = {
    enabled_models: [...models],
    initialized_mature_models: [...studioModelRuntime.initializedMatureModels],
    defaults_version: studioModelRuntime.defaultsVersion,
  }
  _modelVisibilitySaveTask = _modelVisibilitySaveTask
    .catch(() => { /* a later save should still run */ })
    .then(async () => {
      try {
        await api.updateModelVisibility(payload)
      } catch (error) {
        console.warn('Failed to persist model visibility:', error)
      }
    })
}

function _loadEnabledModels(): Set<string> | null {
  try {
    const raw = localStorage.getItem(ENABLED_MODELS_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return null
}

function _markMatureModelsInitialized(
  models: ModelDef[],
  modelTypes?: Iterable<string>,
) {
  const requested = modelTypes ? new Set(modelTypes) : null
  for (const model of models) {
    if (
      model.nsfw_only
      && (requested == null || requested.has(model.model_type))
    ) {
      studioModelRuntime.initializedMatureModels.add(model.model_type)
    }
  }
}

function _enableUninitializedMatureModels(
  models: ModelDef[],
  enabledModels: Set<string>,
): Set<string> | null {
  const next = new Set(enabledModels)
  let changed = false
  for (const model of models) {
    if (
      model.nsfw_only
      && !studioModelRuntime.initializedMatureModels.has(model.model_type)
    ) {
      studioModelRuntime.initializedMatureModels.add(model.model_type)
      next.add(model.model_type)
      changed = true
    }
  }
  return changed ? next : null
}

// Default model_type per generation mode
const modeDefaultModel: Record<GenerationMode, string> = {
  image: 'flux2_klein_9b',
  video: 'ltx2_22B_distilled_1_1',
  audio: 'kugelaudio_0_open',
  // Edit initially opens in Retake, whose curated compatible model is LTX-2.3.
  // An empty preference fell back to the first legacy LTX family entry even
  // though that checkpoint was not enabled in the selector.
  avatar: 'ltx2_22B_distilled_1_1',
  tools: '',   // Tools is non-generative post-processing — owns no model
}

export function getFamilyMode(familyId: string): GenerationMode {
  return familyModeMap[familyId] || 'video'
}

/** Get the effective generation mode for a specific model (respects per-model overrides) */
export function getModelMode(modelType: string, familyId: string): GenerationMode {
  if (avatarModelTypes.has(modelType)) return 'avatar'
  if (familyId === 'longcat') return 'avatar'
  return getFamilyMode(familyId)
}

/** Director models whose image/audio conditioning strengths are fixed at 1.0. */
export function directorModelUsesFixedMediaStrength(
  modelType: string | undefined,
  architecture?: string | null,
): boolean {
  return [modelType, architecture].some(value => {
    const normalized = String(value || '').toLowerCase()
    return normalized.startsWith('minimax_h3') || normalized.startsWith('ltx2_25')
  })
}

export function getFamiliesForMode(mode: GenerationMode, allFamilies: ModelFamily[], editSubMode?: string, audioSubMode?: string): ModelFamily[] {
  if (mode === 'avatar') {
    // Recast and Repaint run on SCAIL-2, which lives under the Wan 2.1
    // family. The remaining edit sub-modes use LTX models.
    if (editSubMode === 'recast' || editSubMode === 'restyle') {
      return allFamilies.filter(f => f.id === 'wan')
    }
    return allFamilies.filter(f => f.id === 'ltx2' || f.id === 'ltxv')
  }
  if (mode === 'audio') {
    // Filter to the active audio sub-mode family
    if (audioSubMode === 'speech') return audioSubFamilies.filter(f => f.id === 'tts_speech')
    if (audioSubMode === 'music') return audioSubFamilies.filter(f => f.id === 'tts_music')
    if (audioSubMode === 'sfx') return audioSubFamilies.filter(f => f.id === 'tts_sfx')
    if (audioSubMode === 'mixer' || audioSubMode === 'revoice') return []
    return audioSubFamilies
  }
  return allFamilies.filter(f => getFamilyMode(f.id) === mode)
}

/** Get models for a family ID, optionally filtered by generation mode */
export function getModelsForFamily(familyId: string, allModels: ModelDef[], mode?: GenerationMode, editSubMode?: string): ModelDef[] {
  if (familyId === 'tts_speech') {
    return allModels.filter(m => m.family === 'tts' && !isMusicModelType(m.model_type) && !sfxModelTypes.has(m.model_type))
  }
  if (familyId === 'tts_music') {
    return allModels.filter(m => m.family === 'tts' && isMusicModelType(m.model_type))
  }
  if (familyId === 'tts_sfx') {
    return allModels.filter(m => m.family === 'tts' && sfxModelTypes.has(m.model_type))
  }
  const familyModels = allModels.filter(m => m.family === familyId)
  // When mode is specified and the family spans multiple modes, filter to matching models
  if (mode === 'avatar') {
    // Recast exposes its dedicated native-replacement Fast recipe plus HQ.
    if (editSubMode === 'recast') {
      return familyModels.filter(m =>
        m.model_type === 'scail2_14B_recast_fast'
        || m.model_type === 'scail2_14B'
      )
    }
    // Repaint intentionally mirrors Studio Video/Frames SCAIL Animate:
    // the edited first frame is the primary image and the source video
    // supplies motion/camera movement.
    if (editSubMode === 'restyle') {
      return familyModels.filter(m =>
        m.model_type === 'scail2_14B_fast'
        || m.model_type === 'scail2_14B'
      )
    }
    return familyModels.filter(m => !avatarModelTypes.has(m.model_type) && !videoEditModelTypes.has(m.model_type))
  }
  if (mode === 'video') {
    // For video mode: exclude models that are classified as avatar or video edit
    return familyModels.filter(m => !avatarModelTypes.has(m.model_type) && !videoEditModelTypes.has(m.model_type))
  }
  return familyModels
}

/** Native image-suite capability filter shared by workflow/model selectors. */
export function modelSupportsImageWorkflow(
  model: ModelDef | undefined,
  workflow: StudioImageWorkflow,
  hasReferenceImages = false,
): boolean {
  if (!model || getModelMode(model.model_type, model.family) !== 'image') return false
  if (workflow === 'upscale') return true
  if (workflow === 'inpaint') return model.supports_image_inpaint === true
  if (workflow === 'outpaint') return model.supports_image_outpaint === true
  // Generate is one adaptive surface. With no source images it presents both
  // T2I and I2I models; once an image is attached, only native edit/I2I
  // models remain eligible. An I2I-only model can therefore be selected
  // before adding its required source, and GenerateButton will request it.
  if (hasReferenceImages) return model.supports_image_edit === true
  return model.requires_image_reference !== true || model.supports_image_edit === true
}

function _normalizeStudioImageWorkflow(value: unknown): StudioImageWorkflow | null {
  if (value === 'new' || value === 'edit' || value === 'generate') return 'generate'
  if (value === 'inpaint' || value === 'outpaint' || value === 'upscale') return value
  return null
}

function _normalizeStudioVideoWorkflow(
  value: unknown,
  model?: ModelDef,
): StudioVideoWorkflow | null {
  if (value === 'generate') return 'frames'
  if (
    value === 'frames'
    || value === 'references'
    || value === 'extend'
    || value === 'blend'
    || value === 'retake'
    || value === 'prompt_edit'
    || value === 'outpaint'
    || value === 'repaint'
    || value === 'recast'
    || value === 'upscale'
    || value === 'film_grain'
  ) return value
  return _isOmniVideoModel(model) ? 'references' : null
}

/** Get the display family ID for a model (handles audio sub-families) */
export function getDisplayFamily(model: ModelDef): string {
  if (model.family === 'tts') {
    if (sfxModelTypes.has(model.model_type)) return 'tts_sfx'
    if (isMusicModelType(model.model_type)) return 'tts_music'
    return 'tts_speech'
  }
  return model.family
}

// Transient: the LTX model selected before entering either SCAIL-2 edit
// workflow, so leaving Recast/Repaint restores the user's prior edit model.


const DEFAULT_RECAST_MAPPING: RecastCharacterMapping = {
  id: 'recast-a',
  target: 'person',
  refFile: null,
  refPath: '',
  refUrl: '',
  additionalRefs: [],
  referenceAlignedToSource: false,
}

function getDefaultModelForMode(
  mode: GenerationMode,
  families: ModelFamily[],
  models: ModelDef[],
  enabledModels?: ReadonlySet<string>,
): string {
  const isEnabled = (modelType: string) => !enabledModels || enabledModels.has(modelType)
  // Try the preferred default first
  const preferred = modeDefaultModel[mode]
  if (preferred && isEnabled(preferred) && models.some(m => m.model_type === preferred)) {
    return preferred
  }
  // Fallback: first enabled model in the first family of this mode. Selecting
  // a disabled fallback leaves the trigger showing a model that is absent
  // from its own dropdown.
  const modeFamilies = getFamiliesForMode(mode, families)
  for (const family of modeFamilies) {
    const firstModel = getModelsForFamily(family.id, models, mode)
      .find(model => isEnabled(model.model_type))
    if (firstModel) return firstModel.model_type
  }
  return ''
}

export interface AppState {
  // Generation mode (top-level: image/video/audio/avatar)
  generationMode: GenerationMode
  setGenerationMode: (mode: GenerationMode) => void
  /** Last regular workflow selected inside the user-facing Studio Video tab. */
  studioVideoWorkflow: StudioVideoWorkflow
  /** Route a Studio workflow to its legacy video/avatar/tools engine. */
  setStudioVideoWorkflow: (workflow: StudioVideoWorkflow) => void
  /** Compatibility field for saved state; Studio Generate is always automatic. */
  studioVideoCreateRoute: StudioVideoCreateRoute
  studioVideoEffectiveCreateRoute: StudioVideoEffectiveCreateRoute
  studioVideoModelPerCreateRoute: Partial<Record<StudioVideoEffectiveCreateRoute, string>>
  studioVideoRouteNotice: {
    message: string
    previousRoute: StudioVideoEffectiveCreateRoute
    previousModel: string
    undoable?: boolean
  } | null
  setStudioVideoCreateRoute: (route: StudioVideoCreateRoute) => void
  reconcileStudioVideoCreateRoute: (reason?: string) => void
  undoStudioVideoRoute: () => void
  clearStudioVideoRouteNotice: () => void
  /** Remember an explicit compatible model without changing media intent. */
  selectStudioVideoModel: (modelType: string) => void
  /** Last workflow selected inside Studio's Image tab. */
  studioImageWorkflow: StudioImageWorkflow
  /** Route an Image workflow to native generation or standalone upscale. */
  setStudioImageWorkflow: (workflow: StudioImageWorkflow) => void
  editSubMode: import('../types').EditSubMode
  setEditSubMode: (mode: import('../types').EditSubMode) => void
  // Edit mode state (persists across sub-mode switches)
  editVideoPath: string
  editVideoUrl: string
  editVideoFile: File | null
  editVideoDuration: number
  editVideoResolution: string  // "WxH" from source video
  editStartTime: number
  editEndTime: number
  editRetakeStrength: number
  /** CFG scale for prompt-driven edit modes. 1.0 = no CFG (the retake
   *  pipeline's legacy default — prompt barely influences the output).
   *  3.0-5.0 = strong prompt guidance (required for inpaint to actually
   *  replace content with prompt-specific pixels). */
  editPromptStrength: number
  /** LoRA strength for Edit Anything mode. 1.0 is the recommended start
   *  per the LoRA card; bump to 1.2 if the edit is too weak; lower below
   *  1.0 if the edit distorts unrelated content. */
  editAnythingLoraStrength: number
  /** Optional boundary-anchor images for Edit Anything. When set, the
   *  retake pipeline pins frame 0 / last frame of the edit range to these
   *  images instead of auto-extracting them from the source clip. Empty
   *  slots fall back to source frames — so if only the end anchor is set,
   *  the model morphs from source's actual start frame into the user's
   *  edited end frame across the range (the "Ironman suit forms over the
   *  man" effect). */
  editAnythingStartAnchor: string | null
  editAnythingEndAnchor: string | null
  /** SCAIL-2 Repaint edited first frame (uploaded or returned from Image mode). */
  editRepaintFrameFile: File | null
  editRepaintFramePath: string
  editRepaintFrameUrl: string
  /** Optional source-video → edited-frame semantic correspondences. */
  editRepaintMappings: RepaintRegionMapping[]
  /** Spatial quality profile shared with Recast's SCAIL-2 canvas logic. */
  editRepaintResolutionProfile: ScailResolutionProfile
  setEditRepaintFrame: (file: File | null, path: string, url: string) => void
  setEditRepaintMappings: (mappings: RepaintRegionMapping[]) => void
  /** Recast (SCAIL-2 Replace): who to swap out, as a SAM3 keyword. */
  editRecastTarget: string
  /** Number of matching people to track and replace (SCAIL-2 supports 1-5). */
  editRecastPersonCount: number
  /** Recast reference character image (uploaded path + preview URL). */
  editRecastRefFile: File | null
  editRecastRefPath: string
  editRecastRefUrl: string
  /** Explicit source-person → replacement mappings in stable SCAIL color order. */
  editRecastMappings: RecastCharacterMapping[]
  setEditRecastMappings: (mappings: RecastCharacterMapping[]) => void
  /** True when the reference preserves the selected source frame's layout. */
  editRecastRefAligned: boolean
  /** Remove unrelated reference scenery before SCAIL-2 encodes identity. */
  editRecastIsolateReference: boolean
  /** Derive a tighter same-character identity view when none is supplied. */
  editRecastAutoFaceDetail: boolean
  /** Rewrite and append Maestro's Recast identity/scene prompt guidance. */
  editRecastEnhancePrompt: boolean
  /** Strict source-pixel composite outside the tracked Recast target. */
  editRecastProtectBystanders: boolean
  /** Native SCAIL-2 color mapping for other visible identities. */
  editRecastPreserveBystanders: boolean
  /** Apply the official SCAIL-2 replacement Relighting LoRA. */
  editRecastUseRelighting: boolean
  /** Spatial quality profile, independent from the selected SCAIL-2 model. */
  editRecastResolutionProfile: ScailResolutionProfile
  setEditRecastRef: (file: File | null, path: string, url: string, aligned?: boolean) => void
  /** Round-trip marker for the "Edit Anchor in Image Mode" workflow.
   *  Populated when the user clicks "Edit Start" or "Edit End" on a
   *  boundary anchor slot. A banner at the top of the sidebar lets them
   *  apply the latest Image-mode output to that single anchor, then
   *  return to Edit Anything. Each anchor is its own independent
   *  round-trip — start and end can't both be in flight at once, but
   *  the user does them sequentially. */
  editReturnTarget: {
    /** Which anchor slot we're populating on return. */
    anchor: 'start' | 'end' | 'recast' | 'repaint'
    /** The pre-extracted source frame at the corresponding trim handle.
     *  This is the frame the user is editing in Image mode; if they
     *  cancel without applying, no anchor is set and the model falls
     *  back to extracting this same frame at generation time. */
    framePath: string
    /** The clip the user came from, so we can re-link them on return. */
    clipPath: string
    startTime: number
    endTime: number
    /** User's image-mode reference images / type before we hijacked the
     *  slot for the round-trip — restored on return so we don't nuke
     *  their existing image-mode workflow state. */
    savedImageRefs: File[]
    savedImageRefType: string
  } | null
  setEditAnythingStartAnchor: (path: string | null) => void
  setEditAnythingEndAnchor: (path: string | null) => void
  /** Extract one boundary frame from the source clip and switch the
   *  sidebar to Studio Image mode (using the proper setGenerationMode
   *  so the model + LoRA + image-mode params all swap correctly) with
   *  that frame loaded as image_start. */
  sendFrameToImageMode: (which: 'start' | 'end' | 'recast' | 'repaint') => Promise<void>
  /** Apply the latest Image-mode output to the requested anchor/reference,
   *  then return to Edit Anything or Recast. */
  applyOutputAsAnchor: () => Promise<void>
  /** Skip applying — return to Edit Anything with the anchor unset
   *  (model will fall back to source-extracted frame at generation time,
   *  giving the morph-from-source effect when only the OTHER anchor is
   *  set). */
  skipAnchorPhase: () => void
  /** Cancel the round-trip and return to Edit Anything. Same effect as
   *  skipAnchorPhase, but exposed separately for UI clarity. */
  cancelAnchorReturn: () => void
  editRetakeEngine: 'native' | 'legacy'
  editRegenerateAudio: boolean
  editSamTarget: string  // separate SAM segmentation target (noun phrase)
  editInvertMask: boolean  // invert SAM mask (select everything EXCEPT the target)
  editMasksPath: string | null  // cached SAM mask for inpaint
  editMaskPreview: string | null
  editDetectedTarget: string
  // Continue video state
  continueVideo: File | null
  continueVideoPath: string
  continueVideoUrl: string
  continueVideoDuration: number
  setContinueVideo: (file: File, path: string, url: string, duration: number) => void
  clearContinueVideo: () => void
  // Per-sub-mode working sets (Studio Video). Keyed by image_mode
  // (0 Frames / 2 Multi-Shot / 3 Extend / 4 Blend) — each sub-mode keeps
  // its own prompt, input tiles, and settings. See setParam('image_mode').
  videoSubModeStash: Partial<Record<number, VideoSubModeStash>>
  // Blend state
  blendClipA: File | null
  blendClipAPath: string
  blendClipAUrl: string
  blendClipADuration: number
  blendClipB: File | null
  blendClipBPath: string
  blendClipBUrl: string
  blendClipBDuration: number
  blendTransitionSec: number
  blendStrengthA: number
  blendStrengthB: number
  /** Seconds of Clip A's overlap tail used as video_source (motion prefix) for VE mode.
   *  0 = pure SE (single start-frame anchor, no motion continuity from A).
   *  1-2 = model extrapolates A's motion through the blend. */
  blendMotionPrefixSec: number
  /** Seconds of Clip B's overlap head used as video_end (motion suffix) —
   *  symmetric counterpart to motion prefix. 0 = single still anchor at
   *  blend end. 1-2 = model lands at B with real jogger stride/speed. */
  blendMotionSuffixSec: number
  /** input_video_strength for the VE anchors (video_source + image_end).
   *  1.0 = hard-lock both anchors → model averages between them (crossfade).
   *  0.5-0.8 = weaker anchors, model invents motion in between. */
  blendAnchorStrength: number
  setBlendClipA: (file: File, path: string, url: string, duration: number) => void
  setBlendClipB: (file: File, path: string, url: string, duration: number) => void
  clearBlendClipA: () => void
  clearBlendClipB: () => void
  setBlendTransitionSec: (sec: number) => void
  setBlendStrengthA: (v: number) => void
  setBlendStrengthB: (v: number) => void
  setBlendMotionPrefixSec: (v: number) => void
  setBlendMotionSuffixSec: (v: number) => void
  setBlendAnchorStrength: (v: number) => void
  blendMode: 'insert' | 'overlap'
  blendOverlapSec: number
  setBlendMode: (mode: 'insert' | 'overlap') => void
  setBlendOverlapSec: (sec: number) => void
  // Outpaint state
  // Padding kept in pixels (server contract: pad_top/bottom/left/right).
  // The new OutpaintCanvas computes these from canvas aspect + video position
  // on submit, but the store still surfaces the raw values so legacy callers
  // and metadata sidecars stay compatible.
  outpaintPadding: { top: number; bottom: number; left: number; right: number }
  setOutpaintPadding: (padding: { top: number; bottom: number; left: number; right: number }) => void
  outpaintResolutionPreset: 'auto' | '480p' | '540p' | '720p' | '1080p'
  setOutpaintResolutionPreset: (preset: 'auto' | '480p' | '540p' | '720p' | '1080p') => void
  // Canvas aspect ratio for the outpaint composer. 'source' means keep the
  // source clip's native aspect (no canvas extension — only useful when the
  // user wants to outpaint a single side via drag).
  outpaintAspect: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | 'source'
  setOutpaintAspect: (a: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | 'source') => void
  // Video frame position+size inside the canvas, normalized to canvas
  // dimensions (0–1). Default = centered, fully fit (no crop). User drags
  // to reposition; resize handles scale the source within the canvas.
  outpaintVideoBox: { x: number; y: number; w: number; h: number }
  setOutpaintVideoBox: (box: { x: number; y: number; w: number; h: number }) => void
  // Film-strip trim times (seconds). When end > start, server pre-trims
  // the source via ffmpeg before outpainting.
  outpaintTrimStart: number
  outpaintTrimEnd: number
  setOutpaintTrimStart: (t: number) => void
  setOutpaintTrimEnd: (t: number) => void
  outpaintSourcePreservation: number
  setOutpaintSourcePreservation: (v: number) => void
  outpaintLoraStrength: number
  setOutpaintLoraStrength: (v: number) => void
  // Official LTX-2.3 binary-mask conditioning plus multiscale source blend.
  // Enabled by default; false keeps the legacy black-sentinel path for A/B.
  outpaintMaskPreserving: boolean
  setOutpaintMaskPreserving: (v: boolean) => void
  outpaintPreserveSourceAudio: boolean
  setOutpaintPreserveSourceAudio: (v: boolean) => void
  // Lock source pixels: composite original source clip back into the source
  // rectangle of the outpainted output (post-process ffmpeg overlay).
  // Default OFF — the model's regenerated source area actually preserves
  // lip detail well, and a hard overlay creates a visible rectangle seam.
  // Kept for opt-in use cases that need pixel-perfect source area.
  outpaintLockSourcePixels: boolean
  setOutpaintLockSourcePixels: (v: boolean) => void
  // Trim sliding-window smear: cut the per-window-overlap frames at the
  // window 1→2 boundary in the output, where the IC-LoRA's prefix
  // conditioning produces a constant ~9-frame lag for the rest of the
  // clip. Default ON — fixes lip sync on multi-window outpaint.
  outpaintTrimSmear: boolean
  setOutpaintTrimSmear: (v: boolean) => void
  // Sliding-window controls for long-clip outpainting (auto-engages when
  // total_frames > windowSize). 0 = use model default (LTX-2: 241 frames).
  outpaintWindowSize: number
  setOutpaintWindowSize: (v: number) => void
  outpaintWindowOverlap: number
  setOutpaintWindowOverlap: (v: number) => void
  setEditVideoPath: (path: string) => void
  setEditVideo: (file: File | null, path: string, url: string, duration: number, resolution: string) => void
  clearEditVideo: () => void
  audioSubMode: import('../types').AudioSubMode
  setAudioSubMode: (mode: import('../types').AudioSubMode) => void
  // Music mode (ACE-Step): describe + LLM writes, or type Style/Lyrics directly.
  musicDescription: string
  setMusicDescription: (s: string) => void
  musicInstrumental: boolean
  setMusicInstrumental: (b: boolean) => void
  selectedModelPerAudioSubMode: Partial<Record<import('../types').AudioSubMode, string>>
  /** H3 accelerations live outside per-mode params so visiting Audio/Image
   *  cannot erase the user's Video optimization choices. */
  h3OptimizationPreferences: {
    override_attention: '' | 'sol' | 'sla' | 'sdpa'
    skip_steps_cache_type: '' | 'first_block'
    skip_steps_multiplier?: number
    skip_steps_start_step_perc?: number
  }
  selectedModelPerMode: Partial<Record<GenerationMode, string>>
  savedLoraPerMode: Partial<Record<GenerationMode, { activated_loras: string[]; loras_multipliers: string; loraWeights: Record<string, number[]>; availableLoras: string[] }>>
  savedParamsPerMode: Partial<Record<GenerationMode, SavedModeParams>>
  savedPromptPerMode: Partial<Record<string, string>>
  /** Snapshot of lora_id → filename loaded from localStorage at boot.
   *  Used by `refreshLoraIdMap` reconciliation to rewrite filenames that
   *  changed since save (LoRA version updates). Internal-only; not part
   *  of the persisted runtime state. */
  _loraFilenameSnapshotAtLoad?: Record<string, string>

  // Generation params
  params: GenerateParams
  setParam: <K extends keyof GenerateParams>(key: K, value: GenerateParams[K]) => void
  setParams: (partial: Partial<GenerateParams>) => void

  // UI state
  settingsOpen: boolean
  toggleSettings: () => void
  setSettingsOpen: (open: boolean) => void
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void

  // Theme — see lib/theme.ts. Two-dimensional: a dark/light/auto mode
  // plus a theme family (each family has a dark and a light variant).
  // Persisted to localStorage; an inline script in index.html applies
  // the resolved theme to <html> BEFORE React mounts to avoid a flash
  // of the default theme.
  themePrefs: ThemePrefs
  setThemeMode: (mode: ThemeMode) => void
  setThemeFamily: (family: FamilyId) => void

  density: Density
  setDensity: (density: Density) => void

  // Retake Dialog
  retakeDialogOpen: boolean
  retakeSourceFile: string | null
  openRetakeDialog: (filename: string) => void
  closeRetakeDialog: () => void

  // Director saved-pipeline actions (shared by Director and Editor)
  reconnectDirectorPipelines: () => Promise<void>
  rerunClipImage: (pid: string, clipIndex: number, prompt?: string) => Promise<unknown>
  rerunClipVideo: (pid: string, clipIndex: number, prompt?: string) => Promise<unknown>
  rejoinPipelineClips: (pid: string) => Promise<unknown>
  resumePipeline: (pid: string) => Promise<void>
  reattachDirectorPipeline: (pid: string, focusDirector?: boolean) => Promise<void>
  loadDirectorFromPipeline: (pid: string) => Promise<void>
  directorQueue: DirectorQueueState | null
  directorQueueLoading: boolean
  /** Held entry currently open in the Director editor, if any. */
  directorQueueEditingEntryId: string | null
  loadDirectorQueue: () => Promise<void>
  loadDirectorQueueEntry: (entryId: string) => Promise<void>
  startDirectorQueue: () => Promise<void>
  pauseDirectorQueue: () => Promise<void>
  removeDirectorQueueEntry: (entryId: string) => Promise<void>
  moveDirectorQueueEntry: (entryId: string, direction: -1 | 1) => Promise<void>
  queueCurrentDirectorPipeline: () => Promise<void>

  // Recipes (one-click Studio presets)
  recipesOpen: boolean
  setRecipesOpen: (open: boolean) => void
  recipes: import('../api/client').RecipeCard[]
  recipesLoading: boolean
  loadRecipes: () => Promise<void>
  applyRecipe: (id: string) => Promise<{ missing: import('../api/client').RecipeLora[] }>
  saveRecipeFromOutput: (outputName: string, name: string, description: string, nsfw: boolean) => Promise<void>
  deleteRecipe: (id: string) => Promise<void>
  downloadRecipeLora: (lora: import('../api/client').RecipeLora, modelType: string) => Promise<void>

  loraBrowserOpen: boolean
  loraBrowserArch: string | null
  loraBrowserDefaultDir: string | null
  setLoraBrowserOpen: (open: boolean, arch?: string) => void
  setLoraBrowserDefaultDir: (dir: string | null) => void
  civitSearchResults: CivitAIModel[]
  civitSearchCursor: string | null
  civitSearchLoading: boolean
  civitSearchError: string | null
  civitSelectedModel: CivitAIModel | null
  civitDownloads: CivitAIDownload[]
  searchCivitAI: (params: Record<string, unknown>, append?: boolean) => Promise<void>
  selectCivitAIModel: (modelId: number) => Promise<void>
  clearCivitSelection: () => void
  startCivitAIDownload: (params: Record<string, unknown>) => Promise<void>
  pollCivitAIDownloads: () => void

  // Models & families (from API)
  families: ModelFamily[]
  models: ModelDef[]
  loadModels: () => Promise<void>
  modelsLoaded: boolean

  // Model visibility (favorites)
  enabledModels: Set<string>
  toggleModelEnabled: (modelType: string) => void
  resetEnabledModels: () => void
  setAllModelsEnabled: (enabled: boolean) => void
  /** Bulk-toggle a list of models (family-level enable/disable, issue #14). */
  setModelsEnabled: (modelTypes: string[], enabled: boolean) => void
  // ModelSelector "+N more" hint → open Settings and expand Enabled Models.
  modelVisibilityFocus: GenerationMode | null
  openModelVisibility: (mode: GenerationMode) => void
  clearModelVisibilityFocus: () => void

  // Resolution helpers
  resolutionPreset: ResolutionPreset
  setResolutionPreset: (preset: ResolutionPreset) => void
  aspectRatio: AspectRatio
  setAspectRatio: (ratio: AspectRatio) => void

  // Duration
  durationSeconds: number
  setDurationSeconds: (s: number) => void

  // Sliding window
  slidingWindowSeconds: number
  setSlidingWindowSeconds: (s: number) => void
  slidingWindowOverlap: number
  setSlidingWindowOverlap: (frames: number) => void
  slidingWindowLocked: boolean
  setSlidingWindowLocked: (locked: boolean) => void
  /** Durable H3 pass lengths keyed by exact model type and resolution. */
  h3WindowOverrides: Record<string, number>
  saveH3WindowOverride: (modelType: string, resolution: string, frames: number) => void
  clearH3WindowOverride: (modelType: string, resolution: string) => void

  // Real frame rate of the uploaded guide/control video (probed server-side
  // at upload). Used by force_fps="control" models (SCAIL-2 class) to
  // convert durationSeconds to frames at the rate the output will actually
  // play at, instead of the model's nominal fps.
  guideVideoFps: number | null
  setGuideVideoFps: (fps: number | null) => void

  // Output count
  outputCount: number
  setOutputCount: (n: number) => void

  // Image uploads
  startImage: File | null
  endImage: File | null
  setStartImage: (f: File | null) => void
  setEndImage: (f: File | null) => void

  // Source media for Image Edit/Inpaint/Outpaint.
  imageWorkflowSourceFile: File | null
  imageWorkflowSourcePath: string
  imageWorkflowSourceUrl: string
  setImageWorkflowSource: (source: { file: File | null; path: string; url: string } | null) => void
  imageWorkflowMaskFile: File | null
  imageWorkflowMaskPath: string
  imageWorkflowMaskUrl: string
  setImageWorkflowMask: (source: { file: File | null; path: string; url: string } | null) => void
  imageOutpaintPadding: { top: number; bottom: number; left: number; right: number }
  setImageOutpaintPadding: (side: 'top' | 'bottom' | 'left' | 'right', value: number) => void
  resetImageOutpaintPadding: () => void

  // Image references (for models with image_ref_choices)
  imageRefs: File[]
  imageRefType: string
  removeBackgroundRefs: boolean
  addImageRef: (file: File) => void
  removeImageRef: (index: number) => void
  reorderImageRefs: (from: number, to: number) => void
  setImageRefType: (type: string) => void
  setRemoveBackgroundRefs: (v: boolean) => void

  // Post-processing (shared for Studio mode)
  spatialUpsampling: string
  setSpatialUpsampling: (v: string) => void
  sharpenAmount: number
  setSharpenAmount: (v: number) => void
  filmGrainIntensity: number
  setFilmGrainIntensity: (v: number) => void
  filmGrainSaturation: number
  setFilmGrainSaturation: (v: number) => void

  // Voice clone postprocessing (SeedVC). Replaces 1 or 2 voices in
  // a generated video's audio with user-supplied reference voice(s).
  // Applied after generation as a postprocessing step. See
  // app/postprocessing/voice_clone.py for backend logic.
  voiceCloneEnabled: boolean
  setVoiceCloneEnabled: (v: boolean) => void
  voiceCloneMode: 'single' | 'two'
  setVoiceCloneMode: (v: 'single' | 'two') => void
  // Up to 2 reference voices. Each entry tracks the uploaded filename
  // (display) + the server-side path the backend uses.
  voiceCloneRefs: { filename: string; path: string }[]
  setVoiceCloneRef: (index: number, ref: { filename: string; path: string } | null) => void

  // ── Tools area (standalone post-processing on an existing clip) ──────
  // Apply a finishing pass to any gallery output or uploaded clip,
  // independent of a generation. See ToolsPanel.tsx + /api/v1/tools/*.
  toolsTool: 'upscale' | 'film_grain' | 'revoice'
  setToolsTool: (t: 'upscale' | 'film_grain' | 'revoice') => void
  toolsUpscaleMedia: 'image' | 'video'
  setToolsUpscaleMedia: (media: 'image' | 'video') => void
  /** Gallery filename (resolved against the workspace) OR an absolute upload path. */
  toolsSourcePath: string | null
  toolsSourceName: string | null
  toolsSourceUrl: string | null
  setToolsSource: (src: { path: string; name: string; url: string | null } | null) => void
  toolsUpscaleMethod: string
  setToolsUpscaleMethod: (m: string) => void
  toolsRevoiceMode: 'single' | 'two'
  setToolsRevoiceMode: (m: 'single' | 'two') => void
  toolsRevoiceRefs: ({ filename: string; path: string } | null)[]
  setToolsRevoiceRef: (index: number, ref: { filename: string; path: string } | null) => void
  runTool: () => Promise<void>
  /** Gallery one-click: upscale a specific clip now, with the configured method. */
  quickUpscaleClip: (name: string, url: string | null) => Promise<void>
  /** Gallery one-click: load a clip into the Tools panel for a tool that needs
   *  setup before running (e.g. revoice needs voice references), and switch to it. */
  sendClipToTools: (name: string, url: string | null, tool: 'upscale' | 'film_grain' | 'revoice') => void

  // Director-mode post-processing (separate image/video)
  directorImageSpatialUpsampling: string
  setDirectorImageSpatialUpsampling: (v: string) => void
  directorImageFilmGrainIntensity: number
  setDirectorImageFilmGrainIntensity: (v: number) => void
  directorImageFilmGrainSaturation: number
  setDirectorImageFilmGrainSaturation: (v: number) => void
  directorVideoSpatialUpsampling: string
  setDirectorVideoSpatialUpsampling: (v: string) => void
  directorVideoFilmGrainIntensity: number
  setDirectorVideoFilmGrainIntensity: (v: number) => void
  directorVideoFilmGrainSaturation: number
  setDirectorVideoFilmGrainSaturation: (v: number) => void
  directorVideoSelfRefiner: number
  setDirectorVideoSelfRefiner: (v: number) => void
  directorAudioScale: number
  setDirectorAudioScale: (v: number) => void

  // Audio guide (pre-filled by Director or manual upload)
  audioGuideFilename: string | null
  setAudioGuideFilename: (name: string | null) => void
  audioGuide2Filename: string | null
  setAudioGuide2Filename: (name: string | null) => void
  ttsSpeakerName1: string
  ttsSpeakerName2: string
  ttsSpeakerNamesManual: boolean
  setTtsSpeakerName1: (name: string) => void
  setTtsSpeakerName2: (name: string) => void
  _autoParseSpkeakerNames: (text: string, force?: boolean) => void
  // Dynamic multi-speaker (1-6 voices)
  ttsVoiceCount: number  // 0=text only, 1-6=voice clone count
  ttsVoices: { name: string; filename: string | null; path: string | null }[]
  setTtsVoiceCount: (count: number) => void
  setTtsVoiceName: (index: number, name: string) => void
  setTtsVoiceFile: (index: number, filename: string | null, path: string | null) => void
  addTtsVoice: () => void
  removeTtsVoice: (index: number) => void

  // Multi-clip state
  clips: MultiClip[]
  singlePromptMode: boolean
  setClipPrompt: (index: number, prompt: string) => void
  setClipStartImage: (index: number, file: File | null) => void
  setSinglePromptMode: (v: boolean) => void
  syncClipCount: () => void

  // Generation state (queue)
  jobs: GenerationJob[]
  isGenerating: boolean
  startGeneration: (mode?: 'now' | 'queue', snapshot?: AppState, prepareReview?: boolean) => Promise<void>
  startStudioQueue: () => Promise<void>
  stopGeneration: (jobId?: string) => void
  dismissJob: (jobId: string) => void
  reconnectJobs: () => Promise<void>

  // LoRA state
  availableLoras: string[]
  lorasLoading: boolean
  loraWeights: Record<string, number[]>
  /** Map of LoRA filename → stable lora_id (e.g. `civitai:12345` for a
   *  CivitAI-sourced LoRA, `local:foo.safetensors` for hand-installed).
   *  Populated from /api/v1/loras/installed at boot and refreshed when
   *  LoRAs are added/removed. Used by the localStorage persistence layer
   *  to write update-resilient keys. */
  loraIdByFilename: Record<string, string>
  /** Reverse: lora_id → current filename. Used by reconciliation to
   *  detect when a saved filename has been renamed by a LoRA update. */
  filenameByLoraId: Record<string, string>
  /** Refresh `loraIdByFilename` / `filenameByLoraId` from the backend.
   *  Triggers reconciliation of savedLoraPerMode against the fresh map. */
  refreshLoraIdMap: () => Promise<void>
  loadLoras: (modelType: string) => Promise<void>
  toggleLora: (filename: string) => void
  /** Ensure the LTX-2.3 transition LoRA is downloaded and activated for
   *  blend mode. Called when blend mode is opened. Idempotent: no-op if
   *  the LoRA is already installed and activated. */
  ensureTransitionLoraForBlend: () => Promise<void>
  /** Ensure the Alissonerdx Edit Anything LoRA is downloaded. Called when
   *  the Edit Anything sub-mode is opened. Idempotent — no-op if already
   *  installed. Unlike the transition LoRA, this one is activated
   *  server-side by the /api/v1/edit-anything endpoint, not client-side,
   *  so the user's global LoRA list isn't touched. */
  ensureEditAnythingLora: () => Promise<void>
  setLoraWeight: (filename: string, phaseIndex: number, value: number) => void

  // Presets
  presets: import('../api/client').GenerationPreset[]
  presetsLoading: boolean
  loadPresets: () => Promise<void>
  savePreset: (name: string) => Promise<void>
  loadPreset: (preset: import('../api/client').GenerationPreset) => void
  deletePreset: (id: string) => Promise<void>

  // Model options
  modelOptions: ModelOptions | null
  modelOptionsLoading: boolean
  loadModelOptions: (modelType: string) => Promise<void>

  // System config
  systemConfig: SystemConfig | null
  systemConfigLoading: boolean
  loadSystemConfig: () => Promise<void>
  updateSystemConfig: (partial: Partial<SystemConfig>) => Promise<void>

  // Hardware detect — populated lazily when Settings → System opens.
  // Shared between AutoPerformanceCard (the readout) and the rest of
  // the System panel (e.g. the VRAM coefficient subtext that needs to
  // know the user's actual VRAM size, not a hardcoded 24GB).
  systemDetect: SystemDetectResponse | null
  loadSystemDetect: () => Promise<void>
  systemStats: SystemStats | null
  loadSystemStats: () => Promise<void>

  // Settings tab
  settingsTab: SettingsTab
  setSettingsTab: (tab: SettingsTab) => void

  // Select model (triggers side effects)
  selectModel: (modelType: string) => void

  // Workspaces
  workspaces: Workspace[]
  activeWorkspace: string
  /** Gallery is showing the virtual "Uploads" view (browse-only — the
   *  server-side active workspace, and where generations save, is
   *  untouched). Entered via switchWorkspace('__uploads__'). */
  browsingUploads: boolean
  loadWorkspaces: () => Promise<void>
  switchWorkspace: (name: string) => Promise<void>
  createWorkspace: (name: string) => Promise<void>
  deleteWorkspace: (name: string) => Promise<void>

  /** Storage settings: where the backend creates new workspaces.
   *  Configured by the user in Configurations > Storage. The backend
   *  resolves this to either the configured path or the OS-default
   *  Videos folder on every request. Hydrated once at boot and
   *  refreshed by `setProjectsRoot`. */
  projectsRoot: ProjectsRootInfo | null
  loadProjectsRoot: () => Promise<void>
  /** Update the backend's projects root. Empty string reverts to the
   *  default. On success, refreshes the workspace list so the gallery
   *  picks up paths under the new root. */
  setProjectsRoot: (path: string) => Promise<ProjectsRootInfo>

  /**
   * ProjectSetup for the active workspace — the project-level choices
   * (aspect ratio, resolution, models, workflow flags, audio defaults,
   * default LoRAs, advanced) that every generation in this project
   * starts from. Hydrated on `switchWorkspace` so the Director
   * planning UI and the Studio controls share the same source of
   * truth: open a project and you get your defaults back.
   *
   * `null` before the first workspace switch completes (avoids showing
   * stale defaults from the previous project during the network hop)
   * or for the implicit "default" workspace, which holds no setup.
   */
  activeWorkspaceSetup: ProjectSetupDefaults | null
  /** True while a loadWorkspaceSetup call is in flight. */
  activeWorkspaceSetupLoading: boolean
  /** True while a loadWorkspaces call is in flight. UI uses it to
   *  show a skeleton grid instead of the empty-state placeholder. */
  workspacesLoading: boolean
  loadWorkspaceSetup: (name: string) => Promise<void>
  /** Replace the active workspace's setup and persist via PUT. Pass
   *  the FULL setup payload — partial updates would race with later
   *  edits and corrupt per-field changes (a long-standing bug from
   *  the previous per-pipeline model). */
  saveWorkspaceSetup: (setup: ProjectSetupDefaults) => Promise<void>
  /** Apply the loaded setup to the Director runtime fields and the
   *  Studio model selectors. Called on hydration AND on save so the
   *  editor reflects the user's choices without a workspace hop. */
  applyWorkspaceSetup: (setup: ProjectSetupDefaults) => void
  loadDirectorDraft: (name: string) => Promise<void>
  saveDirectorDraftNow: () => Promise<void>
  clearDirectorDraft: () => Promise<void>
  directorDraftSnapshots: Array<{
    timestamp: number
    label?: string
    plannedClips?: PlannedClip[]
    clipPlans?: ClipPlan[]
    sceneDescription?: string
  }>
  restoreDraftSnapshot: (index: number) => Promise<void>

  // LoRA picker sort order — store-backed (not per-component state) so
  // simultaneously mounted pickers (e.g. Director's Image + Video
  // accordions) stay in sync; persisted to localStorage.
  loraPickerSort: 'name' | 'newest'
  setLoraPickerSort: (sort: 'name' | 'newest') => void

  // Outputs
  outputs: OutputFile[]
  outputsTotal: number
  selectedOutput: number
  setSelectedOutput: (i: number) => void
  mediaFilter: MediaFilter
  outputSearchQuery: string
  setMediaFilter: (f: MediaFilter) => void
  setOutputSearchQuery: (q: string) => void
  filteredOutputs: () => OutputFile[]
  outputsLoading: boolean
  loadOutputs: () => Promise<void>
  loadMoreOutputs: () => Promise<void>
  refreshOutputs: () => Promise<void>
  toggleFavorite: (name: string) => Promise<void>

  // Media gallery (medias tab) — selection state for bulk actions.
  // Lives in the store so the gallery and inspector agree on which files
  // are checked even if the user scrolls through one and acts on the
  // other. Cleared when the user navigates away or the underlying
  // outputs list mutates significantly.
  mediaGallerySelectedNames: Set<string>
  setMediaGallerySelectedNames: (next: Set<string>) => void
  toggleMediaGallerySelection: (name: string) => void
  toggleMediaGallerySelectionRange: (fromName: string, toName: string) => void
  selectAllMediaGallery: (names: string[]) => void
  clearMediaGallerySelection: () => void
  bulkDeleteSelectedOutputs: () => Promise<{ deleted: number; failed: number }>

  // Output metadata (lazy-loaded for selected output)
  selectedOutputMeta: OutputMetadata | null
  metadataLoading: boolean
  loadOutputMetadata: (name: string) => Promise<void>
  loadSettingsFromOutput: () => Promise<void>
  rerollGeneration: () => Promise<void>
  deleteSelectedOutput: () => Promise<void>
  rejoinClipGroup: (groupId: string) => Promise<void>

  // Services config
  servicesConfig: ServicesConfig | null
  servicesConfigLoading: boolean
  loadServicesConfig: () => Promise<void>
  updateServicesConfig: (partial: Partial<ServicesConfig>) => Promise<void>

  // LLM state
  llmStatus: LlmStatus | null
  llmLoading: boolean
  llmModels: LlmModelOption[]
  llmRoles: LlmRolesState | null
  loadLlmStatus: () => Promise<void>
  loadLlmModels: () => Promise<void>
  loadLlmRoles: () => Promise<void>
  saveLlmRoles: (data: LlmRolesState) => Promise<void>
  testServerConnection: (params: {
    provider: string
    remote_url?: string
    api_key?: string
  }) => Promise<{ status: string; latency_ms: number; models?: string[]; error?: string }>
  loadLlm: () => Promise<void>
  unloadLlm: () => Promise<void>

  // Prompt enhancement
  isEnhancing: boolean
  promptEnhanceError: string | null
  enhancePrompt: (ttsMode?: string) => Promise<void>
  h3WindowPlan: H3WindowPlan | null
  updateH3WindowPrompt: (index: number, prompt: string) => void
  moveH3Window: (fromIndex: number, toIndex: number) => void
  clearH3WindowPlan: () => void

  // Review-before-generate gate (P0). Building a review plan reuses the
  // same route/model/enhancement/frame decisions startGeneration makes, so
  // the panel previews the exact request that would be frozen on Confirm.
  reviewPlan: ReviewPlan | null
  reviewAction: 'generate' | 'queue' | null
  reviewBusy: boolean
  reviewBeforeGenerate: boolean
  setReviewBeforeGenerate: (enabled: boolean) => void
  openGenerationReview: (action: 'generate' | 'queue') => Promise<void>
  confirmGenerationReview: (action?: 'generate' | 'queue') => Promise<void>
  closeGenerationReview: () => void
  restoreGenerationReview: () => Promise<void>

  // Director (Music Video Director)
  // Strategy B compat: the underlying storage type accepts the legacy
  // values too so persisted UI state with 'director' | 'studio' loads
  // without crashing. The store's setSidebarMode translates them on
  // write so the runtime invariant is AppMode.
  appSection: AppSection
  setAppSection: (section: AppSection) => void
  sidebarMode: AppMode | 'director' | 'studio'
  /** Strategy B (Director-as-Stage) rollout flag. When true, the
   *  Sidebar mounts `<DirectorStage/>` as a tab inside the Workspace
   *  instead of forcing `sidebarMode === 'director'`. Off by default
   *  so the rollout can be flipped at runtime without code changes.
   *  Reads come from `servicesConfig.show_experimental` until the
   *  feature graduates (then pinned true). */
  workspaceUnifiedDirector: boolean
  /** Active in-workspace stage. Only meaningful when
   *  `workspaceUnifiedDirector` is on and `sidebarMode === 'studio'`.
   *  Defaults to 'studio' so existing users see no change after
   *  enabling the flag. */
  workspaceStage: 'studio' | 'director'
  directorStep: DirectorStep

  /**
   * Derived from the live pipeline status (status.phase + progress.message +
   * whether the LLM streaming flag is set). Returns a single human-readable
   * label describing WHAT the Director is doing right now — replaces the
   * hard-coded "Recalculating…" string that used to live in the
   * CLIP STRUCTURE card and stayed on-screen no matter which long-running
   * step was actually in flight.
   *
   * Possible values:
   *   "Idle"                            – nothing running
   *   "Planning with LLM…"              – phase=planning, first LLM pass
   *   "Polishing prompts…"              – phase=polishing_prompts (3rd pass)
   *   "Generating start image N/M…"     – phase=generating_images
   *   "Writing video prompts…"          – phase=preparing_video
   *   "Generating video clip N/M…"      – phase=generating_video
   *   "Finalizing…"                     – phase=post_processing
   *   <backend progress.message>        – fallback when no phase matches
   */
  directorAudioFile: File | null
  directorAudioPath: string | null
  directorAnalysis: AudioAnalysisResult | null
  directorApplyTimeline: (slots: SceneSlot[], original: PlannedClip[]) => Promise<void>
  directorPlannedClips: PlannedClip[]
  directorEnergyBias: number
  directorClipPlans: ClipPlan[]
  directorSelectedClipIndex: number
  setDirectorSelectedClipIndex: (index: number) => void
  directorSceneDescription: string
  directorLoading: boolean
  /** Sub-status for the current loading phase (e.g. "Loading
   *  transcription model (first use downloads ~300MB)..."). Set by
   *  the analyze polling loop in directorUploadAndAnalyze; read by
   *  the sidebar loading spinner. Falls back to a default like
   *  "Analyzing audio..." in the UI when null. */
  directorLoadingMessage: string | null
  /** Derived from the live pipeline status — replaces the hard-coded
   *  "Recalculating…" label that used to sit in the CLIP STRUCTURE card.
   *  See _computeDirectorActivity in useStore.ts. */
  directorActivityLabel: string
  /** 0..1 progress for the active phase; NaN when indeterminate
   *  (e.g. mid-LLM-streaming when the backend hasn't reported step counts). */
  directorActivityFraction: number
  /** Typed failure surface — accepts either the new `DirectorError`
   *  (rich: kind, phase, actions, recoverable, …) or a legacy plain
   *  string for callers that haven't migrated yet. `normalizeDirectorError`
   *  in stores/directorError.ts converts strings to the typed shape so
   *  the DirectorErrorBanner can always render rich actions. */
  directorError: DirectorError | string | null
  clearDirectorError: () => void
  directorReferenceImage: File | null
  directorReferenceImagePath: string | null
  /** Ordered mixed-media references used by H3 Omni Director projects. */
  directorH3References: MiniMaxH3Reference[]
  directorH3ReferenceDetail: 'match' | 'max'
  setDirectorH3References: (references: MiniMaxH3Reference[]) => void
  setDirectorH3ReferenceDetail: (detail: 'match' | 'max') => void
  directorCharacterRefs: File[]
  directorCharacterRefPaths: string[]
  directorCharacterRefLabels: string[]
  directorLocationRefs: File[]
  directorLocationRefPaths: string[]
  directorLocationRefLabels: string[]
  directorVoiceRef: File | null
  directorVoiceRefPath: string | null
  directorIdentityGuidanceScale: number
  /** Experimental: bypass the safety check that disables ID-LoRA reference
   *  audio concatenation on the distilled LTX-2.3 pipeline. The base
   *  distilled model produces noise when ref tokens are prepended, but
   *  newer ID-LoRA variants (e.g. AviadDahan CelebVHQ-3K) claim distilled
   *  compatibility — this flag lets users test those LoRAs.
   *
   *  REMOVED 2026-05-26: Per WanGP v11.77 testing, the CelebVHQ ID-LoRA
   *  works on both dev and distilled. The block-on-distilled gate and
   *  this experimental override are both gone. The comment is preserved
   *  for historical context only. */
  setDirectorVoiceRef: (file: File | null) => void
  setDirectorIdentityGuidanceScale: (v: number) => void
  directorClipImages: DirectorClipImage[]
  /** Set or clear an optional user-supplied start image for one manually
   *  reviewed Director scene. */
  directorSetClipImage: (clipIndex: number, file: File | null) => void
  directorImageGenProgress: DirectorImageGenProgress | null
  /** Sub-step counter for the audio analyze phase. Fed by the
   *  /api/v1/audio/analyze/status polling loop; `null` means "no
   *  analyze in flight" and the status strip falls back to an
   *  indeterminate spinner. See `DirectorAnalyzeProgress`. */
  directorAnalyzeProgress: DirectorAnalyzeProgress | null
  setDirectorAnalyzeProgress: (progress: DirectorAnalyzeProgress | null) => void
  directorSpeakers: string[]
  directorSpeakerMappings: SpeakerMapping[]
  directorAutoMode: boolean
  directorSeamless: boolean
  directorShotImageGuidance: DirectorShotImageGuidance
  /** Completed LLM stream outputs, kept so the thinking/output boxes stay
   *  in the chat history after each stage finishes instead of vanishing. */
  directorLlmLog: { stage: string; text: string }[]
  directorAppendLlmLog: (stage: string, text: string) => void
  directorSkill: DirectorSkill | null
  directorResolution: ResolutionPreset
  directorAspectRatio: AspectRatio
  /** Director-owned inference-step choices, keyed by video model. Keeping
   *  these separate from Studio prevents one surface from silently changing
   *  the other and lets each Director model retain its own valid recipe. */
  directorVideoInferenceStepsByModel: Record<string, number>
  /** Optional expert override of Director's hardware-safe native-shot cap. */
  directorVideoMaxShotFramesByModel: Record<string, number>
  /** Director-owned H3 Turbo choices, separate from Studio's active mode. */
  directorH3TurboModeByModel: Record<string, boolean>
  /** Director-owned managed H3 Turbo checkpoint choice. */
  directorH3TurboPresetByModel: Record<string, string>
  /** Director-owned experimental H3 Sol Engine choices. */
  directorH3SolModeByModel: Record<string, boolean>
  /** Director-owned H3 First Block Cache choices and tuning. */
  directorH3FirstBlockCacheByModel: Record<string, boolean>
  directorH3FirstBlockCacheMultiplierByModel: Record<string, number>
  directorH3FirstBlockCacheWarmupByModel: Record<string, number>
  setDirectorAutoMode: (v: boolean) => void
  setDirectorSeamless: (v: boolean) => void
  setDirectorShotImageGuidance: (v: DirectorShotImageGuidance) => void
  setDirectorSkill: (skill: DirectorSkill) => void
  setDirectorResolution: (preset: ResolutionPreset) => void
  setDirectorAspectRatio: (ratio: AspectRatio) => void
  setDirectorVideoInferenceSteps: (modelType: string, steps: number | null) => void
  setDirectorVideoMaxShotFrames: (modelType: string, frames: number | null) => void
  setDirectorH3TurboMode: (modelType: string, enabled: boolean) => void
  setDirectorH3TurboPreset: (modelType: string, presetId: string) => void
  setDirectorH3SolMode: (modelType: string, enabled: boolean) => void
  setDirectorH3FirstBlockCache: (modelType: string, enabled: boolean) => void
  setDirectorH3FirstBlockCacheMultiplier: (modelType: string, value: number) => void
  setDirectorH3FirstBlockCacheWarmup: (modelType: string, value: number) => void
  selectDirectorImageModel: (modelType: string) => void
  selectDirectorVideoModel: (modelType: string) => void
  directorSetLora: (mode: 'image' | 'video', activated_loras: string[], loras_multipliers: string, loraWeights: Record<string, number[]>, availableLoras: string[]) => void
  // Strategy B compat: accepts both the new AppMode ('workspace' | 'editor')
  // and legacy values ('director' | 'studio'). Legacy values are translated
  // to the new mode + workspaceStage combination before storage.
  setSidebarMode: (mode: AppMode | 'director' | 'studio') => void
  /** Open the Director planning UI as an in-Workspace stage. No-op if
   *  `workspaceUnifiedDirector` is false. */
  openDirectorStage: () => void
  /** Close the in-Workspace Director stage and return to Studio. */
  closeDirectorStage: () => void
  /** Flip the rollout flag at runtime (Settings → Beta features, or
   *  tests). Persists to localStorage so a refresh keeps the choice. */
  setWorkspaceUnifiedDirector: (enabled: boolean) => void
  /** Reset only the Director skill selection, leaving the rest of the
   *  Stage state intact. Used by the "Choose different skill" button
   *  in the DirectorStage header so the user can switch between
   *  Music Video ↔ Short Film without losing scene description,
   *  analysis results, or in-flight plan progress. The pipeline
   *  status is also cleared so the Stage does not straddle two
   *  skills mid-pipeline. */
  resetDirectorSkillOnly: () => void
  directorSetSpeakerMapping: (speakerId: string, name: string, role: SpeakerMapping['role'], image?: File | null, imagePreview?: string | null) => void
  directorInsertSpeakerMention: (speakerId: string) => void
  directorUploadAndAnalyze: (file: File) => Promise<void>
  // Music Video: generate-the-track source + song setup
  directorMusicSource: 'upload' | 'generate' | null
  directorMusicModel: string
  /** Free-form advanced defaults from the project's setup.json
   *  (film grain, spatial upsampling, inference step tweaks, …).
   *  Mirrors `ProjectSetupDefaults.advanced` — stored on the
   *  Director slice so the right column can surface the knobs as
   *  per-take overrides without re-fetching the setup on every
   *  render. */
  directorAdvancedDefaults: Record<string, unknown>
  directorSongDescription: string
  directorSongInstrumental: boolean
  directorSongStyle: string
  directorSongLyrics: string
  directorSongDuration: number
  directorTrackGenerating: boolean
  setDirectorMusicSource: (s: 'upload' | 'generate' | null) => void
  setDirectorMusicModel: (modelType: string) => void
  setDirectorSongDescription: (v: string) => void
  setDirectorSongInstrumental: (v: boolean) => void
  setDirectorSongStyle: (v: string) => void
  setDirectorSongLyrics: (v: string) => void
  setDirectorSongDuration: (v: number) => void
  directorWriteSong: () => Promise<void>
  directorGenerateTrack: (mode?: 'now' | 'queue') => Promise<void>
  directorSetAudioFile: (file: File | null) => void
  /** Project-scoped "what to avoid" prompt. Generated once per project
   *  from the scene description + style bibles, persisted server-side
   *  keyed by pipeline_id, then injected into every clip generation
   *  automatically. Editable in the Generation Options column. */
  directorNegativePrompt: string
  /** LLM-backed derivation of directorNegativePrompt from the current
   *  scene description. Called by the auto-generate hook after the
   *  user commits the brief; the result is sent to the backend via
   *  setDirectorNegativePrompt (which stores it on the active
   *  pipeline_id) and mirrored into the local store slice so the UI
   *  shows it without a refetch. */
  directorGenerateNegativePrompt: () => Promise<void>
  directorSetNegativePrompt: (v: string) => Promise<void>
  directorAnalyzeAndPlan: (audioPath: string, opts?: { transcribe?: boolean; lyricsHint?: string }) => Promise<void>
  directorEnsureStructure: () => Promise<Awaited<ReturnType<typeof import('../api/client').planClipStructure>>>
  directorSetEnergyBias: (bias: number) => Promise<void>
  directorConfirmStructure: () => void
  directorSetSceneDescription: (prompt: string) => void
  directorSetReferenceImage: (file: File | null) => void
  directorAddCharacterRef: (file: File) => void
  directorRemoveCharacterRef: (index: number) => void
  directorSetCharacterRefLabel: (index: number, label: string) => void
  directorReorderCharacterRefs: (from: number, to: number) => void
  directorAddLocationRef: (file: File) => void
  directorRemoveLocationRef: (index: number) => void
  directorSetLocationRefLabel: (index: number, label: string) => void
  directorReorderLocationRefs: (from: number, to: number) => void
  directorPlanPrompts: () => Promise<void>
  directorPlanVideoPrompts: () => Promise<void>
  /** Abort an in-flight Director v2 plan. Strategy B exposes this on
   *  the Stage wrapper's X button (next to the "Writing scenes..."
   * spinner) so users can stop a long LLM call without waiting for
   * the server-side response to land. Server-side: hits
   * /api/v1/director/v2/plan/cancel to flip the worker thread's
   * Event. Client-side: aborts the in-flight fetch via
   * AbortController. */
  cancelDirectorV2Plan: () => void
  /** Stop an in-flight audio analyze (upload track or generated-song
   *  chain). Aborts the HTTP request, stops the analyze-status poll
   *  and drops back to the upload step. Returns true when something
   *  was actually running. */
  cancelDirectorAnalyze: () => boolean
  /** Stop an in-flight track generation ("Writing song…" /
   *  "Generating music…"). Late completions are ignored via sequence
   *  guard. Returns true when something was actually running. */
  cancelDirectorTrackGen: () => boolean
  /** Stop start-image generation mid-run. Cancels the in-flight Studio
   *  job server-side, keeps already-generated images and drops back to
   *  the image-prompt review step so the user can re-run. Returns true
   *  when something was actually running. */
  cancelDirectorImageGen: () => boolean
  directorGenerateStartImages: () => Promise<void>
  directorApplyToClips: () => void
  directorGenerate: () => void
  directorReset: () => void
  directorEditClipPlan: (index: number, field: 'video_prompt' | 'image_prompt', value: string) => void
  _uploadDirectorRefs: () => Promise<{ refImagePath: string | null; charPaths: string[]; locPaths: string[]; speakerImagePaths: Record<string, string> }>

  // Short Film Director
  shortFilmCharacters: ShortFilmCharacter[]
  shortFilmPath: ShortFilmPath | null
  shortFilmTargetDuration: number
  shortFilmNarrative: boolean
  shortFilmSetCharacters: (characters: ShortFilmCharacter[]) => void
  shortFilmSetPath: (path: ShortFilmPath) => void
  shortFilmSetTargetDuration: (duration: number) => void
  shortFilmSetNarrative: (v: boolean) => void
  shortFilmUploadAndAnalyze: (file: File) => Promise<void>
  shortFilmSetPacingBias: (bias: number) => Promise<void>
  shortFilmPlanPrompts: () => Promise<void>
  shortFilmPlanVideoPrompts: () => Promise<void>
  shortFilmPlanFromStory: () => Promise<void>

  // LLM streaming
  llmStreamText: string
  llmStreamDone: boolean

  // Director Pipeline (server-side)
  pipelineId: string | null
  pipelineStatus: import('../api/client').PipelineStatus | null
  pipelinePolling: boolean
  /** Source revision and stable project lineage for Open & Edit reruns. */
  directorSourcePipelineId: string | null
  directorProjectId: string | null
  startDirectorPipeline: (mode?: 'now' | 'queue') => Promise<void>
  continuePipeline: (updates?: { clip_plans?: Array<{ video_prompt: string; image_prompt: string }> }) => Promise<void>
  stopPipeline: () => Promise<void>
  pollPipelineStatus: () => void
  /** Unified cancel for whatever is currently running inside the
   *  Workspace. Strategy B (Director-as-Stage) replaces the four
   *  different cancel surfaces with one entry point:
   *
   *    - if a v2 plan is in flight → flip v2_plan_cancel event +
   *      abort the in-flight fetch
   *    - if a Director pipeline (generation) is running → stop_pipeline
   *      + abort each child job in _pipeline_child_jobs[pid]
   *    - if a single Studio job is active → request_cancel for that job
   *    - if audio analyze / track generation / image generation is in
   *      flight → their dedicated cancel actions (each self-guards on
   *      its own phase, so calling them here is always safe)
   *
   *  Returns a structured result so callers / tests can assert what was
   *  cancelled without polling state. */
  cancelPlan: () => Promise<{
    cancelledV2Plan: boolean
    cancelledPipeline: boolean
    cancelledJobs: number
    cancelledAnalyze: boolean
    cancelledTrackGen: boolean
    cancelledImageGen: boolean
  }>
}

const defaultParams: GenerateParams = {
  prompt: '',
  model_type: 'ltx2_22B_distilled_1_1',
  resolution: '1280x720',
  video_length: 251,
  num_inference_steps: 8,
  guidance_scale: 1.0,
  seed: -1,
  image_mode: 0,
  negative_prompt: '',
  repeat_generation: 1,
  activated_loras: [],
  loras_multipliers: '',
  skip_steps_cache_type: '',
  skip_steps_multiplier: 0.08,
  skip_steps_start_step_perc: 25,
  _duration_planning_mode: 'auto',
  settings_version: 2.52,
}

async function _buildDirectorRestorePatch(
  pipeline: SavedPipelineState,
  paramsOverride?: Record<string, unknown>,
): Promise<Partial<AppState>> {
  const params = paramsOverride || _record(pipeline._params_snapshot)
  const ui = _record(pipeline.director_ui_snapshot || params.director_ui_snapshot)
  const manifest = _record(pipeline.asset_manifest || params._director_asset_manifest)

  const plannedClips = (
    Array.isArray(ui.directorPlannedClips) ? ui.directorPlannedClips
      : pipeline.clips.map(clip => clip.planned_clip).filter(Boolean)
  ) as PlannedClip[]
  const clipPlans = pipeline.clips.length
    ? pipeline.clips.map(clip => {
        const raw = clip as PipelineClipState & Record<string, unknown>
        const modelContracts = Object.fromEntries(
          Object.entries(raw).filter(([key]) => key.startsWith('_director_')),
        )
        return {
          ...modelContracts,
          video_prompt: clip.video_prompt || '',
          image_prompt: clip.image_prompt || '',
          ...(clip.window_prompts?.length ? { window_prompts: clip.window_prompts } : {}),
          ...(clip.keyframe_prompts?.length ? { keyframe_prompts: clip.keyframe_prompts } : {}),
          ...(clip.window_count > 1 ? { window_count: clip.window_count } : {}),
          ...(Array.isArray(raw.visual_changes) ? { visual_changes: raw.visual_changes } : {}),
          ...(typeof raw.image_source === 'string' ? { image_source: raw.image_source } : {}),
        }
      }) as ClipPlan[]
    : (Array.isArray(ui.directorClipPlans) ? ui.directorClipPlans as ClipPlan[] : [])

  let analysis = _record(ui.directorAnalysis) as unknown as AudioAnalysisResult | null
  if (!Object.keys(_record(analysis)).length) {
    const duration = plannedClips.length
      ? Number(plannedClips[plannedClips.length - 1].end || 0)
      : Number(params.target_duration || 0)
    analysis = duration > 0 ? {
      duration,
      sample_rate: 0,
      bpm: Number(params.bpm || 0),
      beats: [],
      downbeats: [],
      sections: plannedClips.map(clip => ({
        start: clip.start,
        end: clip.end,
        label: clip.section_label || 'scene',
        energy: clip.energy || 0.5,
      })),
      onset_envelope: [],
      lyrics: Array.isArray(params.lyrics) ? params.lyrics as AudioAnalysisResult['lyrics'] : null,
      vocals_path: typeof params.audio_vocals_path === 'string' ? params.audio_vocals_path : null,
    } : null
  }

  const referencePath = typeof params.reference_image_path === 'string'
    ? params.reference_image_path
    : pipeline.reference_image_path
  const referenceServePath = _directorServePath(
    manifest, 'reference_image_path', referencePath,
  )
  const referenceName = _assetName(referencePath, 'reference.png')
  const referenceFile = await _loadDirectorImageFile(referenceServePath, referenceName)

  const characterPaths = _stringArray(
    params.character_ref_paths || pipeline.character_ref_paths,
  )
  const locationPaths = _stringArray(
    params.location_ref_paths || pipeline.location_ref_paths,
  )
  const characterFiles = await Promise.all(characterPaths.map(async (path, index) => {
    const name = _assetName(path, `character-${index + 1}.png`)
    return await _loadDirectorImageFile(
      _directorServePath(manifest, 'character_ref_paths', path, index), name,
    ) || new File([], name, { type: 'image/png' })
  }))
  const locationFiles = await Promise.all(locationPaths.map(async (path, index) => {
    const name = _assetName(path, `location-${index + 1}.png`)
    return await _loadDirectorImageFile(
      _directorServePath(manifest, 'location_ref_paths', path, index), name,
    ) || new File([], name, { type: 'image/png' })
  }))

  const clipImages = (
    await Promise.all(pipeline.clips.map(async (clip, index) => {
      if (!clip.start_image_filename) return null
      const file = await _loadDirectorImageFile(
        _directorServePath(
          manifest,
          'prepared_clip_image_paths',
          clip.start_image_filename,
          index,
        ),
        _assetName(clip.start_image_filename, `scene-${index + 1}.png`),
      )
      return {
        clipIndex: index,
        prompt: clip.image_prompt || '',
        file: file || new File([], _assetName(clip.start_image_filename, `scene-${index + 1}.png`), { type: 'image/png' }),
        filename: clip.start_image_filename,
      } satisfies DirectorClipImage
    }))
  ).filter((image): image is DirectorClipImage => image !== null)

  const audioPath = typeof params.audio_path === 'string' ? params.audio_path : null
  const audioName = typeof ui.directorAudioName === 'string'
    ? ui.directorAudioName
    : _assetName(audioPath, 'Director audio')
  const voicePath = typeof params.voice_reference === 'string' ? params.voice_reference : null
  const voiceName = typeof ui.directorVoiceRefName === 'string'
    ? ui.directorVoiceRefName
    : _assetName(voicePath, 'Voice reference')
  const persistedH3References = Array.isArray(params.minimax_h3_references)
    ? params.minimax_h3_references
        .map((raw, index): MiniMaxH3Reference | null => {
          const reference = _record(raw)
          const kind = reference.type === 'video'
            ? 'video'
            : reference.type === 'audio' ? 'audio' : 'image'
          const path = typeof reference.path === 'string' ? reference.path : ''
          if (!path) return null
          const manifestItem = _directorAssetItem(
            manifest, 'minimax_h3_references', index,
          )
          const pathAsset = _record(manifestItem.path)
          const servePath = typeof pathAsset.serve_path === 'string'
            ? pathAsset.serve_path
            : _assetName(path, '')
          const attachedPath = typeof reference.audio_path === 'string'
            ? reference.audio_path : undefined
          const attachedAsset = _record(manifestItem.audio_path)
          const restoredAttachedPath = typeof attachedAsset.path === 'string'
            ? attachedAsset.path : attachedPath
          return {
            ...(reference as unknown as MiniMaxH3Reference),
            id: typeof reference.id === 'string' && reference.id
              ? reference.id : `director-omni-${index + 1}`,
            type: kind,
            path: typeof pathAsset.path === 'string' ? pathAsset.path : path,
            filename: typeof reference.filename === 'string' && reference.filename
              ? reference.filename : _assetName(path, `${kind}-${index + 1}`),
            url: servePath ? api.getFileUrl(servePath) : undefined,
            ...(restoredAttachedPath ? { audio_path: restoredAttachedPath } : {}),
          }
        })
        .filter((reference): reference is MiniMaxH3Reference => reference !== null)
    : []

  // Older H3 Omni Director projects predate the ordered mixed-media editor.
  // Upgrade their legacy main/character/location/voice assets in memory so
  // Open & Edit immediately exposes the modern controls without rewriting the
  // saved revision until the user submits a new one.
  const directorH3References: MiniMaxH3Reference[] = [...persistedH3References]
  const isLegacyH3Omni = String(params.video_model || pipeline.video_model || '')
    .toLowerCase().startsWith('minimax_h3_ref2va')
  if (isLegacyH3Omni && directorH3References.length === 0) {
    if (referencePath) {
      directorH3References.push({
        id: 'director-omni-primary',
        type: 'image',
        path: referencePath,
        filename: referenceName,
        url: referenceServePath ? api.getFileUrl(referenceServePath) : undefined,
        role: 'the primary cast identity and appearance',
        image_intent: 'identity',
      })
    }
    characterPaths.forEach((path, index) => directorH3References.push({
      id: `director-omni-character-${index + 1}`,
      type: 'image',
      path,
      filename: _assetName(path, `character-${index + 1}.png`),
      url: (() => {
        const servePath = _directorServePath(
          manifest, 'character_ref_paths', path, index,
        )
        return servePath ? api.getFileUrl(servePath) : undefined
      })(),
      role: _stringArray(ui.directorCharacterRefLabels || params.character_ref_labels)[index]
        || `character ${index + 1}`,
      image_intent: 'identity',
    }))
    locationPaths.forEach((path, index) => directorH3References.push({
      id: `director-omni-location-${index + 1}`,
      type: 'image',
      path,
      filename: _assetName(path, `location-${index + 1}.png`),
      url: (() => {
        const servePath = _directorServePath(
          manifest, 'location_ref_paths', path, index,
        )
        return servePath ? api.getFileUrl(servePath) : undefined
      })(),
      role: _stringArray(ui.directorLocationRefLabels || params.location_ref_labels)[index]
        || `location ${index + 1}`,
      image_intent: 'scene',
    }))
    if (voicePath) {
      directorH3References.push({
        id: 'director-omni-voice',
        type: 'audio',
        path: voicePath,
        filename: voiceName,
        role: 'the primary character voice',
        audio_intent: 'voice',
      })
    }
  }
  const pipelineType = String(params.pipeline_type || pipeline.pipeline_type || 'music_video')
  const skill: DirectorSkill = pipelineType.startsWith('short_film')
    ? 'short_film'
    : (ui.directorSkill as DirectorSkill) || 'music_video'
  const shortFilmPath: ShortFilmPath | null = pipelineType === 'short_film_story'
    ? 'story'
    : pipelineType === 'short_film_audio' ? 'audio' : null
  const savedStep = typeof ui.directorStep === 'string'
    ? ui.directorStep as AppState['directorStep'] : 'style'
  const restoreStep: AppState['directorStep'] = clipPlans.length > 0
    ? 'review_video'
    : savedStep === 'plan' || savedStep === 'generate_images' || savedStep === 'plan_video'
      ? 'style'
      : savedStep

  return {
    appSection: 'director' as const, workspaceStage: 'director' as const, sidebarMode: 'director',
    sidebarOpen: true,
    directorStep: restoreStep,
    directorSourcePipelineId: pipeline.pipeline_id,
    directorProjectId: pipeline.project_id || pipeline.pipeline_id,
    directorSkill: skill,
    shortFilmPath,
    directorSceneDescription: String(ui.directorSceneDescription || pipeline.scene_description || ''),
    // Project-scoped negative prompt isn't persisted on the server-side
    // state file yet — we re-fetch it from the dedicated endpoint below
    // (see _loadDirectorNegativePrompt) so a reopened project picks up
    // its saved "things to avoid" list rather than starting empty.
    directorNegativePrompt: '',
    directorAudioPath: audioPath,
    directorAudioFile: audioPath ? new File([], audioName, { type: 'audio/wav' }) : null,
    directorAnalysis: analysis,
    directorPlannedClips: plannedClips,
    directorEnergyBias: Number(ui.directorEnergyBias || 0),
    directorClipPlans: clipPlans,
    directorClipImages: clipImages,
    directorReferenceImage: referenceFile,
    directorReferenceImagePath: referencePath,
    directorH3References,
    directorH3ReferenceDetail: (
      params.minimax_h3_reference_detail === 'max' ? 'max' : 'match'
    ),
    directorCharacterRefs: characterFiles,
    directorCharacterRefPaths: characterPaths,
    directorCharacterRefLabels: _stringArray(ui.directorCharacterRefLabels || params.character_ref_labels),
    directorLocationRefs: locationFiles,
    directorLocationRefPaths: locationPaths,
    directorLocationRefLabels: _stringArray(ui.directorLocationRefLabels || params.location_ref_labels),
    directorVoiceRef: voicePath ? new File([], voiceName, { type: 'audio/wav' }) : null,
    directorVoiceRefPath: voicePath,
    directorIdentityGuidanceScale: Number(ui.directorIdentityGuidanceScale || params.identity_guidance_scale || 3),
    directorSpeakers: _stringArray(ui.directorSpeakers),
    directorSpeakerMappings: Array.isArray(ui.directorSpeakerMappings)
      ? ui.directorSpeakerMappings as SpeakerMapping[] : [],
    directorAutoMode: ui.directorAutoMode == null ? pipeline.auto_mode : Boolean(ui.directorAutoMode),
    directorSeamless: ui.directorSeamless == null ? pipeline.seamless : Boolean(ui.directorSeamless),
    directorShotImageGuidance: (ui.directorShotImageGuidance || pipeline.shot_image_guidance || 'auto') as DirectorShotImageGuidance,
    directorLlmLog: Array.isArray(ui.directorLlmLog)
      ? ui.directorLlmLog as { stage: string; text: string }[]
      : (pipeline.llm_log?.passes || []).map(pass => ({ stage: pass.pass, text: pass.response_text })),
    directorResolution: (ui.directorResolution || pipeline.director_resolution_preset || '720p') as ResolutionPreset,
    directorAspectRatio: (ui.directorAspectRatio || pipeline.director_aspect_ratio || '16:9') as AspectRatio,
    directorVideoInferenceStepsByModel: _record(ui.directorVideoInferenceStepsByModel) as Record<string, number>,
    directorVideoMaxShotFramesByModel: _record(ui.directorVideoMaxShotFramesByModel) as Record<string, number>,
    directorH3TurboModeByModel: _record(ui.directorH3TurboModeByModel) as Record<string, boolean>,
    directorH3TurboPresetByModel: _record(ui.directorH3TurboPresetByModel) as Record<string, string>,
    directorH3SolModeByModel: _record(ui.directorH3SolModeByModel) as Record<string, boolean>,
    directorH3FirstBlockCacheByModel: _record(ui.directorH3FirstBlockCacheByModel) as Record<string, boolean>,
    directorH3FirstBlockCacheMultiplierByModel: _record(ui.directorH3FirstBlockCacheMultiplierByModel) as Record<string, number>,
    directorH3FirstBlockCacheWarmupByModel: _record(ui.directorH3FirstBlockCacheWarmupByModel) as Record<string, number>,
    directorImageSpatialUpsampling: String(ui.directorImageSpatialUpsampling ?? params.image_spatial_upsampling ?? ''),
    directorImageFilmGrainIntensity: Number(ui.directorImageFilmGrainIntensity ?? params.image_film_grain_intensity ?? 0),
    directorImageFilmGrainSaturation: Number(ui.directorImageFilmGrainSaturation ?? params.image_film_grain_saturation ?? 0.5),
    directorVideoSpatialUpsampling: String(ui.directorVideoSpatialUpsampling ?? params.video_spatial_upsampling ?? ''),
    directorVideoFilmGrainIntensity: Number(ui.directorVideoFilmGrainIntensity ?? params.video_film_grain_intensity ?? 0),
    directorVideoFilmGrainSaturation: Number(ui.directorVideoFilmGrainSaturation ?? params.video_film_grain_saturation ?? 0.5),
    directorVideoSelfRefiner: Number(ui.directorVideoSelfRefiner ?? params.video_self_refiner ?? 0),
    directorAudioScale: Number(ui.directorAudioScale ?? params.audio_scale ?? 1),
    directorMusicSource: (ui.directorMusicSource as 'upload' | 'generate' | null) || (audioPath ? 'upload' : null),
    directorMusicModel: String(ui.directorMusicModel || 'ace_step_v1_5_xl_sft_lm_4b'),
    directorSongDescription: String(ui.directorSongDescription || ''),
    directorSongInstrumental: Boolean(ui.directorSongInstrumental),
    directorSongStyle: String(ui.directorSongStyle || ''),
    directorSongLyrics: String(ui.directorSongLyrics || ''),
    directorSongDuration: Number(ui.directorSongDuration || analysis?.duration || 120),
    shortFilmCharacters: Array.isArray(ui.shortFilmCharacters)
      ? ui.shortFilmCharacters as ShortFilmCharacter[]
      : Array.isArray(params.characters) ? params.characters as ShortFilmCharacter[] : [],
    shortFilmTargetDuration: Number(ui.shortFilmTargetDuration || params.target_duration || 30),
    shortFilmNarrative: ui.shortFilmNarrative == null
      ? Boolean(params.narrative_mode) : Boolean(ui.shortFilmNarrative),
    directorLoading: false,
    directorLoadingMessage: null,
    directorError: null,
  }
}

/** Hydrate the project-scoped negative prompt from the backend when
 *  opening a saved Director project. Silent on failure — the local
 *  slice just stays empty and the user can still type a manual one. */
async function _loadDirectorNegativePrompt(pid: string): Promise<void> {
  try {
    const { negative_prompt } = await api.getDirectorNegativePrompt(pid)
    useStore.setState({ directorNegativePrompt: negative_prompt || '' })
  } catch {
    // Best-effort; the textarea stays empty until the user types or
    // directorGenerateNegativePrompt runs again.
  }
}

// ── Per-sub-mode working sets (Studio Video) ─────────────────────────
// Frames, Multi-Shot, Extend, and Blend each keep their OWN prompt,
// input tiles, and settings. Switching the ModeToggle stashes the
// outgoing sub-mode's full working set and restores the incoming one —
// so a Frames setup with a dozen injected keyframes survives a
// round-trip through Extend untouched. First visit to a sub-mode keeps
// the generic settings (steps, resolution, ...) but blanks the input
// spec, so Extend starts clean instead of inheriting Frames' inputs.
// In-memory only: after a reload the active sub-mode is restored (via
// savedParamsPerMode) and the others start blank again.
interface VideoSubModeStash {
  params: GenerateParams
  startImage: File | null
  endImage: File | null
  continueVideo: File | null
  continueVideoPath: string
  continueVideoUrl: string
  continueVideoDuration: number
  audioGuideFilename: string | null
  imageRefs: File[]
  imageRefType: string
  removeBackgroundRefs: boolean
  durationSeconds: number
  slidingWindowSeconds: number
  slidingWindowOverlap: number
  clips: MultiClip[]
  singlePromptMode: boolean
}

const captureVideoSubModeStash = (s: AppState): VideoSubModeStash => ({
  params: { ...s.params },
  startImage: s.startImage,
  endImage: s.endImage,
  continueVideo: s.continueVideo,
  continueVideoPath: s.continueVideoPath,
  continueVideoUrl: s.continueVideoUrl,
  continueVideoDuration: s.continueVideoDuration,
  audioGuideFilename: s.audioGuideFilename,
  imageRefs: s.imageRefs,
  imageRefType: s.imageRefType,
  removeBackgroundRefs: s.removeBackgroundRefs,
  durationSeconds: s.durationSeconds,
  slidingWindowSeconds: s.slidingWindowSeconds,
  slidingWindowOverlap: s.slidingWindowOverlap,
  clips: s.clips,
  singlePromptMode: s.singlePromptMode,
})

// The "input spec" — everything the Inputs panel + prompt box write into
// params. Blanked when entering a sub-mode with no stash yet; the
// generic generation settings (steps, resolution, guidance, ...) carry
// over and only diverge per-sub-mode once the user changes them there.
const BLANK_VIDEO_INPUT_PARAMS: Partial<GenerateParams> = {
  prompt: '',
  image_start: undefined,
  image_end: undefined,
  image_refs: undefined,
  frames_positions: undefined,
  injection_strength: undefined,
  video_prompt_type: '',
  image_prompt_type: '',
  audio_prompt_type: '',
  audio_guide: undefined,
  video_guide: undefined,
  video_mask: undefined,
  minimax_h3_control_visual_mode: 'prompt',
  video_source: undefined,
  input_video_strength: undefined,
}

const resolutionMap: Record<ResolutionPreset, Record<AspectRatio, string>> = {
  'auto': {
    'auto': 'auto',
    '21:9': 'auto',
    '16:9': 'auto',
    '9:16': 'auto',
    '1:1': 'auto',
    '4:3': 'auto',
    '3:4': 'auto',
  },
  '480p': {
    'auto': 'auto_480p',
    '21:9': '1120x480',
    '16:9': '848x480',
    '9:16': '480x848',
    '1:1': '672x672',
    '4:3': '736x544',
    '3:4': '544x736',
  },
  '540p': {
    'auto': 'auto_540p',
    '21:9': '1280x544',
    '16:9': '960x544',
    '9:16': '544x960',
    '1:1': '736x736',
    '4:3': '832x608',
    '3:4': '608x832',
  },
  '720p': {
    'auto': 'auto_720p',
    // H3 is currently the only model that exposes 21:9. Keep the fallback
    // canvas on its required 32-pixel lattice if model options are briefly
    // unavailable while Director/Studio is hydrating.
    '21:9': '1632x704',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '1024x1024',
    '4:3': '1104x832',
    '3:4': '832x1104',
  },
  '768p': {
    'auto': 'auto_768p',
    '21:9': '1792x768',
    '16:9': '1344x768',
    '9:16': '768x1344',
    '1:1': '768x768',
    '4:3': '1024x768',
    '3:4': '768x1024',
  },
  '1080p': {
    'auto': 'auto_1080p',
    '21:9': '2528x1088',
    '16:9': '1920x1088',
    '9:16': '1088x1920',
    '1:1': '1024x1024',
    '4:3': '1920x1088',
    '3:4': '1088x1920',
  },
}

export function resolveResolution(
  modelOptions: ModelOptions | null,
  preset: ResolutionPreset,
  ratio: AspectRatio,
): string {
  const modelValues = modelOptions?.resolution_presets?.[preset]?.values
  return modelValues?.[ratio]
    || modelValues?.['16:9']
    || resolutionMap[preset]?.[ratio]
    || resolutionMap[preset]?.['16:9']
    || '1280x720'
}

function findResolutionSelection(
  resolution: string,
  modelOptions: ModelOptions | null,
): { preset: ResolutionPreset; ratio: AspectRatio } | null {
  const maps: Array<Partial<Record<ResolutionPreset, { values: Partial<Record<AspectRatio, string>> }>>> = []
  if (modelOptions?.resolution_presets) maps.push(modelOptions.resolution_presets)
  maps.push(Object.fromEntries(
    Object.entries(resolutionMap).map(([preset, values]) => [preset, { values }]),
  ) as Partial<Record<ResolutionPreset, { values: Partial<Record<AspectRatio, string>> }>>)

  for (const presetMap of maps) {
    for (const [preset, config] of Object.entries(presetMap)) {
      for (const [ratio, value] of Object.entries(config?.values || {})) {
        if (value === resolution) {
          return {
            preset: preset as ResolutionPreset,
            ratio: ratio as AspectRatio,
          }
        }
      }
    }
  }
  return null
}

/** Resolve whether the current Director selection owns generated per-shot
 *  images. This mirrors services/director_video_strategy.py so the manual
 *  browser flow and the durable server pipeline take the same branch. */
function _directorUsesGeneratedShotImages(state: AppState): boolean {
  const videoModel = state.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
  const selectedModel = state.models.find(
    model => model.model_type === videoModel,
  )
  const support = selectedModel?.director?.shot_image_support
  const guidance = state.directorShotImageGuidance
  if (guidance === 'prompt_only') return false
  if (guidance === 'generate') return true
  if (!support || support === 'required') return true
  if (support === 'direct_references') return false
  return Boolean(
    state.directorReferenceImage
    || state.directorReferenceImagePath
    || state.directorCharacterRefs.length
    || state.directorCharacterRefPaths.length
    || state.directorLocationRefs.length
    || state.directorLocationRefPaths.length
    || (
      selectedModel?.director?.video_strategy === 'omni_reference'
      && state.directorH3References.some(
        reference => reference.type === 'image' || reference.type === 'video',
      )
    )
  )
}

/**
 * Lightweight poller for LLM stream status during direct Director planning actions.
 * Updates llmStreamText and llmStreamDone so the activity bar displays live token counts.
 */
function _startDirectLlmStreamPolling(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState
): () => void {
  let active = true
  const timer = setInterval(async () => {
    if (!active) return
    try {
      const stream = await api.getLlmStreamStatus()
      if (!active) return
      if (stream.text && stream.text !== get().llmStreamText) {
        set({ llmStreamText: stream.text, llmStreamDone: stream.done })
      } else if (stream.done !== get().llmStreamDone) {
        set({ llmStreamDone: stream.done })
      }
    } catch {
      // Ignore network glitches during streaming poll
    }
  }, 1000)

  return () => {
    active = false
    clearInterval(timer)
  }
}

function _isOmniVideoModel(model: ModelDef | undefined): boolean {
  return Boolean(
    model?.omni_reference
    || model?.director?.video_strategy === 'omni_reference'
    || model?.model_type.toLowerCase().startsWith('minimax_h3_ref2va'),
  )
}

function _isStudioLtxVideoModel(model: ModelDef | undefined): boolean {
  const family = String(model?.family || '').toLowerCase()
  const architecture = String(model?.architecture || '').toLowerCase()
  return family === 'ltx2' || family === 'ltx25' || architecture.startsWith('ltx2')
}

function _isH3FirstLastVideoModel(model: ModelDef | undefined): boolean {
  const architecture = String(model?.architecture || '').toLowerCase()
  return architecture.startsWith('minimax_h3') && !_isOmniVideoModel(model)
}

export interface StudioVideoMediaIntent {
  workflow: 'frames' | 'references'
  hasFrameGuidance: boolean
  hasOmniReferences: boolean
  hasAudioDrive: boolean
}

/**
 * Studio Frames exposes regular T2V/I2V engines while filtering them against
 * the attached fixed-frame and audio roles. LTX/H3 need architecture fallbacks
 * because some upstream definitions do not populate the legacy flags. Studio
 * References is a separate contract and exposes only H3 Omni.
 */
export function modelSupportsStudioVideoMediaIntent(
  model: ModelDef | undefined,
  intent: StudioVideoMediaIntent,
): boolean {
  if (!model) return false
  const isOmni = _isOmniVideoModel(model)
  const isLtx = _isStudioLtxVideoModel(model)
  const isFirstLast = _isH3FirstLastVideoModel(model)
  const supportsTextGeneration = model.is_t2v || isLtx || isFirstLast
  const supportsFrameGeneration = model.is_i2v || isLtx || isFirstLast
  if (!isOmni && !supportsTextGeneration && !supportsFrameGeneration) return false

  // Frames and References are intentionally separate conditioning
  // contracts. References exposes only H3 Omni. Frames exposes LTX and H3
  // First / Last and never lets a hidden reference manifest switch engines.
  if (intent.workflow === 'references') return isOmni
  if (isOmni) return false

  if (intent.hasOmniReferences) return false
  if (intent.hasFrameGuidance && intent.hasAudioDrive) {
    return supportsFrameGeneration && model.supports_audio_input === true
  }
  if (intent.hasFrameGuidance) return supportsFrameGeneration
  if (intent.hasAudioDrive) {
    return (supportsTextGeneration || supportsFrameGeneration) && model.supports_audio_input === true
  }
  // With no media attached, show both T2V and I2V choices. Selecting an
  // I2V-only model leaves Generate disabled until the user adds a frame.
  return supportsTextGeneration || supportsFrameGeneration
}

function _pairedH3CreateModel(
  modelType: string,
  route: StudioVideoEffectiveCreateRoute,
): string | null {
  const pairs: Record<string, { firstLast: string; omni: string }> = {
    minimax_h3: { firstLast: 'minimax_h3', omni: 'minimax_h3_ref2va' },
    minimax_h3_ref2va: { firstLast: 'minimax_h3', omni: 'minimax_h3_ref2va' },
    minimax_h3_full: { firstLast: 'minimax_h3_full', omni: 'minimax_h3_ref2va_full' },
    minimax_h3_ref2va_full: { firstLast: 'minimax_h3_full', omni: 'minimax_h3_ref2va_full' },
    minimax_h3_fused_turbo: { firstLast: 'minimax_h3_fused_turbo', omni: 'minimax_h3_ref2va_fused_turbo' },
    minimax_h3_ref2va_fused_turbo: { firstLast: 'minimax_h3_fused_turbo', omni: 'minimax_h3_ref2va_fused_turbo' },
  }
  const pair = pairs[modelType]
  if (!pair) return null
  return route === 'omni' ? pair.omni : pair.firstLast
}

function _resolveStudioCreateModel(
  state: AppState,
  inputState: StudioVideoMediaIntent & { desired: StudioVideoEffectiveCreateRoute },
): string {
  const route = inputState.desired
  const currentType = String(state.params.model_type || state.selectedModelPerMode.video || '')
  const current = state.models.find(model => model.model_type === currentType)
  if (modelSupportsStudioVideoMediaIntent(current, inputState)) return currentType

  const rememberedType = state.studioVideoModelPerCreateRoute[route]
  const remembered = state.models.find(model => model.model_type === rememberedType)
  if (
    rememberedType
    && state.enabledModels.has(rememberedType)
    && modelSupportsStudioVideoMediaIntent(remembered, inputState)
  ) return rememberedType

  const pairedType = _pairedH3CreateModel(currentType, route)
  const paired = state.models.find(model => model.model_type === pairedType)
  if (
    pairedType
    && state.enabledModels.has(pairedType)
    && modelSupportsStudioVideoMediaIntent(paired, inputState)
  ) return pairedType

  const candidates = state.models.filter(model => (
    state.enabledModels.has(model.model_type)
    && modelSupportsStudioVideoMediaIntent(model, inputState)
  ))
  if (route === 'omni') {
    const prunedH3 = candidates.find(model => model.model_type === 'minimax_h3_ref2va')
    if (prunedH3) return prunedH3.model_type
  }
  return candidates[0]?.model_type || currentType
}

function _studioCreateInputState(state: AppState): {
  desired: StudioVideoEffectiveCreateRoute
  conflict: boolean
} & StudioVideoMediaIntent {
  const workflow = state.studioVideoWorkflow === 'references' ? 'references' : 'frames'
  const references = state.params.minimax_h3_references ?? []
  // An exact music/performance timeline is accepted by LTX or H3 Omni.
  // Every identity/scene/motion/voice/style reference is native Ref2VA intent.
  const hasOmniReferences = workflow === 'references' && references.some(reference => !(
    reference.type === 'audio' && reference.audio_intent === 'drive'
  ))
  const hasAudioDrive = Boolean(
    workflow === 'frames'
      ? state.params.audio_guide
      : references.some(reference => (
      reference.type === 'audio' && reference.audio_intent === 'drive'
      ))
  )
  const hasFrameGuidance = workflow === 'frames' && Boolean(
    state.startImage
    || state.endImage
    || state.params.image_start
    || state.params.image_end
    || state.imageRefs.length
    || (
      Array.isArray(state.params.image_refs)
      && state.params.image_refs.length
      && state.params.frames_positions
    )
  )
  return {
    workflow,
    desired: workflow === 'references'
      ? 'omni'
      : hasFrameGuidance
        ? 'guided'
        : hasAudioDrive
          ? 'audio'
          : 'generate',
    conflict: false,
    hasFrameGuidance,
    hasOmniReferences,
    hasAudioDrive,
  }
}

function _audioSubModeForModel(modelType: string): import('../types').AudioSubMode {
  if (sfxModelTypes.has(modelType)) return 'sfx'
  if (isMusicModelType(modelType)) return 'music'
  return 'speech'
}

/** Persist only navigation/model choices and H3 acceleration preferences.
 *  This deliberately does not restore project state, prompts, uploads,
 *  seeds, LoRAs, or general Advanced controls. The server mirror makes the
 *  choices survive Pinokio assigning a different browser origin/port. */
const _persistStickyStudioPreferences = (state: AppState) =>
  persistStickyStudioPreferences(state, _saveSettings, api.updateStudioPreferences)

export type StudioModeDependencies = {
  _initialStudioVideoRoutePreferences: typeof _initialStudioVideoRoutePreferences
  _saveStudioVideoRoutePreferences: typeof _saveStudioVideoRoutePreferences
  _studioCreateInputState: typeof _studioCreateInputState
  _resolveStudioCreateModel: typeof _resolveStudioCreateModel
  modelSupportsStudioVideoMediaIntent: typeof modelSupportsStudioVideoMediaIntent
  getDefaultModelForMode: typeof getDefaultModelForMode
  DEFAULT_RECAST_MAPPING: typeof DEFAULT_RECAST_MAPPING
  _persistStickyStudioPreferences: typeof _persistStickyStudioPreferences
  _snapshotModeParams: typeof _snapshotModeParams
  _saveSettings: typeof _saveSettings
  _restoreModeParams: typeof _restoreModeParams
  _normalizeStudioImageWorkflow: typeof _normalizeStudioImageWorkflow
  _normalizeStudioVideoWorkflow: typeof _normalizeStudioVideoWorkflow
  defaultParams: typeof defaultParams
  sfxModelTypes: typeof sfxModelTypes
  _applyModelDefaults: typeof _applyModelDefaults
  captureVideoSubModeStash: typeof captureVideoSubModeStash
  BLANK_VIDEO_INPUT_PARAMS: typeof BLANK_VIDEO_INPUT_PARAMS
}

export type StudioModelDependencies = {
  _loadEnabledModels: typeof _loadEnabledModels
  DEFAULT_ENABLED_MODELS: typeof DEFAULT_ENABLED_MODELS
  _markMatureModelsInitialized: typeof _markMatureModelsInitialized
  _saveEnabledModels: typeof _saveEnabledModels
  SFX_VIRTUAL_MODELS: typeof SFX_VIRTUAL_MODELS
  DEFAULTS_VERSION_KEY: typeof DEFAULTS_VERSION_KEY
  DEFAULTS_VERSION: typeof DEFAULTS_VERSION
  DEFAULTS_ADDED_IN: typeof DEFAULTS_ADDED_IN
  _loadSettings: typeof _loadSettings
  _audioSubModeForModel: typeof _audioSubModeForModel
  _normalizeStudioImageWorkflow: typeof _normalizeStudioImageWorkflow
  OLD_MUSIC_DEFAULT: typeof OLD_MUSIC_DEFAULT
  NEW_MUSIC_DEFAULT: typeof NEW_MUSIC_DEFAULT
  getDefaultModelForMode: typeof getDefaultModelForMode
  _normalizeStudioVideoWorkflow: typeof _normalizeStudioVideoWorkflow
  _isOmniVideoModel: typeof _isOmniVideoModel
  sfxModelTypes: typeof sfxModelTypes
  _applyModelDefaults: typeof _applyModelDefaults
  _persistStickyStudioPreferences: typeof _persistStickyStudioPreferences
  _enableUninitializedMatureModels: typeof _enableUninitializedMatureModels
  _saveSettings: typeof _saveSettings
  resolveResolution: typeof resolveResolution
}

export type StudioGenerationDependencies = {
  sfxModelTypes: typeof sfxModelTypes
  _studioCreateInputState: typeof _studioCreateInputState
  modelSupportsStudioVideoMediaIntent: typeof modelSupportsStudioVideoMediaIntent
  _isOmniVideoModel: typeof _isOmniVideoModel
  _isStudioLtxVideoModel: typeof _isStudioLtxVideoModel
  _omniEnhanceInventory: typeof _omniEnhanceInventory
  _normalizeSlidingWindowOverlap: typeof _normalizeSlidingWindowOverlap
  _adaptiveEtaJobFields: typeof _adaptiveEtaJobFields
  getReviewToken: () => number
  setReviewSnapshot: (snapshot: AppState | null) => void
}

export const useStore = create<AppState>((set, get, store) => ({
  ...createStudioGenerationSlice(set, get, {
    sfxModelTypes,
    _studioCreateInputState,
    modelSupportsStudioVideoMediaIntent,
    _isOmniVideoModel,
    _isStudioLtxVideoModel,
    _omniEnhanceInventory,
    _normalizeSlidingWindowOverlap,
    _adaptiveEtaJobFields,
    getReviewToken: () => _reviewRequestToken,
    setReviewSnapshot: (snapshot) => { _reviewSnapshot = snapshot },
  }),
  ...createStudioWorkflowSlice(set, get, {
    persist: () => _persistStickyStudioPreferences(get()),
  }),
  ...createStudioModeSlice(set, get, {
    _initialStudioVideoRoutePreferences,
    _saveStudioVideoRoutePreferences,
    _studioCreateInputState,
    _resolveStudioCreateModel,
    modelSupportsStudioVideoMediaIntent,
    getDefaultModelForMode,
    DEFAULT_RECAST_MAPPING,
    _persistStickyStudioPreferences,
    _snapshotModeParams,
    _saveSettings,
    _restoreModeParams,
    _normalizeStudioImageWorkflow,
    _normalizeStudioVideoWorkflow,
    defaultParams,
    sfxModelTypes,
    _applyModelDefaults,
    captureVideoSubModeStash,
    BLANK_VIDEO_INPUT_PARAMS
  }),

  settingsOpen: false,
  // Toggle between Configurations and Projects. Returning to `director`
  // would dump users on a workspace they may not have opened yet (it
  // requires a real workspace selected), so Projects is the fallback.
  toggleSettings: () => get().setAppSection(get().appSection === 'configurations' ? 'projects' : 'configurations'),
  setSettingsOpen: (open) => {
    if (open) get().setAppSection('configurations')
    else set({ settingsOpen: false })
  },
  sidebarOpen: false,
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  // Theme — initial value reads from localStorage (with legacy
  // single-theme migration) so it matches what the inline script in
  // index.html applied to <html>. The setters write to the DOM and
  // localStorage via applyThemePrefs, which also installs the OS
  // scheme listener that makes 'auto' live-switch.
  themePrefs: getStoredPrefs(),
  setThemeMode: (mode) => {
    const prefs = { ...get().themePrefs, mode }
    applyThemePrefs(prefs)
    set({ themePrefs: prefs })
  },
  setThemeFamily: (family) => {
    const prefs = { ...get().themePrefs, family }
    applyThemePrefs(prefs)
    set({ themePrefs: prefs })
  },

  density: getStoredDensity(),
  setDensity: (density) => {
    applyDensity(density)
    set({ density })
  },

  // Retake dialog
  retakeDialogOpen: false,
  retakeSourceFile: null,
  openRetakeDialog: (filename) => set({ retakeDialogOpen: true, retakeSourceFile: filename }),
  closeRetakeDialog: () => set({ retakeDialogOpen: false, retakeSourceFile: null }),

  ...createDirectorQueueSlice(set, get, store),
  reconnectDirectorPipelines: async () => {
    try {
      const { pipelines } = await api.fetchPipelineList()
      // Studio jobs already reconnect after a browser reload. Director
      // discovers the newest live pipeline once per page boot and reattaches
      // it without focusing the user away from the current screen; the
      // explicit Resume action is what opens the original Director chat.
      if (!_directorPipelineReconnectAttempted) {
        _directorPipelineReconnectAttempted = true
        const active = pipelines.find(item => DIRECTOR_PIPELINE_ACTIVE.has(item.status))
        if (active && !get().pipelineId) {
          void get().reattachDirectorPipeline(active.id, false)
        }
      }
    } catch (e) {
      console.error('Failed to load pipeline list:', e)
    }
  },
  rerunClipImage: async (pid: string, clipIndex: number, prompt?: string) => {
    try {
      const result = await api.rerunClipImage(pid, clipIndex, prompt)
      // New files (rerun clip / rejoin video) land in the outputs folder —
      // refresh the gallery so they appear without a browser reload.
      get().loadOutputs()
      return result
    } catch (e) {
      console.error('Re-run image failed:', e)
      throw e
    }
  },
  rerunClipVideo: async (pid: string, clipIndex: number, prompt?: string) => {
    try {
      const result = await api.rerunClipVideo(pid, clipIndex, prompt)
      get().loadOutputs()
      return result
    } catch (e) {
      console.error('Re-run video failed:', e)
      throw e
    }
  },
  rejoinPipelineClips: async (pid: string) => {
    try {
      const result = await api.rejoinPipeline(pid)
      get().loadOutputs()
      return result
    } catch (e) {
      console.error('Rejoin failed:', e)
      throw e
    }
  },
  resumePipeline: async (pid: string) => {
    // Kick the crashed pipeline back into running server-side, then restore
    // the exact Director project and reconnect its live progress.
    await api.resumePipeline(pid)
    await get().reattachDirectorPipeline(pid, true)
  },
  reattachDirectorPipeline: async (pid: string, focusDirector = false) => {
    const attachToken = ++_directorPipelineAttachToken
    const status = await api.fetchPipelineStatus(pid)
    if (attachToken !== _directorPipelineAttachToken) return

    const active = DIRECTOR_PIPELINE_ACTIVE.has(status.status)
    set(state => ({
      ...(focusDirector ? {
        // Strategy B: focusing a running pipeline jumps into the
        // in-Workspace Director Stage (post-rollout) or the legacy
        // Director sidebar (pre-rollout). Always pick the new path so
        // the cancelPlan / Stage wrapper sees the active pipeline.
        appSection: 'director' as const, sidebarMode: 'workspace' as const,
        workspaceStage: 'director' as const,
        sidebarOpen: true,
      } : {}),
      pipelineId: pid,
      pipelineStatus: status,
      pipelinePolling: active,
      directorStep: _directorStepForPipelineStatus(status, state.directorStep),
      directorLoading: status.status === 'running',
      directorLoadingMessage: status.progress?.message || null,
      directorError: status.status === 'failed' || status.status === 'cancelled'
        ? status.error || 'Pipeline stopped'
        : null,
    }))

    // Start live polling immediately so a large long-form checkpoint cannot
    // delay visible progress while its editable Director snapshot is loaded.
    if (active) get().pollPipelineStatus()

    try {
      const pipeline = await api.fetchSavedPipeline(pid)
      const restore = await _buildDirectorRestorePatch(pipeline)
      if (attachToken !== _directorPipelineAttachToken) return
      const params = _record(pipeline._params_snapshot)
      const imageParams = _record(pipeline.image_params || params.image_params)
      const videoParams = _record(pipeline.video_params || params.video_params)
      const imageLoras = _record(pipeline.image_loras || params.image_loras)
      const videoLoras = _record(pipeline.video_loras || params.video_loras)
      const imageModel = pipeline.image_model || String(params.image_model || '')
      const videoModel = pipeline.video_model || String(params.video_model || '')
      set(state => {
        const liveStatus = state.pipelineStatus?.id === pid
          ? state.pipelineStatus
          : status
        return {
          ...restore,
          // A background refresh reconnect must not change the app mode the
          // user is viewing. Explicit Resume does focus Director and opens its
          // chat, matching the action's intent.
          ...(!focusDirector ? {
            appSection: state.appSection, sidebarMode: state.sidebarMode,
            sidebarOpen: state.sidebarOpen,
          } : {
            appSection: 'director' as const, sidebarMode: 'workspace' as const,
            workspaceStage: 'director' as const,
            sidebarOpen: true,
          }),
          pipelineId: pid,
          pipelineStatus: liveStatus,
          pipelinePolling: DIRECTOR_PIPELINE_ACTIVE.has(liveStatus.status),
          directorStep: _directorStepForPipelineStatus(
            liveStatus,
            (restore.directorStep || state.directorStep) as AppState['directorStep'],
          ),
          directorLoading: liveStatus.status === 'running',
          directorLoadingMessage: liveStatus.progress?.message || null,
          directorError: liveStatus.status === 'failed' || liveStatus.status === 'cancelled'
            ? liveStatus.error || 'Pipeline stopped'
            : null,
          selectedModelPerMode: {
            ...state.selectedModelPerMode,
            ...(imageModel ? { image: imageModel } : {}),
            ...(videoModel ? { video: videoModel } : {}),
          },
          savedParamsPerMode: {
            ...state.savedParamsPerMode,
            ...(imageModel ? { image: { ...imageParams, model_type: imageModel } } : {}),
            ...(videoModel ? { video: { ...videoParams, model_type: videoModel } } : {}),
          },
          savedLoraPerMode: {
            ...state.savedLoraPerMode,
            ...(imageModel ? { image: _directorLoraState(imageLoras) } : {}),
            ...(videoModel ? { video: _directorLoraState(videoLoras) } : {}),
          },
        }
      })
      if (videoModel) {
        await get().loadModelOptions(videoModel)
        void get().loadLoras(videoModel)
      }
      // Hydrate the project-scoped negative prompt (see
      // _loadDirectorNegativePrompt) so the Generation Options textarea
      // doesn't open empty for a project that already had one.
      void _loadDirectorNegativePrompt(pid)
    } catch (error) {
      // The live status connection is still useful even if an old/corrupt
      // editable snapshot cannot be reconstructed. Never hide a running job.
      console.warn(`Reconnected Director pipeline ${pid}, but could not restore its editor snapshot:`, error)
    }
  },
  loadDirectorQueue: async () => {
    try {
      const queue = await api.fetchDirectorQueue()
      set({ directorQueue: queue, directorQueueLoading: false })
    } catch (e) {
      console.warn('Failed to load Director queue:', e)
      set({ directorQueueLoading: false })
    }
  },
  loadDirectorQueueEntry: async (entryId: string) => {
    set({ directorQueueLoading: true })
    try {
      const entry = await api.fetchDirectorQueueEntry(entryId)
      if (entry.pipeline_id && ['completed', 'failed', 'cancelled'].includes(entry.status)) {
        await get().loadDirectorFromPipeline(entry.pipeline_id)
        set({ directorQueueLoading: false })
        return
      }
      const params = entry.params
      const plans = Array.isArray(params.prepared_clip_plans)
        ? params.prepared_clip_plans as ClipPlan[] : []
      const timeline = Array.isArray(params.prepared_planned_clips)
        ? params.prepared_planned_clips as PlannedClip[] : []
      const draftPipeline: SavedPipelineState = {
        version: 2,
        pipeline_id: String(params._director_parent_pipeline_id || `queue-${entry.id}`),
        project_id: String(params._director_project_id || `queue-${entry.id}`),
        parent_pipeline_id: typeof params._director_parent_pipeline_id === 'string'
          ? params._director_parent_pipeline_id : null,
        queue_entry_id: entry.id,
        created_at: entry.created_at,
        completed_at: null,
        status: entry.status,
        pipeline_type: String(params.pipeline_type || entry.pipeline_type || 'music_video'),
        scene_description: String(params.scene_description || entry.scene_description || ''),
        reference_image_path: typeof params.reference_image_path === 'string'
          ? params.reference_image_path : null,
        character_ref_paths: _stringArray(params.character_ref_paths),
        location_ref_paths: _stringArray(params.location_ref_paths),
        auto_mode: Boolean(_record(params.director_ui_snapshot).directorAutoMode ?? params.auto_mode ?? false),
        seamless: Boolean(params.seamless),
        image_model: String(params.image_model || entry.image_model || ''),
        video_model: String(params.video_model || entry.video_model || ''),
        shot_image_guidance: (params.shot_image_guidance || 'auto') as DirectorShotImageGuidance,
        image_loras: _record(params.image_loras),
        video_loras: _record(params.video_loras),
        image_params: _record(params.image_params),
        video_params: _record(params.video_params),
        director_resolution_preset: params.director_resolution_preset as ResolutionPreset,
        director_aspect_ratio: params.director_aspect_ratio as AspectRatio,
        director_ui_snapshot: _record(params.director_ui_snapshot),
        asset_manifest: _record(params._director_asset_manifest),
        llm_log: null,
        clips: plans.map((plan, index) => ({
          index,
          planned_clip: timeline[index] || null,
          image_prompt: plan.image_prompt || '',
          video_prompt: plan.video_prompt || '',
          keyframe_prompts: [],
          window_prompts: [],
          window_count: 1,
          image_prompt_pre_polish: null,
          video_prompt_pre_polish: null,
          window_prompts_pre_polish: null,
          keyframe_prompts_pre_polish: null,
          start_image_filename: _stringArray(params.prepared_clip_image_paths)[index] || null,
          keyframe_filenames: [],
          video_filename: null,
          tag: null,
          image_gen_time_sec: null,
          video_gen_time_sec: null,
        })),
        output_files: [],
        total_time_sec: null,
        _params_snapshot: params,
      }
      const restore = await _buildDirectorRestorePatch(draftPipeline, params)
      const imageModel = draftPipeline.image_model
      const videoModel = draftPipeline.video_model
      set(s => ({
        ...restore,
        directorSourcePipelineId: typeof params._director_parent_pipeline_id === 'string'
          ? params._director_parent_pipeline_id : null,
        directorProjectId: typeof params._director_project_id === 'string'
          ? params._director_project_id : null,
        directorQueueEditingEntryId: entry.id,
        directorQueueLoading: false,
        selectedModelPerMode: {
          ...s.selectedModelPerMode,
          ...(imageModel ? { image: imageModel } : {}),
          ...(videoModel ? { video: videoModel } : {}),
        },
        savedParamsPerMode: {
          ...s.savedParamsPerMode,
          ...(imageModel ? { image: { ..._record(params.image_params), model_type: imageModel } } : {}),
          ...(videoModel ? { video: { ..._record(params.video_params), model_type: videoModel } } : {}),
        },
        savedLoraPerMode: {
          ...s.savedLoraPerMode,
          ...(imageModel ? { image: _directorLoraState(params.image_loras) } : {}),
          ...(videoModel ? { video: _directorLoraState(params.video_loras) } : {}),
        },
      }))
      if (videoModel) await get().loadModelOptions(videoModel)
      // Hydrate the project-scoped negative prompt (see
      // _loadDirectorNegativePrompt).
      const openedPid = typeof params._director_project_id === 'string'
        ? params._director_project_id
        : draftPipeline.pipeline_id
      if (openedPid) void _loadDirectorNegativePrompt(openedPid)
    } catch (e) {
      set({
        directorQueueLoading: false,
        directorError: e instanceof Error ? e.message : 'Failed to open queued project',
      })
    }
  },

  // ── Recipes (one-click Studio presets) ────────────────────────────
  ...createRecipesSlice(set, get, store),
  loadDirectorFromPipeline: async (pid) => {
    // An explicit Open & Edit owns the Director UI. Prevent a slower startup
    // reconnection from replacing this project after its fetch completes.
    _directorPipelineAttachToken += 1
    _directorPipelinePollToken += 1
    try {
      const pipeline = await api.fetchSavedPipeline(pid)
      const restore = await _buildDirectorRestorePatch(pipeline)
      const params = _record(pipeline._params_snapshot)
      const imageParams = _record(pipeline.image_params || params.image_params)
      const videoParams = _record(pipeline.video_params || params.video_params)
      const imageLoras = _record(pipeline.image_loras || params.image_loras)
      const videoLoras = _record(pipeline.video_loras || params.video_loras)
      const imageModel = pipeline.image_model || String(params.image_model || '')
      const videoModel = pipeline.video_model || String(params.video_model || '')
      set(s => ({
        ...restore,
        pipelineId: null,
        pipelineStatus: null,
        pipelinePolling: false,
        directorQueueEditingEntryId: null,
        selectedModelPerMode: {
          ...s.selectedModelPerMode,
          ...(imageModel ? { image: imageModel } : {}),
          ...(videoModel ? { video: videoModel } : {}),
        },
        savedParamsPerMode: {
          ...s.savedParamsPerMode,
          ...(imageModel ? { image: { ...imageParams, model_type: imageModel } } : {}),
          ...(videoModel ? { video: { ...videoParams, model_type: videoModel } } : {}),
        },
        savedLoraPerMode: {
          ...s.savedLoraPerMode,
          ...(imageModel ? { image: _directorLoraState(imageLoras) } : {}),
          ...(videoModel ? { video: _directorLoraState(videoLoras) } : {}),
        },
      }))
      if (videoModel) {
        await get().loadModelOptions(videoModel)
        void get().loadLoras(videoModel)
      }
      // Hydrate the project-scoped negative prompt so the textarea
      // reflects what was already generated/edited for this project.
      void _loadDirectorNegativePrompt(pid)
    } catch (e) {
      console.error('Failed to load Director pipeline:', e)
      set({ directorError: e instanceof Error ? e.message : 'Failed to open Director project' })
    }
  },

  ...createCivitAISlice(set, get, store),
  ...createStudioModelSlice(set, get, {
    _loadEnabledModels,
    DEFAULT_ENABLED_MODELS,
    _markMatureModelsInitialized,
    _saveEnabledModels,
    SFX_VIRTUAL_MODELS,
    DEFAULTS_VERSION_KEY,
    DEFAULTS_VERSION,
    DEFAULTS_ADDED_IN,
    _loadSettings,
    _audioSubModeForModel,
    _normalizeStudioImageWorkflow,
    OLD_MUSIC_DEFAULT,
    NEW_MUSIC_DEFAULT,
    getDefaultModelForMode,
    _normalizeStudioVideoWorkflow,
    _isOmniVideoModel,
    sfxModelTypes,
    _applyModelDefaults,
    _persistStickyStudioPreferences,
    _enableUninitializedMatureModels,
    _saveSettings,
    resolveResolution
  }),

  resolutionPreset: '720p',
  setResolutionPreset: (preset) => {
    const ratio = get().aspectRatio
    const resolution = resolveResolution(get().modelOptions, preset, ratio)
    set(s => ({
      resolutionPreset: preset,
      params: { ...s.params, resolution },
      h3WindowPlan: null,
    }))
  },

  aspectRatio: '16:9',
  setAspectRatio: (ratio) => {
    const preset = get().resolutionPreset
    const resolution = resolveResolution(get().modelOptions, preset, ratio)
    set(s => ({
      aspectRatio: ratio,
      params: { ...s.params, resolution },
      h3WindowPlan: null,
    }))
  },

  durationSeconds: 5,
  setDurationSeconds: (s) => {
    const options = get().modelOptions
    const fps = options?.fps ?? 16
    const nativeMinimumFrames = options?.frames_minimum || fps
    const isVideoExtend = (
      get().studioVideoWorkflow === 'extend'
      && options?.sliding_window === true
    )
    const continuationContextFrames = isVideoExtend
      ? Math.max(0, get().slidingWindowOverlap - 1)
      : 0
    const requestedMinimumFrames = Math.max(
      1,
      nativeMinimumFrames - continuationContextFrames,
    )
    const minimum = Math.max(1, requestedMinimumFrames / fps)
    const nativeMaximum = options?.frames_maximum
      ? options.frames_maximum / fps
      : null
    const isH3 = String(options?.architecture || '').startsWith('minimax_h3')
    const isLtxSequence = options?.multi_window_sequence_controls === true
    const ltxWindowDefaults = options?.sliding_window_defaults
    const ltxSinglePassMaximum = isLtxSequence
      ? (ltxWindowDefaults?.window_max ?? Math.round(20 * fps)) / fps
      : null
    const currentWindow = Math.max(minimum, get().slidingWindowSeconds)
    const currentWindowFrames = Math.round(currentWindow * fps)
    const firstWindowFrames = isVideoExtend
      ? continuationFirstWindowFrames(
          currentWindowFrames,
          get().slidingWindowOverlap,
        )
      : currentWindowFrames
    const sequenceCapable = isH3 || isLtxSequence
    const wantsSequence = sequenceCapable && s > firstWindowFrames / fps + 0.05
    const h3ReferenceSequence = isH3 && options?.omni_reference === true && wantsSequence
    const h3FirstLastMultiWindow = isH3 && options?.omni_reference !== true && wantsSequence
    const ltxMultiWindow = isLtxSequence && wantsSequence
    const h3SingleNativePass = (
      isH3
      && !wantsSequence
    )
    const maximum = isH3
      ? (h3ReferenceSequence || h3FirstLastMultiWindow
          ? 60 * 60
          : (nativeMaximum ?? Number.POSITIVE_INFINITY))
      : isLtxSequence
        ? (ltxMultiWindow
            ? 60 * 60
            : (ltxSinglePassMaximum ?? Number.POSITIVE_INFINITY))
      : (options?.sliding_window || nativeMaximum == null
          ? Number.POSITIVE_INFINITY
          : nativeMaximum)
    let seconds = Math.min(maximum, Math.max(minimum, s))
    if (
      options?.sliding_window
      && nativeMaximum
      && seconds <= Math.round(nativeMaximum * 10) / 10
    ) {
      seconds = Math.min(seconds, nativeMaximum)
    }
    let frames = Math.round(seconds * fps)
    if (h3SingleNativePass) {
      const normalizedPassFrames = normalizeH3NativeFrames(
        frames + continuationContextFrames,
        options?.frames_minimum ?? 124,
        options?.frames_maximum ?? 345,
        options?.frames_steps ?? 17,
      )
      frames = Math.max(
        requestedMinimumFrames,
        normalizedPassFrames - continuationContextFrames,
      )
      seconds = frames / fps
    }
    set(state => {
      const selectedWindowFrames = Math.round(state.slidingWindowSeconds * fps)
      const requestedPassFrames = frames + continuationContextFrames
      const expandNativeWindow = h3SingleNativePass && requestedPassFrames > selectedWindowFrames
      const nextParams = {
        ...state.params,
        video_length: frames,
        ...(isLtxSequence ? { ltx_multi_window: ltxMultiWindow } : {}),
        ...(isH3 && options?.omni_reference === true
          ? { minimax_h3_reference_sequence: h3ReferenceSequence }
          : {}),
        ...(isH3 && options?.omni_reference !== true
          ? { minimax_h3_multi_window: h3FirstLastMultiWindow }
          : {}),
        ...(expandNativeWindow
          ? {
              sliding_window_size: requestedPassFrames,
              sliding_window_memory_override: true,
              ...(state.modelOptions?.omni_reference === true
                ? { minimax_h3_sequence_memory_override: true }
                : {}),
            }
          : {}),
      }
      delete nextParams.ltx_window_prompts
      return {
        durationSeconds: seconds,
        ...(expandNativeWindow
          ? {
              slidingWindowSeconds: requestedPassFrames / fps,
              slidingWindowLocked: true,
            }
          : {}),
        params: nextParams,
        h3WindowPlan: null,
        promptEnhanceError: null,
      }
    })
    get().syncClipCount()
  },

  guideVideoFps: null,
  setGuideVideoFps: (fps) => set({ guideVideoFps: fps }),

  slidingWindowSeconds: 5,
  setSlidingWindowSeconds: (s) => {
    const options = get().modelOptions
    const fps = options?.fps ?? 16
    const swDefaults = options?.sliding_window_defaults
    let frames = Math.round(s * fps)
    if (String(options?.architecture || '').startsWith('minimax_h3')) {
      frames = normalizeH3NativeFrames(
        frames,
        options?.frames_minimum ?? 124,
        options?.frames_maximum ?? 345,
        options?.frames_steps ?? 17,
      )
    } else if (swDefaults) {
      const minimum = swDefaults.window_min ?? 1
      const maximum = swDefaults.window_max ?? frames
      const step = Math.max(1, swDefaults.window_step ?? 1)
      frames = minimum + Math.round((frames - minimum) / step) * step
      frames = Math.max(minimum, Math.min(maximum, frames))
    }
    const seconds = frames / fps
    set(state => {
      const nextParams = {
        ...state.params,
        sliding_window_size: frames,
        ...(
          state.modelOptions?.omni_reference === true
          && state.params.minimax_h3_reference_sequence === true
            ? { minimax_h3_sequence_clip_frames: frames }
            : {}
        ),
      }
      delete nextParams.ltx_window_prompts
      return {
        slidingWindowSeconds: seconds,
        params: nextParams,
        h3WindowPlan: null,
        promptEnhanceError: null,
      }
    })
    get().syncClipCount()
  },

  slidingWindowOverlap: 5,
  setSlidingWindowOverlap: (frames) => {
    set(state => {
      const normalized = _normalizeSlidingWindowOverlap(
        frames,
        state.modelOptions?.sliding_window_defaults,
      )
      const nextParams = { ...state.params, sliding_window_overlap: normalized }
      delete nextParams.ltx_window_prompts
      return {
        slidingWindowOverlap: normalized,
        params: nextParams,
        h3WindowPlan: null,
        promptEnhanceError: null,
      }
    })
  },
  slidingWindowLocked: false,
  setSlidingWindowLocked: (locked) => set(state => {
    const isH3 = String(state.modelOptions?.architecture || '').startsWith('minimax_h3')
    return {
      slidingWindowLocked: locked,
      params: isH3 ? {
          ...state.params,
          sliding_window_memory_override: locked,
          ...(state.modelOptions?.omni_reference === true
            ? { minimax_h3_sequence_memory_override: locked }
            : {}),
      } : state.params,
      h3WindowPlan: null,
      promptEnhanceError: null,
    }
  }),
  h3WindowOverrides: {},
  saveH3WindowOverride: (modelType, resolution, frames) => {
    const state = get()
    const minimum = state.modelOptions?.frames_minimum ?? 124
    const maximum = state.modelOptions?.frames_maximum ?? 345
    const step = state.modelOptions?.frames_steps ?? 17
    const normalizedFrames = normalizeH3NativeFrames(
      frames,
      minimum,
      maximum,
      step,
    )
    const key = h3WindowOverrideKey(modelType, resolution)
    const next = { ...state.h3WindowOverrides, [key]: normalizedFrames }
    set({ h3WindowOverrides: next })
    _saveH3WindowOverrides(next)
  },
  clearH3WindowOverride: (modelType, resolution) => {
    const state = get()
    const key = h3WindowOverrideKey(modelType, resolution)
    if (!(key in state.h3WindowOverrides)) return
    const next = { ...state.h3WindowOverrides }
    delete next[key]
    set({ h3WindowOverrides: next })
    _saveH3WindowOverrides(next)
  },

  outputCount: 1,
  setOutputCount: (n) => set(s => ({
    outputCount: n,
    params: { ...s.params, repeat_generation: n },
  })),

  startImage: null,
  endImage: null,
  setStartImage: (f) => {
    set(s => ({
      startImage: f,
      params: f === null ? { ...s.params, image_start: undefined } : s.params,
      h3WindowPlan: null,
    }))
    get().reconcileStudioVideoCreateRoute(f ? 'Start frame added' : 'Start frame removed')
  },
  setEndImage: (f) => {
    set(s => ({
      endImage: f,
      params: f === null ? { ...s.params, image_end: undefined } : s.params,
      h3WindowPlan: null,
    }))
    get().reconcileStudioVideoCreateRoute(f ? 'End frame added' : 'End frame removed')
  },

  imageWorkflowSourceFile: null,
  imageWorkflowSourcePath: '',
  imageWorkflowSourceUrl: '',
  setImageWorkflowSource: (source) => set(state => ({
    imageWorkflowSourceFile: source?.file ?? null,
    imageWorkflowSourcePath: source?.path ?? '',
    imageWorkflowSourceUrl: source?.url ?? '',
    params: source
      ? state.params
      : { ...state.params, image_guide: undefined },
  })),
  imageWorkflowMaskFile: null,
  imageWorkflowMaskPath: '',
  imageWorkflowMaskUrl: '',
  setImageWorkflowMask: (source) => set(state => ({
    imageWorkflowMaskFile: source?.file ?? null,
    imageWorkflowMaskPath: source?.path ?? '',
    imageWorkflowMaskUrl: source?.url ?? '',
    params: source
      ? state.params
      : { ...state.params, image_mask: undefined },
  })),
  imageOutpaintPadding: { top: 25, bottom: 25, left: 25, right: 25 },
  setImageOutpaintPadding: (side, value) => set(state => ({
    imageOutpaintPadding: {
      ...state.imageOutpaintPadding,
      [side]: Math.max(0, Math.min(100, Math.round(value / 5) * 5)),
    },
  })),
  resetImageOutpaintPadding: () => set({
    imageOutpaintPadding: { top: 25, bottom: 25, left: 25, right: 25 },
  }),

  // Image references
  imageRefs: [],
  imageRefType: '',
  removeBackgroundRefs: false,
  addImageRef: (file) => {
    set(s => ({ imageRefs: [...s.imageRefs, file] }))
    get().reconcileStudioVideoCreateRoute('Frame reference added')
  },
  removeImageRef: (index) => {
    set(s => {
      const updated = s.imageRefs.filter((_, i) => i !== index)
      return {
        imageRefs: updated,
        params: updated.length === 0 ? { ...s.params, image_refs: undefined } : s.params,
      }
    })
    get().reconcileStudioVideoCreateRoute('Frame reference removed')
  },
  reorderImageRefs: (from, to) => set(s => {
    const refs = [...s.imageRefs]
    const [moved] = refs.splice(from, 1)
    refs.splice(to, 0, moved)
    return { imageRefs: refs }
  }),
  setImageRefType: (type) => set({ imageRefType: type }),
  setRemoveBackgroundRefs: (v) => set({ removeBackgroundRefs: v }),

  // Voice clone postprocessing state — defaults are off / empty so
  // existing generations are unaffected.
  voiceCloneEnabled: false,
  setVoiceCloneEnabled: (v) => set({ voiceCloneEnabled: v }),
  voiceCloneMode: 'single',
  setVoiceCloneMode: (v) => set({ voiceCloneMode: v }),
  voiceCloneRefs: [],
  setVoiceCloneRef: (index, ref) => set(s => {
    const next = [...s.voiceCloneRefs]
    if (ref === null) {
      next.splice(index, 1)
    } else {
      while (next.length <= index) next.push({ filename: '', path: '' })
      next[index] = ref
    }
    return { voiceCloneRefs: next }
  }),

  // ── Tools area (standalone post-processing on an existing clip) ──────
  toolsTool: 'upscale',
  toolsUpscaleMedia: 'video',
  setToolsUpscaleMedia: (media) => set(state => ({
    toolsUpscaleMedia: media,
    ...(media === 'image'
      ? { studioImageWorkflow: 'upscale' as StudioImageWorkflow }
      : { studioVideoWorkflow: 'upscale' as StudioVideoWorkflow }),
    ...(state.toolsUpscaleMedia !== media ? {
      toolsSourcePath: null, toolsSourceName: null, toolsSourceUrl: null,
    } : {}),
  })),
  setToolsTool: (t) => set(state => t === 'upscale'
    ? state.toolsUpscaleMedia === 'image'
      ? { toolsTool: t, studioImageWorkflow: 'upscale' }
      : { toolsTool: t, studioVideoWorkflow: 'upscale' }
    : t === 'film_grain'
      ? {
          toolsTool: t,
          toolsUpscaleMedia: 'video',
          studioVideoWorkflow: 'film_grain',
          filmGrainIntensity: state.filmGrainIntensity > 0
            ? state.filmGrainIntensity
            : 0.15,
          ...(state.toolsUpscaleMedia === 'image' ? {
            toolsSourcePath: null, toolsSourceName: null, toolsSourceUrl: null,
          } : {}),
        }
      : { toolsTool: t, audioSubMode: 'revoice' }),
  toolsSourcePath: null,
  toolsSourceName: null,
  toolsSourceUrl: null,
  setToolsSource: (src) => set(src
    ? { toolsSourcePath: src.path, toolsSourceName: src.name, toolsSourceUrl: src.url }
    : { toolsSourcePath: null, toolsSourceName: null, toolsSourceUrl: null }),
  toolsUpscaleMethod: 'flashvsr2',
  setToolsUpscaleMethod: (m) => set({ toolsUpscaleMethod: m }),
  toolsRevoiceMode: 'single',
  setToolsRevoiceMode: (m) => set({ toolsRevoiceMode: m }),
  toolsRevoiceRefs: [null, null],
  setToolsRevoiceRef: (index, ref) => set(s => {
    const next = [...s.toolsRevoiceRefs]
    while (next.length <= index) next.push(null)
    next[index] = ref
    return { toolsRevoiceRefs: next }
  }),
  runTool: async () => {
    const s = get()
    const source = s.toolsSourcePath
    if (!source) return
    const tool = s.toolsTool

    // Revoice needs at least one resolved voice reference.
    const refPaths = s.toolsRevoiceRefs
      .filter((r): r is { filename: string; path: string } => !!r && !!r.path)
      .map(r => r.path)
    if (tool === 'revoice' && refPaths.length === 0) return
    if (tool === 'film_grain' && s.filmGrainIntensity <= 0) return

    const submittingMessage = tool === 'upscale'
      ? 'Submitting upscale...'
      : tool === 'film_grain'
        ? 'Submitting film grain...'
        : 'Submitting revoice...'
    const runningMessage = tool === 'upscale'
      ? 'Upscaling...'
      : tool === 'film_grain'
        ? 'Applying film grain...'
        : 'Replacing voice...'

    // Placeholder job tile — mirrors the blend/edit submit pattern so the
    // progress shows in the main feed and the gallery refreshes on completion.
    const newJob: GenerationJob = {
      id: '', status: 'queued', progress: 0, step: 0, totalSteps: 0,
      phase: '', message: submittingMessage,
      outputFiles: [], error: null, oomInfo: null,
    }
    set(st => ({ isGenerating: true, jobs: [newJob, ...st.jobs] }))

    try {
      const result = tool === 'upscale'
        ? await api.submitToolUpscale({
            media_path: source,
            media_type: s.toolsUpscaleMedia,
            method: s.toolsUpscaleMethod,
            workspace: s.activeWorkspace,
          })
        : tool === 'film_grain'
          ? await api.submitToolFilmGrain({
              video_path: source,
              intensity: s.filmGrainIntensity,
              saturation: s.filmGrainSaturation,
              workspace: s.activeWorkspace,
            })
          : await api.submitToolRevoice({ video_path: source, voice_ref_paths: refPaths, mode: s.toolsRevoiceMode, workspace: s.activeWorkspace })

      set(st => ({
        jobs: st.jobs.map(j => j === newJob ? { ...j, id: result.job_id, status: 'running', message: runningMessage } : j),
      }))

      const pollInterval = setInterval(async () => {
        if (!get().jobs.find(j => j.id === result.job_id)) { clearInterval(pollInterval); return }
        try {
          const status = await api.fetchJobStatus(result.job_id)
          set(st => ({
            jobs: st.jobs.map(j => j.id !== result.job_id ? j : {
              ...j, status: status.status, progress: status.progress / 100,
              step: status.step, totalSteps: status.total_steps,
              phase: status.phase, message: status.message,
              outputFiles: status.output_files, error: status.error, oomInfo: status.oom_info ?? null,
            }),
          }))
          if (status.status === 'running') get().refreshOutputs()
          if (status.status === 'completed') {
            clearInterval(pollInterval)
            set(st => {
              const remaining = st.jobs.filter(j => j.id !== result.job_id)
              return { jobs: remaining, isGenerating: remaining.some(j => j.status === 'running' || j.status === 'queued') }
            })
            get().loadOutputs()
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            clearInterval(pollInterval)
            set(st => ({ isGenerating: st.jobs.some(j => j.id !== result.job_id && (j.status === 'running' || j.status === 'queued')) }))
          }
        } catch { /* ignore poll errors */ }
      }, 2000)
    } catch (e) {
      const msg = e instanceof Error
        ? e.message
        : tool === 'upscale'
          ? 'Upscale failed'
          : tool === 'film_grain'
            ? 'Film grain failed'
            : 'Revoice failed'
      set(st => ({
        jobs: st.jobs.map(j => j === newJob ? { ...j, id: j.id || `tool-fail-${Date.now()}`, status: 'failed', message: msg, error: msg } : j),
        isGenerating: st.jobs.some(j => j !== newJob && (j.status === 'running' || j.status === 'queued')),
      }))
      console.error(`Tool ${tool} failed:`, msg)
    }
  },
  quickUpscaleClip: async (name, url) => {
    // Point the Tools state at this clip and run an upscale immediately,
    // reusing runTool()'s submit+poll. The Tools panel reflects this clip
    // afterward (harmless — and convenient if the user opens it).
    set({ toolsTool: 'upscale', toolsUpscaleMedia: 'video', toolsSourcePath: name, toolsSourceName: name, toolsSourceUrl: url })
    await get().runTool()
  },
  sendClipToTools: (name, url, tool) => {
    set(tool === 'upscale'
      ? {
          toolsTool: tool,
          toolsUpscaleMedia: 'video',
          studioVideoWorkflow: 'upscale',
          toolsSourcePath: name,
          toolsSourceName: name,
          toolsSourceUrl: url,
        }
      : tool === 'film_grain'
        ? state => ({
            toolsTool: tool,
            toolsUpscaleMedia: 'video',
            studioVideoWorkflow: 'film_grain',
            toolsSourcePath: name,
            toolsSourceName: name,
            toolsSourceUrl: url,
            filmGrainIntensity: state.filmGrainIntensity > 0
              ? state.filmGrainIntensity
              : 0.15,
          })
        : {
            toolsTool: tool,
            audioSubMode: 'revoice',
            toolsSourcePath: name,
            toolsSourceName: name,
            toolsSourceUrl: url,
          })
    get().setGenerationMode('tools')
  },

  // Post-processing defaults (shared for Studio)
  spatialUpsampling: '',
  setSpatialUpsampling: (v) => set({ spatialUpsampling: v }),
  sharpenAmount: 0,
  setSharpenAmount: (v) => set({ sharpenAmount: v }),
  filmGrainIntensity: 0,
  setFilmGrainIntensity: (v) => {
    set({ filmGrainIntensity: v })
    // Persist per mode
    const s = get()
    const mode = s.generationMode
    const updatedSavedParams = {
      ...s.savedParamsPerMode,
      [mode]: {
        num_inference_steps: s.params.num_inference_steps,
        guidance_scale: s.params.guidance_scale,
        resolution: s.params.resolution,
        seed: s.params.seed,
        filmGrainIntensity: v,
        filmGrainSaturation: s.filmGrainSaturation,
      },
    }
    set({ savedParamsPerMode: updatedSavedParams })
  },
  filmGrainSaturation: 0.5,
  setFilmGrainSaturation: (v) => {
    set({ filmGrainSaturation: v })
    const s = get()
    const mode = s.generationMode
    const updatedSavedParams = {
      ...s.savedParamsPerMode,
      [mode]: {
        num_inference_steps: s.params.num_inference_steps,
        guidance_scale: s.params.guidance_scale,
        resolution: s.params.resolution,
        seed: s.params.seed,
        filmGrainIntensity: s.filmGrainIntensity,
        filmGrainSaturation: v,
      },
    }
    set({ savedParamsPerMode: updatedSavedParams })
  },

  // Director-mode post-processing (separate image/video)
  // State and setters moved to directorFinishingSlice and composed via
  // createDirectorFinishingSlice below. The names on AppState remain the
  // same so callers don't migrate.
  ...createDirectorFinishingSlice(set),

  audioGuideFilename: null,
  setAudioGuideFilename: (name) => set({ audioGuideFilename: name }),
  audioGuide2Filename: null,
  setAudioGuide2Filename: (name) => set({ audioGuide2Filename: name }),
  ttsSpeakerName1: '',
  ttsSpeakerName2: '',
  ttsSpeakerNamesManual: false,
  setTtsSpeakerName1: (name) => {
    set(s => {
      const voices = [...s.ttsVoices]
      if (voices.length > 0) voices[0] = { ...voices[0], name }
      return { ttsSpeakerName1: name, ttsSpeakerNamesManual: true, ttsVoices: voices }
    })
  },
  setTtsSpeakerName2: (name) => {
    set(s => {
      const voices = [...s.ttsVoices]
      if (voices.length > 1) voices[1] = { ...voices[1], name }
      return { ttsSpeakerName2: name, ttsSpeakerNamesManual: true, ttsVoices: voices }
    })
  },
  _autoParseSpkeakerNames: (text: string, force?: boolean) => {
    // The manual flag prevents auto-parse from clobbering names the user
    // explicitly typed. `force=true` overrides it — used by the enhance
    // button since enhance generates a fresh script whose new names should
    // replace whatever the user had previously set.
    if (!force && get().ttsSpeakerNamesManual) return
    // Match anything before ":" at the start of a line (e.g. "Dr. Mary Jane O'Brien:")
    const matches = text.match(/^(.+?)\s*:/gm)
    if (!matches) return
    const names = [...new Set(matches.map(m => m.replace(/\s*:$/, '').trim()))]
    const voiceCount = get().ttsVoiceCount
    const voices = [...get().ttsVoices]
    // Ensure voices array is big enough
    while (voices.length < voiceCount) {
      voices.push({ name: '', filename: null, path: null })
    }
    for (let i = 0; i < Math.min(names.length, voiceCount); i++) {
      voices[i] = { ...voices[i], name: names[i] }
    }
    set({
      ttsVoices: voices,
      ttsSpeakerName1: names[0] || '',
      ttsSpeakerName2: names[1] || '',
      // Force-call (from enhance) resets the manual flag so subsequent
      // prompt edits can also auto-parse again. Non-force calls preserve
      // the flag (user manually edited a name; keep their state).
      ...(force ? { ttsSpeakerNamesManual: false } : {}),
    })
  },
  // Dynamic multi-speaker (1-6 voices)
  ttsVoiceCount: 0,
  ttsVoices: [],
  setTtsVoiceCount: (count) => {
    const prevCount = get().ttsVoiceCount
    const current = get().ttsVoices
    const voices = [...current]
    while (voices.length < count) {
      voices.push({ name: '', filename: null, path: null })
    }
    // Derive audio_prompt_type from voice count using the model's own selection
    // list. KugelAudio's selection = ["", "A", "AB"] → 0→"", 1→"A", 2+→"AB".
    // Scenema's selection = ["", "A2", "AB2"] → 0→"", 1→"A2", 2+→"AB2".
    // Other (non-Scenema/Kugel) audio-only models keep the legacy ""/A/AB
    // mapping for backward compat.
    const selection = (get().modelOptions?.audio_prompt_type_sources?.selection as string[] | undefined) || ['', 'A', 'AB']
    const audioType = selection[Math.min(count, selection.length - 1)]
    set(s => ({
      ttsVoiceCount: count,
      ttsVoices: voices.slice(0, Math.max(count, voices.length)),
      params: { ...s.params, audio_prompt_type: audioType + ((s.params.audio_prompt_type as string || '').replace(/[^NV]/g, '')) },
    }))
    // If user added voices to an existing prompt (e.g. typed/pasted a
    // dialogue script first, THEN added voice slots), parse the names
    // from the prompt and populate the voice fields. setParam's auto-parse
    // only fires when the prompt CHANGES — without this, growing the slot
    // count after the prompt is set leaves names un-populated. Use
    // force=true so the manual flag (which may have been set by an earlier
    // name edit or by settings restore) doesn't suppress the parse —
    // adding voices is an explicit mode-change action that should re-derive
    // names from the current prompt.
    if (count > prevCount) {
      const prompt = get().params.prompt
      if (typeof prompt === 'string' && prompt.trim()) {
        get()._autoParseSpkeakerNames(prompt, true)
      }
    }
  },
  setTtsVoiceName: (index, name) => {
    set(s => {
      const voices = [...s.ttsVoices]
      if (index < voices.length) voices[index] = { ...voices[index], name }
      return {
        ttsVoices: voices,
        ttsSpeakerNamesManual: true,
        // Keep legacy fields in sync
        ...(index === 0 ? { ttsSpeakerName1: name } : {}),
        ...(index === 1 ? { ttsSpeakerName2: name } : {}),
      }
    })
  },
  setTtsVoiceFile: (index, filename, path) => {
    set(s => {
      const voices = [...s.ttsVoices]
      if (index < voices.length) voices[index] = { ...voices[index], filename, path }
      return {
        ttsVoices: voices,
        // Keep legacy fields in sync
        ...(index === 0 ? { audioGuideFilename: filename } : {}),
        ...(index === 1 ? { audioGuide2Filename: filename } : {}),
      }
    })
  },
  addTtsVoice: () => {
    const count = get().ttsVoiceCount
    // Respect the model's declared max (e.g. Scenema = 2, Kugel = 6).
    // Defaults to 6 if the model_def doesn't specify max_voice_count.
    const maxVoiceCount = ((get().modelOptions as { max_voice_count?: number } | null)?.max_voice_count) ?? 6
    if (count >= maxVoiceCount) return
    get().setTtsVoiceCount(count + 1)
  },
  removeTtsVoice: (index) => {
    set(s => {
      const voices = s.ttsVoices.filter((_, i) => i !== index)
      const newCount = Math.max(0, s.ttsVoiceCount - 1)
      // Same model-aware mapping as setTtsVoiceCount above.
      const selection = (s.modelOptions?.audio_prompt_type_sources?.selection as string[] | undefined) || ['', 'A', 'AB']
      const audioType = selection[Math.min(newCount, selection.length - 1)]
      return {
        ttsVoices: voices,
        ttsVoiceCount: newCount,
        ttsSpeakerName1: voices[0]?.name || '',
        ttsSpeakerName2: voices[1]?.name || '',
        audioGuideFilename: voices[0]?.filename || null,
        audioGuide2Filename: voices[1]?.filename || null,
        params: { ...s.params, audio_prompt_type: audioType + ((s.params.audio_prompt_type as string || '').replace(/[^NV]/g, '')) },
      }
    })
  },

  // Multi-clip state
  clips: [],
  singlePromptMode: false,
  setClipPrompt: (index, prompt) => {
    const clips = [...get().clips]
    if (clips[index]) {
      clips[index] = { ...clips[index], prompt }
      set({ clips })
    }
  },
  setClipStartImage: (index, file) => {
    const clips = [...get().clips]
    if (clips[index]) {
      clips[index] = { ...clips[index], startImage: file }
      set({ clips })
    }
  },
  setSinglePromptMode: (v) => set({ singlePromptMode: v }),
  syncClipCount: () => {
    const { params, durationSeconds, slidingWindowSeconds, slidingWindowOverlap, modelOptions } = get()
    if (params.image_mode !== 2) return
    const fps = modelOptions?.fps ?? 16
    const overlapSeconds = slidingWindowOverlap / fps
    const effectiveWindow = slidingWindowSeconds - overlapSeconds
    const count = effectiveWindow > 0
      ? Math.max(1, Math.ceil((durationSeconds - overlapSeconds) / effectiveWindow))
      : Math.max(1, Math.ceil(durationSeconds / slidingWindowSeconds))
    const current = get().clips
    if (count === current.length) return
    if (count > current.length) {
      const newClips = [...current]
      for (let i = current.length; i < count; i++) {
        newClips.push({ prompt: '', startImage: null, startImagePath: null, endImage: null, endImagePath: null })
      }
      set({ clips: newClips })
    } else {
      set({ clips: current.slice(0, count) })
    }
  },

  jobs: [],
  isGenerating: false,

  openGenerationReview: async (action) => {
    if (get().reviewBusy) return
    const token = ++_reviewRequestToken
    set({ reviewBusy: true, reviewPlan: null, reviewAction: action, promptEnhanceError: null })
    try {
      await get().startGeneration('queue', undefined, true)
    } catch (error) {
      set({ promptEnhanceError: error instanceof Error ? error.message : 'Unable to prepare review' })
    } finally {
      if (token === _reviewRequestToken) set({ reviewBusy: false })
    }
  },

  restoreGenerationReview: async () => {
    if (get().reviewBusy || get().reviewPlan) return
    const id = localStorage.getItem('cue-studio-pending-generation-review')
    if (!id) return
    const token = ++_reviewRequestToken
    set({ reviewBusy: true })
    try {
      let result = await api.fetchGenerationReview(id)
      while (result.status === 'planning') {
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (token !== _reviewRequestToken) return
        result = await api.fetchGenerationReview(id)
      }
      if (token !== _reviewRequestToken) return
      if (result.status === 'ready' && result.prepared) {
        set({ reviewPlan: resolvedGenerationPlan(get(), { id: result.id, prepared: result.prepared }), reviewAction: 'generate' })
      } else {
        localStorage.removeItem('cue-studio-pending-generation-review')
        if (result.status === 'failed') set({ promptEnhanceError: result.error || 'Planning was interrupted. Prepare a new review.' })
      }
    } catch (error) {
      set({ promptEnhanceError: error instanceof Error ? error.message : 'Unable to restore review' })
    } finally {
      if (token === _reviewRequestToken) set({ reviewBusy: false })
    }
  },

  confirmGenerationReview: async (target) => {
    const plan = get().reviewPlan
    const snapshot = _reviewSnapshot
    if (!plan || (!snapshot && !plan.reviewId) || get().reviewBusy) return
    set({ reviewBusy: true })
    try {
      if (plan.reviewId) {
        await api.submitGenerationReview(plan.reviewId, target === 'queue')
        await get().reconnectJobs()
        localStorage.removeItem('cue-studio-pending-generation-review')
      } else if (snapshot) {
        await get().startGeneration(target === 'queue' ? 'queue' : 'now', snapshot)
      }
      set({ reviewPlan: null, reviewAction: null })
      _reviewSnapshot = null
    } catch (error) {
      set({ promptEnhanceError: error instanceof Error ? error.message : 'Unable to submit approved plan' })
    } finally {
      set({ reviewBusy: false })
    }
  },

  closeGenerationReview: () => {
    if (get().reviewBusy && get().reviewPlan) return
    ++_reviewRequestToken
    _reviewSnapshot = null
    localStorage.removeItem('cue-studio-pending-generation-review')
    set({ reviewBusy: false, reviewPlan: null, reviewAction: null })
  },


  startStudioQueue: async () => {
    if (get().llmStatus?.loaded) {
      try {
        await api.unloadLlm()
        set({ llmStatus: { loaded: false, model_id: null, device: null, provider: '' } })
      } catch { /* best-effort; generation has its own memory safeguards */ }
    }
    const result = await api.startStudioQueue()
    if (result.job_ids.length === 0) return
    const released = new Set(result.job_ids)
    set(s => ({
      jobs: s.jobs.map(job => released.has(job.id)
        ? { ...job, status: 'queued', message: 'Queued' }
        : job),
      isGenerating: true,
    }))
  },

  stopGeneration: (jobId) => {
    if (jobId) {
      // Cancel specific job on backend, then remove from UI
      api.cancelJob(jobId).catch(e => console.error('Cancel failed:', e))
      set(s => {
        const remaining = s.jobs.filter(j => j.id !== jobId)
        return {
          jobs: remaining,
          isGenerating: remaining.some(j => j.status === 'queued' || j.status === 'running'),
        }
      })
    } else {
      // Cancel all jobs
      const jobs = get().jobs
      jobs.forEach(j => {
        if (j.id) api.cancelJob(j.id).catch(() => {})
      })
      set({ jobs: [], isGenerating: false })
    }
  },

  // UI-only removal of a job tile (e.g. dismissing a failed/cancelled
  // placeholder). No backend call — the job is already terminal.
  dismissJob: (jobId) => {
    set(s => {
      const remaining = s.jobs.filter(j => j.id !== jobId)
      return {
        jobs: remaining,
        isGenerating: remaining.some(j => j.status === 'running' || j.status === 'queued'),
      }
    })
  },

  reconnectJobs: async () => {
    // On page load, check backend for any active jobs and restore them
    try {
      const data = await api.fetchActiveJobs()
      if (data.jobs.length > 0) {
        const existingIds = new Set(get().jobs.map(j => j.id))
        const newJobs: GenerationJob[] = data.jobs
          .filter(j => !existingIds.has(j.job_id))
          .map(j => ({
            id: j.job_id,
            showInGallery: j.show_in_gallery === true,
            kind: j.kind || 'generation',
            status: j.status as GenerationJob['status'],
            progress: j.progress / 100,
            step: j.step,
            totalSteps: j.total_steps,
            phase: j.phase,
            message: j.message,
            outputFiles: j.output_files,
            error: j.error,
            oomInfo: (j as { oom_info?: import('../types').OomInfo | null }).oom_info ?? null,
            h3WindowPlan: j.h3_window_plan ?? null,
            ..._adaptiveEtaJobFields(j),
          }))
        if (newJobs.length > 0) {
          set(s => ({
            jobs: [...s.jobs, ...newJobs],
            isGenerating: [...s.jobs, ...newJobs].some(
              j => j.status === 'queued' || j.status === 'running',
            ),
          }))
          // Start polling for each reconnected job
          newJobs.forEach(job => {
            const pollInterval = setInterval(async () => {
              try {
                const status = await api.fetchJobStatus(job.id)
                set(s => ({
                  jobs: s.jobs.map(j => j.id !== job.id ? j : {
                    ...j,
                    showInGallery: status.show_in_gallery ?? j.showInGallery,
                    kind: status.kind || j.kind,
                    status: status.status,
                    progress: status.progress / 100,
                    step: status.step,
                    totalSteps: status.total_steps,
                    phase: status.phase,
                    message: status.message,
                    outputFiles: status.output_files,
                    error: status.error,
                    oomInfo: status.oom_info ?? null,
                    h3WindowPlan: status.h3_window_plan ?? j.h3WindowPlan ?? null,
                    ..._adaptiveEtaJobFields(status),
                  }),
                }))
                if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
                  clearInterval(pollInterval)
                  set(s => {
                    const remaining = s.jobs.filter(j => j.id !== job.id)
                    return {
                      jobs: remaining,
                      isGenerating: remaining.some(
                        j => j.status === 'queued' || j.status === 'running',
                      ),
                    }
                  })
                  get().loadOutputs()
                }
              } catch {
                // Job may have been cleaned up
                clearInterval(pollInterval)
                set(s => {
                  const remaining = s.jobs.filter(j => j.id !== job.id)
                  return {
                    jobs: remaining,
                    isGenerating: remaining.some(
                      j => j.status === 'queued' || j.status === 'running',
                    ),
                  }
                })
              }
            }, 2000)
          })
          console.log(`[Queue] Reconnected to ${newJobs.length} active job(s)`)
        }
      }
    } catch {
      // Backend might not have the endpoint yet, silently ignore
    }
  },

  // Presets
  presets: [],
  presetsLoading: false,

  loadPresets: async () => {
    set({ presetsLoading: true })
    try {
      const { presets } = await api.fetchPresets()
      set({ presets })
    } catch (e) {
      console.error('Failed to load presets:', e)
    } finally {
      set({ presetsLoading: false })
    }
  },

  savePreset: async (name) => {
    const { params, loraWeights, generationMode } = get()
    try {
      const preset = await api.createPreset({
        name,
        mode: generationMode,
        model_type: params.model_type,
        prompt: '',
        activated_loras: params.activated_loras,
        loras_multipliers: params.loras_multipliers,
        lora_weights: loraWeights,
        params: {
          num_inference_steps: params.num_inference_steps,
          guidance_scale: params.guidance_scale,
          resolution: params.resolution,
          seed: params.seed,
          negative_prompt: params.negative_prompt,
          flow_shift: params.flow_shift,
          self_refiner_setting: params.self_refiner_setting,
          stage2_steps: params.stage2_steps,
        },
      })
      set(s => ({ presets: [...s.presets, preset] }))
    } catch (e) {
      console.error('Failed to save preset:', e)
    }
  },

  loadPreset: (preset) => {
    const newParams: Partial<GenerateParams> = {
      activated_loras: preset.activated_loras,
      loras_multipliers: preset.loras_multipliers,
      ...(preset.params as Partial<GenerateParams>),
    }
    set(s => ({
      params: { ...s.params, ...newParams },
      loraWeights: preset.lora_weights || {},
    }))
  },

  deletePreset: async (id) => {
    try {
      await api.deletePreset(id)
      set(s => ({ presets: s.presets.filter(p => p.id !== id) }))
    } catch (e) {
      console.error('Failed to delete preset:', e)
    }
  },

  // System config
  systemConfig: null,
  systemConfigLoading: false,
  loadSystemConfig: async () => {
    set({ systemConfigLoading: true })
    try {
      const config = await api.fetchSystemConfig()
      set({ systemConfig: config, systemConfigLoading: false })
    } catch (e) {
      console.error('Failed to load system config:', e)
      set({ systemConfigLoading: false })
    }
  },
  updateSystemConfig: async (partial) => {
    try {
      await api.updateSystemConfig(partial)
      set(s => ({
        systemConfig: s.systemConfig ? { ...s.systemConfig, ...partial } : null,
      }))
    } catch (e) {
      console.error('Failed to update system config:', e)
      get().loadSystemConfig()
    }
  },

  // Hardware detect — see type definition above. Initial value null;
  // populated when AutoPerformanceCard mounts (Settings → System).
  // Refreshed when the user clicks Re-detect on the auto card.
  systemDetect: null,
  loadSystemDetect: async () => {
    try {
      const detect = await api.fetchSystemDetect()
      set({ systemDetect: detect })
    } catch (e) {
      console.error('Failed to load system detect:', e)
    }
  },

  // Live hardware telemetry (HardwareStatusBar). Polled ~2s from the
  // component while mounted. Swallows a single failed tick (e.g. backend
  // restarting) instead of spamming the console at 2s cadence.
  systemStats: null,
  loadSystemStats: async () => {
    try {
      const stats = await api.fetchSystemStats()
      set({ systemStats: stats })
    } catch {
      /* transient poll failure — ignore this tick */
    }
  },

  // Settings tab
  settingsTab: 'appearance' as SettingsTab,
  setSettingsTab: (tab) => set({ settingsTab: tab }),

  // Model visibility focus — opens Settings on the Performance tab and
  // remembers which mode the ModelSelector "+N more" hint came from.
  // Implementation lives next to other settings actions above.
  modelVisibilityFocus: null,
  openModelVisibility: (mode) => set({ settingsOpen: true, settingsTab: 'performance', modelVisibilityFocus: mode }),
  clearModelVisibilityFocus: () => set({ modelVisibilityFocus: null }),

  // Services config
  servicesConfig: null,
  servicesConfigLoading: false,
  loadServicesConfig: async () => {
    set({ servicesConfigLoading: true })
    try {
      const config = await api.fetchServicesConfig()
      set({ servicesConfig: config, servicesConfigLoading: false })
      if (
        config.nsfw_mode
        && studioModelRuntime.visibilityHydrated
        && get().models.length > 0
      ) {
        set(s => {
          const next = _enableUninitializedMatureModels(
            s.models,
            s.enabledModels,
          )
          if (!next) return s
          _saveEnabledModels(next)
          return { enabledModels: next }
        })
      }
    } catch (e) {
      console.error('Failed to load services config:', e)
      set({ servicesConfigLoading: false })
    }
  },
  updateServicesConfig: async (partial) => {
    try {
      await api.updateServicesConfig(partial)
      get().loadServicesConfig()
      // Newly-discovered Mature models appear once when Mature Mode is
      // enabled. Previously initialized models retain the user's whitelist.
      if (partial.nsfw_mode === true && studioModelRuntime.visibilityHydrated) {
        set(s => {
          const next = _enableUninitializedMatureModels(
            s.models,
            s.enabledModels,
          )
          if (!next) return s
          _saveEnabledModels(next)
          return { enabledModels: next }
        })
      }
    } catch (e) {
      console.error('Failed to update services config:', e)
      get().loadServicesConfig()
    }
  },

  // LLM state and lifecycle operations
  ...createLlmSlice(set, get, store),

  // Prompt enhancement
  isEnhancing: false,
  promptEnhanceError: null,
  h3WindowPlan: null,

  // Review-before-generate gate (P0)
  reviewPlan: null,
  reviewAction: null,
  reviewBusy: false,
  reviewBeforeGenerate: (() => {
    try { return localStorage.getItem('cue-studio-review-before-generate') !== '0' } catch { return false }
  })(),
  setReviewBeforeGenerate: (enabled) => {
    try { localStorage.setItem('cue-studio-review-before-generate', enabled ? '1' : '0') } catch { /* private mode */ }
    set({ reviewBeforeGenerate: enabled })
  },
  updateH3WindowPrompt: (index, prompt) => set(s => {
    if (!s.h3WindowPlan || index < 0 || index >= s.h3WindowPlan.windows.length) return {}
    const windows = s.h3WindowPlan.windows.map((window, windowIndex) => (
      windowIndex === index ? { ...window, prompt } : window
    ))
    return {
      h3WindowPlan: {
        ...s.h3WindowPlan,
        windows,
        window_prompts: windows.map(window => window.prompt),
      },
    }
  }),

  moveH3Window: (fromIndex, toIndex) => set(s => {
    if (!s.h3WindowPlan) return {}
    return { h3WindowPlan: reorderWindowPrompts(s.h3WindowPlan, fromIndex, toIndex) }
  }),
  clearH3WindowPlan: () => set({ h3WindowPlan: null }),
  enhancePrompt: async (ttsMode?: string) => {
    let state = get()
    const primaryStudioCreate = (
      state.generationMode === 'video'
      && (state.studioVideoWorkflow === 'frames' || state.studioVideoWorkflow === 'references')
      && Number(state.params.image_mode) === 0
    )
    if (primaryStudioCreate) {
      state.reconcileStudioVideoCreateRoute('Inputs changed')
      state = get()
    }
    const selectedModelType = String(state.params.model_type || '')
    if (
      selectedModelType
      && state.modelOptions?.model_type !== selectedModelType
      && !sfxModelTypes.has(selectedModelType)
    ) {
      await state.loadModelOptions(selectedModelType)
      state = get()
      if (state.modelOptions?.model_type !== selectedModelType) {
        set({ promptEnhanceError: 'The selected video model is still loading. Try Prompt Enhance again in a moment.' })
        return
      }
    }
    const selectedModelDefinition = state.models.find(
      model => model.model_type === state.params.model_type,
    )
    const activeCreateInput = primaryStudioCreate
      ? _studioCreateInputState(state)
      : null
    const activeCreateRoute = primaryStudioCreate
      ? state.studioVideoEffectiveCreateRoute
      : null
    if (
      activeCreateInput
      && !modelSupportsStudioVideoMediaIntent(selectedModelDefinition, activeCreateInput)
    ) {
      set({
        promptEnhanceError: activeCreateInput.conflict
          ? 'Fixed start/end/keyframes cannot be combined with Omni references. Remove one of those input roles to continue.'
          : `No enabled model can use the current ${activeCreateRoute === 'omni' ? 'reference' : activeCreateRoute === 'guided' ? 'frame-guided' : activeCreateRoute === 'audio' ? 'audio-driven' : 'text'} inputs.`,
      })
      return
    }
    const { params, generationMode, startImage, endImage, imageRefs } = state
    if (!params.prompt.trim()) return
    let generationWorkInFlight = (
      state.isGenerating
      || state.jobs.some(job => job.status === 'running' || job.status === 'queued')
    )
    if (!generationWorkInFlight) {
      try {
        const active = await api.fetchActiveJobs()
        generationWorkInFlight = active.jobs.some(job => (
          job.status === 'running' || job.status === 'queued'
        ))
      } catch { /* backend guard remains authoritative */ }
    }
    if (generationWorkInFlight) {
      set({
        isEnhancing: false,
        promptEnhanceError: 'A generation is already using or waiting for the GPU. Prompt Enhance was not started. Add this setup to the queue and Maestro will run AI planning safely when its turn begins.',
      })
      return
    }
    if (
      state.modelOptions?.omni_reference === true
      && params.minimax_h3_reference_sequence === true
      && params.minimax_h3_sequence_prompt_mode === 'manual'
    ) {
      set({
        promptEnhanceError: 'Manual Omni sequence mode uses each prompt line exactly as written. Switch Window prompts to AI - Faithful or AI - Creative to use the LLM planner.',
      })
      return
    }
    if (
      String(state.modelOptions?.architecture || '').startsWith('minimax_h3')
      && state.modelOptions?.omni_reference !== true
      && params.minimax_h3_multi_window === true
      && params.minimax_h3_window_storyboard === false
    ) {
      set({
        promptEnhanceError: 'Manual H3 multi-window mode uses each prompt line as written. Switch Window prompts to Auto plan to use the LLM planner.',
      })
      return
    }
    if (
      state.modelOptions?.multi_window_sequence_controls === true
      && params.ltx_multi_window === true
      && params.ltx_window_prompt_mode === 'manual'
    ) {
      set({
        promptEnhanceError: 'Manual LTX multi-window mode uses each prompt line exactly as written. Switch Window prompts to AI - Faithful or AI - Creative to use the LLM planner.',
      })
      return
    }
    set({ isEnhancing: true, promptEnhanceError: null })
    try {
      // Collect images relevant to the CURRENT mode only
      const imagePaths: string[] = []
      let referenceContext: string | undefined
      const isOmniReference = primaryStudioCreate
        ? activeCreateRoute === 'omni'
        : Boolean(
            state.modelOptions?.omni_reference === true
            || _isOmniVideoModel(selectedModelDefinition)
          )
      const useStudioFrameInputs = !primaryStudioCreate || activeCreateRoute === 'guided'
      const isH3FirstLast = (
        String(
          state.modelOptions?.architecture
          || selectedModelDefinition?.architecture
          || '',
        ).startsWith('minimax_h3')
        && !isOmniReference
      )
      const isLtxSequence = state.modelOptions?.multi_window_sequence_controls === true
      const injectedPositions = String(params.frames_positions || '').split(/[\s,]+/).filter(Boolean)
      const injectedKeyframes = (
        useStudioFrameInputs
        &&
        isH3FirstLast
        && String(params.video_prompt_type || '').includes('KFI')
        && Array.isArray(params.image_refs)
      ) ? params.image_refs
          .map((path, index) => ({ path, position: injectedPositions[index] || '' }))
          .filter(item => !!item.path && !!item.position)
        : []

      if (isOmniReference) {
        let pictureIndex = 0
        let videoIndex = 0
        let audioIndex = 0
        const labelLines: string[] = []
        const savedCharacterMedia = new Map<string, { name: string; labels: string[] }>()
        const bindSavedCharacter = (reference: MiniMaxH3Reference, label: string) => {
          if (!reference.library_character_id) return
          const name = (reference.character_name || reference.role || 'Saved character').trim()
          const binding = savedCharacterMedia.get(reference.library_character_id) ?? { name, labels: [] }
          binding.labels.push(label)
          savedCharacterMedia.set(reference.library_character_id, binding)
        }
        for (const reference of params.minimax_h3_references ?? []) {
          const note = (reference.role || reference.filename || 'reference').trim()
          if (reference.type === 'audio') {
            const intent = reference.audio_intent ?? 'voice'
            if (intent === 'drive') {
              labelLines.push(`Exact target soundtrack: ${note}; intent=AUDIO REUSE / PERFORMANCE DRIVER; retention=fully_preserved; preserve its waveform and audible timeline exactly and synchronize visible action and lip movement to it; this is target conditioning rather than a numbered Omni audio reference`)
            } else if (intent === 'style') {
              const label = `<Audio ${++audioIndex}>`
              labelLines.push(`${label}: ${note}; intent=AUDIO REFERENCE; retention=weak_reference; borrow only rhythm/style/texture and do not copy the source signal or words`)
            } else {
              const label = `<Audio ${++audioIndex}>`
              labelLines.push(`${label}: ${note}; intent=VOICE REFERENCE; retention=reference; use vocal identity/timbre/emotion/delivery for new scripted dialogue without copying source words, timing, waveform, room tone, reverberation, echo, background noise, microphone coloration, or source spatial acoustics; render the voice acoustically inside the target environment`)
              bindSavedCharacter(reference, label)
            }
          } else if (reference.type === 'image') {
            const label = `<Picture ${++pictureIndex}>`
            labelLines.push(`${label}: visual identity/appearance reference for ${note}; retention=reference for identity only; do not reproduce its background, framing, composition, or pose`)
            bindSavedCharacter(reference, label)
            if (reference.path) imagePaths.push(reference.path)
          } else {
            const nextVideoIndex = videoIndex + 1
            if ((reference.has_audio || reference.audio_path) && reference.include_audio !== false) {
              labelLines.push(`<Audio ${++audioIndex}>: soundtrack paired with <Video ${nextVideoIndex}>; intent=AUDIO REUSE / PERFORMANCE DRIVER; retention=partially_copy; preserve its audible timeline and synchronize action to it`)
            }
            videoIndex = nextVideoIndex
            const label = `<Video ${videoIndex}>`
            if (reference.video_intent === 'character') {
              labelLines.push(`${label}: identity, appearance, and characteristic-motion evidence for ${note}; compile it into that character's Subject; reject its source background, framing, camera, edit rhythm, opening frame, and action`)
              bindSavedCharacter(reference, label)
            } else if (reference.video_intent === 'scene') {
              labelLines.push(`${label}: environment, lighting, and scene-continuity reference for ${note}; do not copy incidental people as target identities`)
            } else {
              labelLines.push(`${label}: motion/camera/scene/timing reference for ${note}`)
            }
          }
        }
        const savedCharacterLines = Array.from(savedCharacterMedia.values()).map((binding, index) => {
          const subjectNumber = index + 1
          const subjectLabel = `<Subject ${subjectNumber}>`
          return (
            `Saved character "${binding.name}" is exactly ${subjectLabel}: `
            + `${binding.labels.join(' + ')} all define this one stable character. `
            + `Whenever the user names ${binding.name}, use ${subjectLabel}. Subject numbering follows `
            + `this reference inventory, while speaker IDs are assigned independently in first-vocal-event order. `
            + `Bind every listed voice Audio to this Subject and its event-ordered speaker ID. Do not create another Subject for `
            + 'a repeated media label, do not renumber this mapping, and do not emit an @ token.'
          )
        })
        referenceContext = [...savedCharacterLines, ...labelLines].join('\n')
      } else if (generationMode === 'image') {
        if (
          (state.studioImageWorkflow === 'inpaint' || state.studioImageWorkflow === 'outpaint')
          && state.imageWorkflowSourcePath
        ) {
          imagePaths.push(state.imageWorkflowSourcePath)
          referenceContext = state.studioImageWorkflow === 'inpaint'
            ? 'Picture 1 is the source image. Preserve everything outside the supplied edit mask; describe the finished image, not mask instructions.'
            : 'Picture 1 is the protected source image. Extend its scene naturally beyond the existing canvas; describe the complete finished image.'
        } else if (state.studioImageWorkflow === 'generate') {
          for (const ref of imageRefs) {
            try {
              const uploaded = await api.uploadImage(ref)
              imagePaths.push(uploaded.path)
            } catch { /* best effort */ }
          }
        }
      } else {
        // Video/Avatar mode normally sends the start image. H3 First / Last
        // additionally presents its end and injected frames in the same order
        // the runtime's Qwen conditioner will number them.
        let h3HasStartAttachment = false
        let h3HasEndAttachment = false
        if (useStudioFrameInputs && startImage) {
          try {
            const uploaded = await api.uploadImage(startImage)
            imagePaths.push(uploaded.path)
            h3HasStartAttachment = true
          } catch { /* best effort */ }
        } else if (useStudioFrameInputs && params.image_start && typeof params.image_start === 'string') {
          imagePaths.push(params.image_start as string)
          h3HasStartAttachment = true
        }
        if (isH3FirstLast) {
          if (useStudioFrameInputs && endImage) {
            try {
              const uploaded = await api.uploadImage(endImage)
              imagePaths.push(uploaded.path)
              h3HasEndAttachment = true
            } catch { /* best effort */ }
          } else if (useStudioFrameInputs && params.image_end && typeof params.image_end === 'string') {
            imagePaths.push(params.image_end)
            h3HasEndAttachment = true
          }
          for (const keyframe of useStudioFrameInputs ? injectedKeyframes : []) {
            // Reusing the same file at two positions still creates two Qwen
            // picture slots, so preserve duplicates and their ordering.
            imagePaths.push(keyframe.path)
          }

          let pictureIndex = 0
          const alignmentLines: string[] = []
          const h3Fps = state.modelOptions?.fps ?? 24
          const h3Duration = Number(params.video_length || 0) / h3Fps
          if (h3HasStartAttachment) {
            alignmentLines.push(`For the target video, at 0.00 seconds into the target video, <Picture ${++pictureIndex}> (from [Shot 1]) is fully referenced.`)
          }
          if (h3HasEndAttachment) {
            alignmentLines.push(`At ${h3Duration.toFixed(2)} seconds, <Picture ${++pictureIndex}> is the required final-frame destination.`)
          }
          for (const keyframe of injectedKeyframes) {
            const match = /^W1:(\d{1,3})$/i.exec(keyframe.position)
            let localSeconds: number | null = null
            if (match) localSeconds = h3Duration * Math.min(100, Number(match[1])) / 100
            else if (/^\d+$/.test(keyframe.position)) localSeconds = Math.max(0, Number(keyframe.position) - 1) / h3Fps
            else if (/^l$/i.test(keyframe.position)) localSeconds = h3Duration
            const timing = localSeconds == null
              ? `at timeline position ${keyframe.position}`
              : `at ${localSeconds.toFixed(2)} seconds into the target video`
            alignmentLines.push(`${timing}, <Picture ${++pictureIndex}> is fully referenced as an exact injected frame; reach it naturally and continue from it.`)
          }
          referenceContext = alignmentLines.join('\n') || undefined
        }
      }
      // Include duration/window info for video models
      const fps = state.modelOptions?.fps ?? 16
      const swDefaults = (state.modelOptions as Record<string, unknown> | null)?.sliding_window_defaults as Record<string, number> | undefined
      const discardFrames = swDefaults?.discard_last_frames ?? 0
      const overlapSec = state.slidingWindowOverlap / fps
      const discardSec = discardFrames / fps
      const supportsSlidingWindows = state.modelOptions?.sliding_window === true
      const firstWindowSeconds = (
        state.studioVideoWorkflow === 'extend'
        && supportsSlidingWindows
      )
        ? continuationFirstWindowFrames(
            Math.round(state.slidingWindowSeconds * fps),
            state.slidingWindowOverlap,
          ) / fps
        : state.slidingWindowSeconds
      const plannedDuration = durationWindowPlan(
        state.durationSeconds,
        state.slidingWindowSeconds,
        overlapSec,
        discardSec,
        firstWindowSeconds,
      )
      const windowCount = supportsSlidingWindows
        && (!isH3FirstLast || params.minimax_h3_multi_window === true)
        && (!isLtxSequence || params.ltx_multi_window === true)
        ? plannedDuration.windowCount
        : 1
      const totalFrames = Math.max(1, Math.round(state.durationSeconds * fps))
      const h3NativeMaximumFrames = state.modelOptions?.frames_maximum ?? null
      const h3SequenceBudget = (
        isOmniReference
        && params.minimax_h3_reference_sequence === true
        && h3NativeMaximumFrames != null
      ) ? effectiveH3OmniSequenceFrames({
          policy: state.modelOptions?.omni_sequence_memory_policy,
          resolution: String(params.resolution || ''),
          totalVramGb: state.systemStats?.gpu.vram_total_gb ?? 0,
          minimumFrames: state.modelOptions?.frames_minimum ?? 124,
          maximumFrames: h3NativeMaximumFrames,
          frameStep: state.modelOptions?.frames_steps ?? 17,
          selectedFrames: Math.round(state.slidingWindowSeconds * fps),
          manualOverride: state.slidingWindowLocked,
        }) : null
      const h3SequenceClipFrames = h3SequenceBudget?.frames
        ?? h3NativeMaximumFrames
      const shouldPlanH3Sequence = (
        generationMode === 'video'
        && isOmniReference
        && params.minimax_h3_reference_sequence === true
        && params.minimax_h3_sequence_prompt_mode !== 'manual'
        && h3SequenceClipFrames != null
        && totalFrames > h3SequenceClipFrames
      )
      const h3PlanningSource = (
        typeof params._h3_original_prompt === 'string'
        && params._h3_original_prompt.trim()
      ) || params.prompt

      if (shouldPlanH3Sequence) {
        const planningStyle = params.minimax_h3_sequence_prompt_mode === 'creative'
          ? 'creative'
          : 'faithful'
        const plan = await api.planH3Sequence({
          prompt: h3PlanningSource,
          model_type: params.model_type,
          resolution: params.resolution,
          total_frames: totalFrames,
          references: params.minimax_h3_references ?? [],
          sequence_clip_frames: h3SequenceClipFrames,
          sequence_memory_override: state.slidingWindowLocked,
          overlap_frames: state.slidingWindowOverlap,
          sequence_continuity: params.minimax_h3_sequence_continuity !== false,
          camera_coverage: params.minimax_h3_camera_coverage || 'auto',
          planning_style: planningStyle,
        })
        const effectiveClipFrames = plan.effective_window_frames
          || plan.window_frames
        set(s => ({
          h3WindowPlan: plan,
          slidingWindowSeconds: effectiveClipFrames / fps,
          params: {
            ...s.params,
            prompt: plan.source_prompt || h3PlanningSource,
            _h3_original_prompt: undefined,
            minimax_h3_sequence_clip_frames: effectiveClipFrames,
            minimax_h3_sequence_memory_override: state.slidingWindowLocked,
          },
          isEnhancing: false,
        }))
        return
      }

      const shouldPlanH3Windows = (
        generationMode === 'video'
        && state.modelOptions?.sliding_window_auto_prompt_pacing === true
        && params.minimax_h3_multi_window === true
        && params.minimax_h3_window_storyboard !== false
        && params.image_mode !== 2
        && windowCount > 1
      )
      if (shouldPlanH3Windows) {
        // The ordinary H3 enhancer writes one complete Context-IR timeline.
        // Multi-window H3 instead needs a structured storyboard whose prompts
        // contain only their own local actions. Endpoint and injected images
        // were collected above in the runtime's stable presentation order.
        const planningStyle = params.minimax_h3_sequence_prompt_mode === 'creative'
          ? 'creative'
          : 'faithful'
        const plan = await api.planH3Windows({
          prompt: h3PlanningSource,
          model_type: params.model_type,
          resolution: params.resolution,
          total_frames: totalFrames,
          window_frames: Math.max(1, Math.round(state.slidingWindowSeconds * fps)),
          overlap_frames: state.slidingWindowOverlap,
          discard_frames: discardFrames,
          sliding_window_memory_override: state.slidingWindowLocked,
          has_start_image: !!(startImage || params.image_start),
          has_end_image: !!(endImage || params.image_end),
          image_paths: imagePaths.length > 0 ? imagePaths : undefined,
          injected_keyframes: injectedKeyframes.length > 0 ? injectedKeyframes : undefined,
          camera_coverage: params.minimax_h3_camera_coverage || 'auto',
          planning_style: planningStyle,
        })
        const effectiveWindowFrames = plan.effective_window_frames || plan.window_frames
        set(s => ({
          h3WindowPlan: plan,
          slidingWindowSeconds: effectiveWindowFrames / fps,
          // Clicking Enhance on a multi-window H3 First/Last job is an
          // explicit request to plan the idea across those windows. Turn the
          // planner back on even when an old saved setting left legacy mode
          // disabled; otherwise the ordinary H3 enhancer flattens every
          // window into one globally timed screenplay.
          params: {
            ...s.params,
            prompt: plan.source_prompt || h3PlanningSource,
            _h3_original_prompt: undefined,
            sliding_window_size: effectiveWindowFrames,
            minimax_h3_multi_window: true,
            minimax_h3_window_storyboard: true,
          },
          isEnhancing: false,
        }))
        return
      }

      // TTS dialogue needs more tokens for longer conversations
      const maxTokens = (generationMode === 'audio' && ttsMode) ? 2048 : undefined
      const ltxEnhanceSource = (
        generationMode === 'video'
        && isLtxSequence
        && params.ltx_multi_window === true
        && params.ltx_window_prompt_mode !== 'manual'
        && typeof params._ltx_original_prompt === 'string'
        && params._ltx_original_prompt.trim()
      ) ? params._ltx_original_prompt : params.prompt

      const result = await api.llmEnhancePrompt({
        prompt: ltxEnhanceSource,
        mode: generationMode,
        model_type: params.model_type,
        max_new_tokens: maxTokens,
        image_paths: imagePaths.length > 0 ? imagePaths : undefined,
        duration_seconds: (generationMode === 'video' || generationMode === 'avatar') ? state.durationSeconds : undefined,
        window_count: (generationMode === 'video' || generationMode === 'avatar') ? windowCount : undefined,
        window_size_seconds: (generationMode === 'video' || generationMode === 'avatar') ? state.slidingWindowSeconds : undefined,
        activated_loras: params.activated_loras.length > 0 ? params.activated_loras : undefined,
        tts_enhance_mode: ttsMode || undefined,
        tts_voice_count: state.ttsVoiceCount || undefined,
        reference_context: referenceContext,
        planning_style: (
          generationMode === 'video'
          && (
            isLtxSequence
              ? params.ltx_window_prompt_mode === 'creative'
              : params.minimax_h3_sequence_prompt_mode === 'creative'
          )
        ) ? 'creative' : 'faithful',
      })
      const preserveH3Source = (
        generationMode === 'video'
        && state.modelOptions?.architecture?.startsWith('minimax_h3') === true
      )
        ? ((typeof params._h3_original_prompt === 'string'
            && params._h3_original_prompt.trim()) || params.prompt)
        : undefined
      const enhancedLtxLines = result.enhanced
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
      const preserveLtxPlan = (
        generationMode === 'video'
        && isLtxSequence
        && params.ltx_multi_window === true
        && params.ltx_window_prompt_mode !== 'manual'
        && windowCount > 1
        && enhancedLtxLines.length === windowCount
      )
      const ltxSourcePrompt = ltxEnhanceSource
      const preserveLtxSource = generationMode === 'video' && isLtxSequence
      set(s => ({
        params: {
          ...s.params,
          prompt: preserveLtxPlan ? enhancedLtxLines.join('\n') : result.enhanced,
          ...(preserveH3Source ? { _h3_original_prompt: preserveH3Source } : {}),
          ...(preserveLtxSource ? { _ltx_original_prompt: ltxSourcePrompt } : {}),
          ...(preserveLtxPlan ? {
            ltx_window_prompts: enhancedLtxLines,
          } : {}),
        },
        isEnhancing: false,
      }))
      // Auto-parse speaker names from the enhanced text whenever there are
      // voice slots to fill. Previously gated to dialogue mode only; the user
      // expects monologue enhance ("Peter: Hello world.") to also populate
      // voice slot 1 with "Peter". `force=true` overrides the manual flag
      // — enhance creates a fresh script, so previous user-edited names are
      // no longer relevant.
      if (ttsMode && get().ttsVoiceCount > 0) {
        get()._autoParseSpkeakerNames(result.enhanced, true)
      }
    } catch (e) {
      console.error('Failed to enhance prompt:', e)
      const message = e instanceof Error ? e.message : 'Prompt enhancement failed'
      set({
        isEnhancing: false,
        promptEnhanceError: `Prompt enhancement failed: ${message}`,
      })
    }
  },

  // Director (Music Video Director)
  // Default landing tab = Projects.
  appSection: 'projects',
  setAppSection: (section) => {
    // Gate project-scoped sections behind having a real (non-default)
    // workspace selected. Director, Editor and Medias all write or read
    // from the active workspace; navigating there with only the implicit
    // "default" workspace would silently route generations to the base
    // outputs/ folder, defeating the per-project organization. Settings
    // stays accessible — model/theme/storage tuning is global.
    const current = get()
    const gated: AppSection[] = ['director', 'editor', 'medias']
    if (gated.includes(section) && current.activeWorkspace === 'default') {
      section = 'projects'
    }
    set({
      appSection: section,
      sidebarMode: section === 'editor' ? 'editor' : 'workspace',
      // Studio now lives on its own top-level tab. Keep workspaceStage
      // pinned in sync so the legacy call sites (AdvancedSettings,
      // GenerateButton, directorSidebarMode branches) that key off
      // workspaceStage continue to behave correctly when the user
      // enters Studio via the new shell tab.
      workspaceStage: section === 'studio' ? 'studio' as const
        : section === 'director' ? 'director' as const
        : get().workspaceStage,
      settingsOpen: section === 'configurations',
      sidebarOpen: false,
    })
  },
  sidebarMode: 'workspace' as const,
  // Hydrate the rollout flag from localStorage if the user opted in
  // previously; default to true so the Director (Music Video / Short Film)
  // skill chooser is discoverable from the main UI. Users who prefer the
  // legacy pure-Studio view can flip this off in localStorage via the
  // keys listed below — or use `setWorkspaceUnifiedDirector(false)`.
  workspaceUnifiedDirector: (() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return true
      const raw = window.localStorage.getItem('cue-studio.workspaceUnifiedDirector')
      if (raw === null || raw === undefined) return true
      return raw === '1'
    } catch {
      return true
    }
  })(),
  // Default 'director' so the skill chooser (Music Video / Short Film)
  // is visible on first launch when the unified-director flag is on.
  // Users can toggle back to the Studio controls via the in-header
  // "Studio" button that appears once the Stage is open.
  workspaceStage: 'director' as const,
  directorStep: 'upload',
  directorAudioFile: null,
  directorAudioPath: null,
  directorAnalysis: null,
  directorApplyTimeline: async (slots, original) => {
    const before = get()
    if (before.pipelineStatus?.status === 'paused' && before.pipelineId) {
      if (before.directorPlannedClips !== original) throw new Error('The timeline changed. Reopen the editor.')
      await api.editPipelineTiming(before.pipelineId, slots, before.pipelineStatus.review_digest)
      get().pollPipelineStatus()
      return
    }
    if (before.directorLoading || ['queued', 'running', 'paused'].includes(before.pipelineStatus?.status || ''))
      throw new Error('Stop the active production before changing its scene structure.')
    const model = before.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    const options = await api.fetchModelOptions(model)
    const current = get()
    if (current.directorPlannedClips !== original || current.directorLoading || ['queued', 'running', 'paused'].includes(current.pipelineStatus?.status || ''))
      throw new Error('The project changed. Reopen the scene editor.')
    const fps = options.fps || 24
    const minimum = options.frames_minimum || 1
    const step = options.frames_steps || 1
    if (!slots.length || slots.length > 200 || Math.abs(slots[0].clip.start - original[0].start) > 0.001 || Math.abs(slots[slots.length - 1].clip.end - original[original.length - 1].end) > 0.001)
      throw new Error('The scene timeline must preserve the soundtrack duration.')
    for (let i = 0; i < slots.length; i++) {
      const { clip, sources } = slots[i]
      if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.end <= clip.start || (i > 0 && Math.abs(clip.start - slots[i - 1].clip.end) > 0.001) || !sources.length || sources.some(source => !Number.isInteger(source) || !original[source]))
        throw new Error('Invalid scene boundary or source.')
      if ((clip.end - clip.start) * fps < minimum - 1)
        throw new Error(`Scene ${i + 1} is too short for this model (minimum approximately ${(minimum / fps).toFixed(2)}s).`)
    }
    const plans = current.directorClipPlans
    const nextPlans: ClipPlan[] = plans.length ? slots.map(slot => {
      const sources = slot.sources.map(index => plans[index]).filter(Boolean)
      return {
        image_prompt: sources[0]?.image_prompt || '',
        video_prompt: [...new Set(sources.map(plan => plan.video_prompt).filter(Boolean))].join('\n'),
      }
    }) : []
    const images = slots.flatMap((slot, index) => {
      const source = current.directorClipImages.find(image => image.clipIndex === slot.sources[0])
      return source ? [{ ...source, clipIndex: index }] : []
    })
    const clips = slots.map(({ clip }) => ({ ...clip,
      duration_frames: minimum + Math.max(0, Math.round(((clip.end - clip.start) * fps - minimum) / step)) * step,
      beat_count: current.directorAnalysis?.beats.filter(beat => beat.time >= clip.start && beat.time < clip.end).length || 0,
    }))
    set({ directorPlannedClips: clips, directorClipPlans: nextPlans, directorClipImages: images,
      directorImageGenProgress: null, directorError: null,
      ...(plans.length ? { directorStep: images.length === clips.length ? 'review_video' as const : 'review' as const } : {}),
    })
  },
  directorPlannedClips: [],
  directorEnergyBias: 0,
  directorClipPlans: [],
  directorSelectedClipIndex: 0,
  setDirectorSelectedClipIndex: (index: number) => set({ directorSelectedClipIndex: index }),
  directorSceneDescription: '',
  // Project-scoped "things to avoid" derived once per project from the
  // scene description. Empty until directorGenerateNegativePrompt runs
  // (auto-fired when the scene description is committed).
  directorNegativePrompt: '',
  directorLoading: false,
  directorLoadingMessage: null,
  directorError: null,
  clearDirectorError: () => set({ directorError: null }),
  directorReferenceImage: null,
  directorReferenceImagePath: null,
  directorH3References: [],
  directorH3ReferenceDetail: 'match' as const,
  setDirectorH3References: (references) => set({ directorH3References: references }),
  setDirectorH3ReferenceDetail: (detail) => set({ directorH3ReferenceDetail: detail }),
  directorCharacterRefs: [],
  directorCharacterRefPaths: [],
  directorCharacterRefLabels: [],
  directorLocationRefs: [],
  directorLocationRefPaths: [],
  directorLocationRefLabels: [],
  directorVoiceRef: null,
  directorVoiceRefPath: null,
  directorIdentityGuidanceScale: 3.0,
  setDirectorVoiceRef: (file) => {
    if (file) {
      set({ directorVoiceRef: file, directorVoiceRefPath: null })
    } else {
      set({ directorVoiceRef: null, directorVoiceRefPath: null })
    }
  },
  setDirectorIdentityGuidanceScale: (v) => set({ directorIdentityGuidanceScale: v }),
  directorClipImages: [],
  directorSetClipImage: (clipIndex, file) => set(s => {
    const remaining = s.directorClipImages.filter(
      image => image.clipIndex !== clipIndex,
    )
    if (!file) return { directorClipImages: remaining }
    const image: DirectorClipImage = {
      clipIndex,
      prompt: s.directorClipPlans[clipIndex]?.image_prompt || '',
      file,
      filename: file.name,
    }
    return {
      directorClipImages: [...remaining, image].sort(
        (left, right) => left.clipIndex - right.clipIndex,
      ),
    }
  }),
  directorImageGenProgress: null,
  directorAnalyzeProgress: null,
  setDirectorAnalyzeProgress: (progress) => set({ directorAnalyzeProgress: progress }),
  directorSpeakers: [],
  directorSpeakerMappings: [],
  // Defaults per user preference (2026-06 / 2026-09): Auto ON (hands-off pipeline is
  // the common flow), Seamless OFF (separate per-clip generations are easier
  // to retake/review than one rolling-window render).
  directorAutoMode: true,
  directorSeamless: false,
  directorShotImageGuidance: 'auto' as DirectorShotImageGuidance,
  directorLlmLog: [],
  directorSkill: null,
  directorMusicSource: null,
  directorMusicModel: 'ace_step_v1_5_xl_sft_lm_4b',
  directorAdvancedDefaults: {},
  directorSongDescription: '',
  directorSongInstrumental: false,
  directorSongStyle: '',
  directorSongLyrics: '',
  directorSongDuration: 120,
  directorTrackGenerating: false,
  setDirectorMusicSource: (s) => set({ directorMusicSource: s }),
  setDirectorMusicModel: (modelType) => set({
    directorMusicModel: modelType,
    // The two model families use different caption contracts. Never retain a
    // hidden song plan written for the previously selected generator.
    directorSongStyle: '',
    directorSongLyrics: '',
  }),
  setDirectorSongDescription: (v) => set({ directorSongDescription: v }),
  setDirectorSongInstrumental: (v) => set({ directorSongInstrumental: v }),
  setDirectorSongStyle: (v) => set({ directorSongStyle: v }),
  setDirectorSongLyrics: (v) => set({ directorSongLyrics: v }),
  setDirectorSongDuration: (v) => set({ directorSongDuration: v }),
  directorResolution: '720p' as ResolutionPreset,
  directorAspectRatio: '16:9' as AspectRatio,
  directorVideoInferenceStepsByModel: {},
  directorVideoMaxShotFramesByModel: {},
  directorH3TurboModeByModel: {},
  directorH3TurboPresetByModel: {},
  directorH3SolModeByModel: {},
  directorH3FirstBlockCacheByModel: {},
  directorH3FirstBlockCacheMultiplierByModel: {},
  directorH3FirstBlockCacheWarmupByModel: {},
  shortFilmCharacters: [],
  shortFilmPath: null,
  shortFilmTargetDuration: 30,
  shortFilmNarrative: false,
  llmStreamText: '',
  llmStreamDone: true,
  directorActivityLabel: 'Idle',
  directorActivityFraction: NaN,
  pipelineId: null,
  pipelineStatus: null,
  pipelinePolling: false,
  directorSourcePipelineId: null,
  directorProjectId: null,
  setDirectorAutoMode: (v) => set({ directorAutoMode: v }),
  setDirectorSeamless: (v) => set({ directorSeamless: v }),
  setDirectorShotImageGuidance: (v) => set({
    directorShotImageGuidance: v,
    // Selecting "None" must not leave generated images from an earlier
    // choice silently attached to manual video jobs. Users can add fresh
    // per-scene uploads from the review screen after making this choice.
    ...(v === 'prompt_only' ? {
      directorClipImages: [],
      directorImageGenProgress: null,
    } : {}),
  }),
  directorAppendLlmLog: (stage, text) => set(s => {
    const t = (text || '').trim()
    if (!t) return {}
    const last = s.directorLlmLog[s.directorLlmLog.length - 1]
    // Skip exact repeats (the poll can fire the done-transition more than
    // once for the same stream when stages restart back-to-back).
    if (last && last.stage === stage && last.text === t) return {}
    return { directorLlmLog: [...s.directorLlmLog, { stage, text: t }] }
  }),
  setDirectorSkill: (skill) => {
    const normalized = canonicalDirectorSkill(skill)
    set({ directorSkill: normalized })
    const state = get()
    const selectedVideoModel = state.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    const selectedVideoDefinition = state.models.find(
      model => model.model_type === selectedVideoModel,
    )
    if (directorModelUsesFixedMediaStrength(
      selectedVideoModel,
      selectedVideoDefinition?.architecture,
    )) {
      if (state.params.input_video_strength !== 1.0) {
        state.setParam('input_video_strength', 1.0)
      }
      return
    }
    // Music director default for image-to-video reference strength is
    // 0.7 (loosens the lock to the start frame so motion can develop
    // naturally) rather than 1.0 (rigid frame). Only initialize when
    // the param is unset OR still at the global 1.0 default — preserves
    // any value the user has already adjusted in this session.
    //
    // Goes through setParam (not a direct `params` write) so the value
    // propagates into savedParamsPerMode.video — that's what the
    // Director pipeline reads when building video_params for the
    // submission. Without this routing the slider would show 0.7 but
    // the pipeline would still send 1.0.
    if (normalized === 'music_video') {
      const current = get().params.input_video_strength
      if (current == null || current === 1.0) {
        get().setParam('input_video_strength', 0.7)
      }
    }
  },
  setDirectorResolution: (preset) => set({ directorResolution: preset }),
  setDirectorAspectRatio: (ratio) => set({ directorAspectRatio: ratio }),
  setDirectorVideoInferenceSteps: (modelType, steps) => set(s => {
    const next = { ...s.directorVideoInferenceStepsByModel }
    if (steps == null || !Number.isFinite(steps)) {
      delete next[modelType]
    } else {
      next[modelType] = Math.max(1, Math.min(50, Math.round(steps)))
    }
    return { directorVideoInferenceStepsByModel: next }
  }),
  setDirectorVideoMaxShotFrames: (modelType, frames) => set(s => {
    const next = { ...s.directorVideoMaxShotFramesByModel }
    if (frames == null || !Number.isFinite(frames) || frames <= 0) {
      delete next[modelType]
    } else {
      next[modelType] = Math.round(frames)
    }
    return { directorVideoMaxShotFramesByModel: next }
  }),
  setDirectorH3TurboMode: (modelType, enabled) => set(s => ({
    directorH3TurboModeByModel: {
      ...s.directorH3TurboModeByModel,
      [modelType]: enabled,
    },
  })),
  setDirectorH3TurboPreset: (modelType, presetId) => set(s => ({
    directorH3TurboPresetByModel: {
      ...s.directorH3TurboPresetByModel,
      [modelType]: presetId,
    },
  })),
  setDirectorH3SolMode: (modelType, enabled) => set(s => ({
    directorH3SolModeByModel: {
      ...s.directorH3SolModeByModel,
      [modelType]: enabled,
    },
  })),
  setDirectorH3FirstBlockCache: (modelType, enabled) => set(s => ({
    directorH3FirstBlockCacheByModel: {
      ...s.directorH3FirstBlockCacheByModel,
      [modelType]: enabled,
    },
  })),
  setDirectorH3FirstBlockCacheMultiplier: (modelType, value) => set(s => ({
    directorH3FirstBlockCacheMultiplierByModel: {
      ...s.directorH3FirstBlockCacheMultiplierByModel,
      [modelType]: value,
    },
  })),
  setDirectorH3FirstBlockCacheWarmup: (modelType, value) => set(s => ({
    directorH3FirstBlockCacheWarmupByModel: {
      ...s.directorH3FirstBlockCacheWarmupByModel,
      [modelType]: Math.max(0, Math.min(75, Math.round(value / 5) * 5)),
    },
  })),

  selectDirectorImageModel: (modelType) => {
    if (get().selectedModelPerMode.image === modelType) return
    set(s => ({
      selectedModelPerMode: { ...s.selectedModelPerMode, image: modelType },
      // Model-specific prompts and rendered starts must never survive a
      // pre-planning model change. Keep the uploaded/analyzed source intact.
      directorClipPlans: [],
      directorClipImages: [],
      directorImageGenProgress: null,
      directorError: null,
    }))
    const s = get()
    _saveSettings({
      generationMode: s.generationMode,
      selectedModelPerMode: s.selectedModelPerMode,
      savedParamsPerMode: s.savedParamsPerMode,
      savedLoraPerMode: s.savedLoraPerMode,
      savedPromptPerMode: s.savedPromptPerMode,
    }, s.loraIdByFilename)
  },

  selectDirectorVideoModel: (modelType) => {
    const previousModel = get().selectedModelPerMode.video
    if (previousModel === modelType) return
    set(s => ({
      selectedModelPerMode: { ...s.selectedModelPerMode, video: modelType },
      // The video model determines both prompt rules and the legal frame
      // lattice. Preserve source media and analysis, but invalidate anything
      // derived downstream from those choices.
      directorClipPlans: [],
      directorClipImages: [],
      directorImageGenProgress: null,
      directorError: null,
    }))
    const selectedVideoDefinition = get().models.find(
      model => model.model_type === modelType,
    )
    if (directorModelUsesFixedMediaStrength(
      modelType,
      selectedVideoDefinition?.architecture,
    ) && get().params.input_video_strength !== 1.0) {
      get().setParam('input_video_strength', 1.0)
    }
    get().loadModelOptions(modelType)
    const current = get()
    if (
      current.directorAnalysis
      && (current.directorStep === 'structure' || current.directorStep === 'style')
    ) {
      // Rebuild clip lengths against the newly selected model without
      // re-uploading or re-transcribing the user's audio.
      void current.directorSetEnergyBias(current.directorEnergyBias)
    }
    const s = get()
    _saveSettings({
      generationMode: s.generationMode,
      selectedModelPerMode: s.selectedModelPerMode,
      savedParamsPerMode: s.savedParamsPerMode,
      savedLoraPerMode: s.savedLoraPerMode,
    }, s.loraIdByFilename)
  },

  directorSetLora: (mode, activated_loras, loras_multipliers, loraWeights, availableLoras) => {
    const s = get()
    const updatedLoraPerMode = {
      ...s.savedLoraPerMode,
      [mode]: { activated_loras, loras_multipliers, loraWeights, availableLoras },
    }
    set({ savedLoraPerMode: updatedLoraPerMode })
    _saveSettings({
      generationMode: s.generationMode,
      selectedModelPerMode: s.selectedModelPerMode,
      savedParamsPerMode: s.savedParamsPerMode,
      savedLoraPerMode: updatedLoraPerMode,
    }, s.loraIdByFilename)
  },

  directorSetSpeakerMapping: (speakerId, name, role, image, imagePreview) => {
    set(s => ({
      directorSpeakerMappings: s.directorSpeakerMappings.map(m =>
        m.speakerId === speakerId
          ? {
              ...m,
              name,
              role,
              ...(image !== undefined ? { image } : {}),
              ...(imagePreview !== undefined ? { imagePreview } : {}),
            }
          : m
      ),
    }))
  },

  directorInsertSpeakerMention: (speakerId) => {
    set(s => ({
      directorSceneDescription: s.directorSceneDescription
        ? `${s.directorSceneDescription} @${speakerId}`
        : `@${speakerId}`,
    }))
  },

  setSidebarMode: (mode) => {
    if (mode === 'editor') {
      get().setAppSection('editor')
    } else if (mode === 'director') {
      get().openDirectorStage()
    } else if (mode === 'studio') {
      // Studio is now its own top-level shell tab. Navigate there
      // directly; setAppSection pins workspaceStage='studio' for the
      // legacy call sites that still key off it.
      get().setAppSection('studio')
    } else if (mode === 'workspace') {
      get().setAppSection('director')
    }
  },

  openDirectorStage: () => {
    set({ appSection: 'director', sidebarMode: 'workspace', workspaceStage: 'director', sidebarOpen: false, settingsOpen: false })
    // The skill is a project-level choice — the chat no longer asks.
    // Fall back to the active project's setup, then music_video.
    if (!get().directorSkill) {
      const setupSkill = get().activeWorkspaceSetup?.director_skill
      get().setDirectorSkill(setupSkill === 'short_film' ? 'short_film' : 'music_video')
    }
    void get().loadDirectorQueue()
  },

  closeDirectorStage: () => {
    set({ appSection: 'director', sidebarMode: 'workspace', workspaceStage: 'studio', settingsOpen: false })
  },

  setWorkspaceUnifiedDirector: (enabled) => {
    set({ workspaceUnifiedDirector: enabled })
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(
          'cue-studio.workspaceUnifiedDirector',
          enabled ? '1' : '0',
        )
      }
    } catch {
      // localStorage may be unavailable (private mode, SSR); the flag
      // simply won't persist across reloads.
    }
  },

  /**
   * Reset only the Director skill selection, leaving the rest of the
   * Stage state intact.
   *
   * The skill is a project-level choice now (picked on the project
   * creation/setup screen), so this restores the active project's
   * skill instead of unsetting it — there is no in-chat picker left
   * to recover from a null skill.
   *
   * What this clears:
   *   - shortFilmPath (irrelevant once skill is re-applied)
   *   - directorStep (back to 'upload' so the skill starts fresh)
   *
   * What this preserves:
   *   - audioFile / audioPath / analysis / sceneDescription /
   *     plannedClips / clipPlans / reference images / H3 refs /
   *     clip images. Re-uploading or re-planning would be wasteful
   *     when the user just wants to switch workflows.
   */
  resetDirectorSkillOnly: () => {
    const setupSkill = get().activeWorkspaceSetup?.director_skill
    set({
      directorSkill: setupSkill === 'short_film' ? 'short_film' : 'music_video',
      shortFilmPath: null,
      directorStep: 'upload',
      directorError: null,
    })
  },

  // --- Director planning & storyboard actions ---
  ...createDirectorPlanningSlice(set, get, store, {
    startDirectLlmStreamPolling: _startDirectLlmStreamPolling,
    directorUsesGeneratedShotImages: _directorUsesGeneratedShotImages,
    resolveResolution,
    normalizeH3ClipFrameSchedule,
    getAnalysisSequence: () => _directorAnalysisSequence,
    bumpAnalysisSequence: () => ++_directorAnalysisSequence,
    getAnalyzeController: () => _directorAnalyzeController,
    setAnalyzeController: (c) => { _directorAnalyzeController = c },
    getAnalyzeStopPoll: () => _directorAnalyzeStopPoll,
    setAnalyzeStopPoll: (fn) => { _directorAnalyzeStopPoll = fn },
    getTrackGenSequence: () => _directorTrackGenSequence,
    bumpTrackGenSequence: () => ++_directorTrackGenSequence,
    getTrackGenPoll: () => _directorTrackGenPoll,
    setTrackGenPoll: (poll) => { _directorTrackGenPoll = poll },
    getTrackGenController: () => _directorTrackGenController,
    setTrackGenController: (c) => { _directorTrackGenController = c },
    getImageGenSequence: () => _directorImageGenSequence,
    bumpImageGenSequence: () => ++_directorImageGenSequence,
    getImageGenJob: () => _directorImageGenJob,
    setImageGenJob: (j) => { _directorImageGenJob = j },
    getImageGenPoll: () => _directorImageGenPoll,
    setImageGenPoll: (poll) => { _directorImageGenPoll = poll },
    getV2PlanController: () => _directorV2PlanController,
    setV2PlanController: (c) => { _directorV2PlanController = c },
    bumpPipelineAttachToken: () => ++_directorPipelineAttachToken,
    getNegativePromptDebounce: () => _directorNegativePromptDebounce,
    setNegativePromptDebounce: (timer) => { _directorNegativePromptDebounce = timer },
  }),

  // --- Short Film Director actions ---
  ...createShortFilmSlice(set, get, store, {
    startDirectLlmStreamPolling: _startDirectLlmStreamPolling,
    directorUsesGeneratedShotImages: _directorUsesGeneratedShotImages,
    getAnalysisSequence: () => _directorAnalysisSequence,
    bumpAnalysisSequence: () => ++_directorAnalysisSequence,
    setAnalyzeController: (ctrl) => { _directorAnalyzeController = ctrl },
    getAnalyzeController: () => _directorAnalyzeController,
    setAnalyzeStopPoll: (fn) => { _directorAnalyzeStopPoll = fn },
  }),

  ...createWorkspaceSlice(set, get, store),

  loraPickerSort: (() => {
    try { return localStorage.getItem('cue-studio_lora_picker_sort') === 'newest' ? 'newest' as const : 'name' as const } catch { return 'name' as const }
  })(),
  setLoraPickerSort: (sort) => {
    try { localStorage.setItem('cue-studio_lora_picker_sort', sort) } catch { /* private mode */ }
    set({ loraPickerSort: sort })
  },

  ...createMediaOutputsSlice(set, get, store, {
    getModelMode,
    normalizeStudioImageWorkflow: _normalizeStudioImageWorkflow,
    normalizeStudioVideoWorkflow: _normalizeStudioVideoWorkflow,
    isOmniVideoModel: _isOmniVideoModel,
    captureVideoSubModeStash,
    sfxModelTypes,
    isMusicModelType,
    findResolutionSelection,
    defaultRecastMapping: DEFAULT_RECAST_MAPPING,
  }),

  // ── Director Pipeline (server-side) ──────────────────────────────
  startDirectorPipeline: async (mode = 'now') => {
    const { startDirectorPipeline } = await import('./directorSubmission')
    await startDirectorPipeline(set, get, mode, {
      resolveResolution,
      directorModelUsesFixedMediaStrength,
      onAttach: () => { _directorPipelineAttachToken += 1 },
    })
  },

  continuePipeline: async (updates) => {
    const pid = get().pipelineId
    if (!pid) return
    try {
      await api.continuePipeline(pid, updates)
      set({ directorLoading: true })
    } catch (e) {
      console.error('Failed to continue pipeline:', e)
    }
  },

  stopPipeline: async () => {
    const pid = get().pipelineId
    if (!pid) return
    try {
      await api.stopPipeline(pid)
      _directorPipelinePollToken += 1
      set({ pipelineId: null, pipelineStatus: null, pipelinePolling: false, directorLoading: false })
    } catch (e) {
      console.error('Failed to stop pipeline:', e)
    }
  },

  /**
   * Unified cancel for the in-Workspace Stage. Strategy B replaced
   * the four parallel cancel surfaces (stopPipeline / cancelDirectorV2Plan
   * / cancelJob / repair cancel) with a single entry point.
   *
   * The function is fire-and-forget friendly — each sub-cancel is wrapped
   * in its own try/catch so a partial failure doesn't strand the others.
   * The returned object lets tests assert exactly which surfaces flipped.
   */
  cancelPlan: async () => {
    const result = {
      cancelledV2Plan: false,
      cancelledPipeline: false,
      cancelledJobs: 0,
      cancelledAnalyze: false,
      cancelledTrackGen: false,
      cancelledImageGen: false,
    }
    const state = get()

    // 1. If a Director v2 plan is in flight, abort the fetch + flip
    //    the server-side cancel event. cancelDirectorV2Plan() already
    //    does both — wrap it so a failure here doesn't break the rest.
    if (_directorV2PlanController || (state.directorLoading && (state.directorStep === 'plan' || state.directorStep === 'plan_video'))) {
      try {
        get().cancelDirectorV2Plan()
        result.cancelledV2Plan = true
      } catch (e) {
        console.error('cancelPlan: v2 plan cancel failed:', e)
      }
    }

    // 2. If a Director pipeline is running, flip its status AND abort
    //    each child job. stopPipeline() flips the pipeline record; the
    //    fan-out to child jobs is the server-side responsibility
    //    (`director_pipeline._abort_pipeline_jobs`), so a single
    //    POST /api/v1/director/pipeline/{pid}/stop is enough.
    if (state.pipelineId) {
      try {
        await get().stopPipeline()
        result.cancelledPipeline = true
        // The pipeline may have children. We don't have the child job
        // IDs in the store directly, but the server's _abort_pipeline_jobs
        // fans out for us. Surface a rough count via pipelineStatus.
        const status = get().pipelineStatus
        if (status && typeof status === 'object') {
          const total = (status as { progress?: { total?: number } }).progress?.total ?? 0
          result.cancelledJobs = total
        }
      } catch (e) {
        console.error('cancelPlan: pipeline cancel failed:', e)
      }
    }

    // 3. Audio analyze. Each action self-guards on its phase, so calling
    //    unconditionally is safe — the action returns false if nothing was
    //    running and we just don't flip the bit.
    try {
      result.cancelledAnalyze = get().cancelDirectorAnalyze()
    } catch (e) {
      console.error('cancelPlan: analyze cancel failed:', e)
    }

    // 4. Track generation.
    try {
      result.cancelledTrackGen = get().cancelDirectorTrackGen()
    } catch (e) {
      console.error('cancelPlan: track-gen cancel failed:', e)
    }

    // 5. Start-image generation.
    try {
      result.cancelledImageGen = get().cancelDirectorImageGen()
    } catch (e) {
      console.error('cancelPlan: image-gen cancel failed:', e)
    }

    if (get().directorLoading) {
      set({ directorLoading: false, directorLoadingMessage: null, directorActivityLabel: 'Idle' })
    }

    return result
  },

  pollPipelineStatus: () => {
    const pid = get().pipelineId
    if (!pid) return
    const pollToken = ++_directorPipelinePollToken

    const poll = async () => {
      if (
        pollToken !== _directorPipelinePollToken
        || !get().pipelinePolling
        || get().pipelineId !== pid
      ) return

      try {
        const pipelineState: api.PipelineStatus = await api.fetchPipelineStatus(pid)
        if (pollToken !== _directorPipelinePollToken || get().pipelineId !== pid) return
        const activity = _computeDirectorActivity(pipelineState, get().directorLoadingMessage)
        set({
          pipelineStatus: pipelineState,
          directorLoadingMessage: pipelineState.progress?.message || null,
          directorActivityLabel: activity.label,
          directorActivityFraction: activity.fraction,
        })

        // Sync the backend's model-adapted plan, not just an initially empty
        // UI. H3 can split broad 20-30s music sections into additional native
        // <=14.4s shots after the browser has already populated its draft
        // timeline. The old empty-only guard left those stale durations and
        // prompts visible even though the worker queued the shorter plan.
        // Once the editor reaches review_video, however, its controls are a
        // draft for the *next* immutable revision. Polling the active revision
        // must not overwrite prompt or scene-image edits the user is making
        // while that render continues in the background.
        const preserveNextRevisionDraft = get().directorStep === 'review_video'
        const currentPlans = get().directorClipPlans
        const currentTimeline = get().directorPlannedClips
        const plansChanged = Boolean(pipelineState.clip_plans?.length) && (
          currentPlans.length !== pipelineState.clip_plans.length
          || pipelineState.clip_plans.some((plan, index) => (
            plan.video_prompt !== currentPlans[index]?.video_prompt
            || plan.image_prompt !== currentPlans[index]?.image_prompt
          ))
        )
        const timelineChanged = Boolean(pipelineState.planned_clips?.length) && (
          currentTimeline.length !== pipelineState.planned_clips!.length
          || pipelineState.planned_clips!.some((clip, index) => (
            clip.start !== currentTimeline[index]?.start
            || clip.end !== currentTimeline[index]?.end
            || clip.duration_frames !== currentTimeline[index]?.duration_frames
          ))
        )
        if (!preserveNextRevisionDraft && (plansChanged || timelineChanged)) {
          set({
            ...(plansChanged ? { directorClipPlans: pipelineState.clip_plans } : {}),
            ...(timelineChanged ? { directorPlannedClips: pipelineState.planned_clips! } : {}),
            ...(!currentPlans.length && plansChanged ? { directorStep: 'review' as const } : {}),
          })
        }

        if (!preserveNextRevisionDraft && pipelineState.clip_images?.length) {
          // Strip empty filenames — those are failed-shot sentinels from the
          // pipeline (clip_images.append("") on exception). If we keep them,
          // downstream <img src={getFileUrl("")} /> hits /api/v1/file/ which
          // can resolve to a stale cached file rather than nothing, producing
          // the "same unrelated image over and over" symptom users see when
          // image gen fails (e.g. incompatible LoRA architecture).
          // clipIndex is captured BEFORE filtering so it stays aligned to
          // the original clip plan position even when failed shots drop out.
          const images = pipelineState.clip_images
            .map((filename, i) => ({
              clipIndex: i,
              prompt: pipelineState.clip_plans?.[i]?.image_prompt || '',
              file: null as unknown as File,
              filename,
            }))
            .filter(img => img.filename && img.filename.length > 0)
          set({ directorClipImages: images })
        }

        // Handle phase transitions
        if (pipelineState.phase === 'polishing_prompts') {
          set({
            directorImageGenProgress: {
              current: pipelineState.progress.current,
              total: pipelineState.progress.total,
              currentClipLabel: pipelineState.progress.message || 'Polishing prompts (3rd pass)...',
              status: 'generating',
            },
          })
        } else if (pipelineState.phase === 'generating_images') {
          set({
            directorStep: 'generate_images',
            directorImageGenProgress: {
              current: pipelineState.progress.current,
              total: pipelineState.progress.total,
              currentClipLabel: pipelineState.progress.message,
              status: 'generating',
            },
          })
          // Refresh media feed to show new images as they're generated
          get().refreshOutputs()
        } else if (pipelineState.phase === 'preparing_video') {
          // H3 prompt-only/direct-reference projects intentionally skip the
          // image review stage and proceed straight to video rendering.
          set({
            directorStep: 'review_video',
            directorImageGenProgress: null,
          })
        } else if (pipelineState.phase === 'generating_video') {
          set({ directorStep: 'review_video' })
          // Refresh media feed to show new video clips as they complete
          get().refreshOutputs()
        }

        // Handle LLM streaming
        if (pipelineState.llm_streaming) {
          set({ llmStreamDone: false })
        }

        // Handle pause
        if (pipelineState.status === 'paused') {
          set({ directorLoading: false })
          if (pipelineState.pause_reason === 'review_prompts') {
            set({ directorStep: 'review' })
          } else if ((pipelineState.pause_reason === 'review_images' || pipelineState.pause_reason === 'review_render')) {
            set({ directorStep: 'review_video' })
          }
        }

        // Handle completion
        if (pipelineState.status === 'completed') {
          set({
            pipelinePolling: false,
            directorLoading: false,
            directorLoadingMessage: null,
            directorStep: 'review_video',
            directorActivityLabel: 'Director run completed',
            directorActivityFraction: 1,
          })
          get().loadOutputs()
          return  // Stop polling
        }

        // Handle failure
        if (pipelineState.status === 'failed' || pipelineState.status === 'cancelled') {
          set({
            pipelinePolling: false,
            directorLoading: false,
            directorLoadingMessage: null,
            directorError: pipelineState.error || 'Pipeline stopped',
            directorActivityLabel: pipelineState.status === 'failed' ? 'Director run failed' : 'Director run cancelled',
            directorActivityFraction: NaN,
          })
          return  // Stop polling
        }

      } catch (e) {
        console.error('Pipeline poll error:', e)
      }

      // While the pipeline is in an LLM-driven phase, the backend
      // (llm_service.generate_streaming) is populating _stream_buffer
      // token-by-token. Poll the lightweight /api/v1/llm/stream-status
      // endpoint and push the buffer into the store so the activity
      // block in the middle column can render a live "X tokens
      // streamed so far…" counter instead of just a generic spinner.
      // This poll is throttled to every other pipeline tick (2s × 2 =
      // 4s) to keep the network chatter small while still feeling live.
      if (
        pollToken === _directorPipelinePollToken
        && get().pipelinePolling
        && get().pipelineStatus
        && (get().pipelineStatus!.phase === 'planning' || get().pipelineStatus!.phase === 'polishing_prompts')
        && get().pipelineStatus!.llm_streaming
      ) {
        try {
          const stream = await api.getLlmStreamStatus()
          if (pollToken === _directorPipelinePollToken && get().pipelineId === pid) {
            const current = get().llmStreamText
            // Avoid forcing a re-render every tick if nothing changed;
            // the backend also buffers in chunks, so this filters out
            // the same content being read back twice.
            if (stream.text && stream.text !== current) {
              set({ llmStreamText: stream.text, llmStreamDone: stream.done })
            } else if (stream.done !== get().llmStreamDone) {
              set({ llmStreamDone: stream.done })
            }
          }
        } catch (e) {
          // stream-status is best-effort; don't fail the pipeline poll.
          console.debug('LLM stream-status poll failed:', e)
        }
      } else if (
        pollToken === _directorPipelinePollToken
        && get().pipelinePolling
        && (get().llmStreamText !== '' || !get().llmStreamDone)
      ) {
        // Reset the streaming state when the pipeline leaves the LLM
        // phases so the next run starts clean. We don't clear it
        // mid-pass — only on phase transitions out of planning/polish.
        set({ llmStreamText: '', llmStreamDone: true })
      }

      // Continue polling
      if (pollToken === _directorPipelinePollToken && get().pipelinePolling) {
        setTimeout(poll, 2000)
      }
    }

    setTimeout(poll, 1000)
  },
}))
