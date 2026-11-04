/* eslint-disable react-refresh/only-export-components -- shared options between
   ProjectSetup form chips and the Director right-column override live here
   so the two surfaces stay in lockstep. */
import { Film, Music } from 'lucide-react'
import type { ProjectSetupDefaults, AspectRatio, ResolutionPreset, GenerationMode } from '../../types'
import { DEFAULT_PROJECT_SETUP } from '../../types'
import type { ApiModel } from '../../api/client'

/** Curated models registry for clean, noise-free project selection with meaningful labels */
export interface CuratedModelInfo {
  name: string
  badge: string
  category: 'video' | 'image' | 'audio'
}

export const CURATED_MODELS: Record<string, CuratedModelInfo> = {
  // === VIDEO ===
  'scail2_14B': { name: 'SCAIL-2 14B', badge: 'Top Quality · 14B', category: 'video' },
  'scail2_14B_fast': { name: 'SCAIL-2 14B Fast', badge: 'Balanced · Fast', category: 'video' },
  'ltx2_25': { name: 'LTX-2.5 Distilled', badge: 'Faster · 4-step', category: 'video' },
  'ltx2_25_dev': { name: 'LTX-2.5 Dev', badge: 'High Fidelity · 22B', category: 'video' },
  'ltx2_22B_distilled_1_1': { name: 'LTX-2.3 Distilled 1.1', badge: 'Balanced · Smooth', category: 'video' },
  'ltx2_22B': { name: 'LTX-2.3 Dev 22B', badge: 'High Quality · 22B', category: 'video' },
  'minimax_h3': { name: 'MiniMax H3 First/Last', badge: 'Top Long Scenes', category: 'video' },
  'minimax_h3_ref2va': { name: 'MiniMax H3 Omni', badge: 'Character Consistency', category: 'video' },
  'ovi_1_1': { name: 'Wan 2.2 Ovi 10B', badge: 'High Dynamics · 10B', category: 'video' },
  't2v_2_2': { name: 'Wan 2.2 14B', badge: 'Top Quality · Cinematic', category: 'video' },
  't2v_1.3B': { name: 'Wan 2.1 1.3B', badge: 'Very Light · Fast', category: 'video' },
  'vace_ditto_14B': { name: 'Ditto 14B', badge: 'Specialized: Lip-Sync', category: 'video' },
  'fantasy': { name: 'Fantasy Talking 14B', badge: 'Specialized: Lip-Sync', category: 'video' },

  // === IMAGE ===
  'flux2_dev': { name: 'Flux 2 Dev 32B', badge: 'Absolute Top Quality', category: 'image' },
  'flux': { name: 'Flux 1 Dev 12B', badge: 'Gold Standard · LoRAs', category: 'image' },
  'flux2_klein_9b': { name: 'Flux 2 Klein 9B', badge: 'More Balanced · 9B', category: 'image' },
  'flux2_klein_4b': { name: 'Flux 2 Klein 4B', badge: 'Super Fast · 4B', category: 'image' },
  'flux_chroma_radiance': { name: 'Flux 1 Radiance 8.9B', badge: 'Cinematic Colors', category: 'image' },
  'krea2_raw': { name: 'Krea 2 RAW', badge: 'Photorealism & Texture', category: 'image' },
  'krea2_turbo': { name: 'Krea 2 Turbo', badge: 'Fast & Creative', category: 'image' },
  'qwen_image_20B': { name: 'Qwen Image 20B', badge: 'Rich Prompt · 20B', category: 'image' },
  'qwen_image_edit_20B': { name: 'Qwen Image Edit 20B', badge: 'Editing & Inpainting', category: 'image' },
  'z_image': { name: 'Z-Image Turbo 6B', badge: 'Light & Fast · 6B', category: 'image' },

  // === AUDIO ===
  'minimax_music3': { name: 'MiniMax-Music3', badge: 'Music: Top Arrangement & Vocals', category: 'audio' },
  'ace_step_v1_5_xl_sft': { name: 'ACE-Step v1.5 XL 4B', badge: 'Music: High Fidelity', category: 'audio' },
  'ace_step_v1_5': { name: 'ACE-Step v1.5 Turbo 2B', badge: 'Music: Fast & Beats', category: 'audio' },
  'yue': { name: 'YuE 7B + 1B', badge: 'Music: Two Stage Songs', category: 'audio' },
  'yue_icl': { name: 'YuE 7B + 1B (ICL)', badge: 'Music: From a Reference', category: 'audio' },
  'kugelaudio_0_open': { name: 'KugelAudio 0 Open 7B', badge: 'Voice: Top Expression & Speech', category: 'audio' },
  'chatterbox': { name: 'Chatterbox Multilingual', badge: 'Voice: Multilingual', category: 'audio' },
  'qwen3_tts_base': { name: 'Qwen3 TTS 1.7B', badge: 'Voice: Light & Fast', category: 'audio' },
  'dramabox_audio': { name: 'DramaBox Audio', badge: 'Sound Effects & Ambience', category: 'audio' },
}

export type ModelSpeedTier = 'Fast' | 'Balanced' | 'Best quality'

const FAST_MODEL_RE = /(distill|turbo|schnell|lightning|flash|hyper|lite|klein[_-]?4b|(^|[\s_.-])1[._]3b\b|_1b\b)/
const QUALITY_MODEL_RE = /(^|[\s_.-])(dev|pro|max|ultra|radiance|xl|full)(?=[\s_.-]|$)|(^|[\s_.-])(1[49]|19|20|22|25)b\b/

export function modelSpeedTier(model: ApiModel): string {
  const curated = CURATED_MODELS[model.model_type]
  if (curated) return curated.badge
  const haystack = `${model.name || ''} ${model.model_type || ''} ${model.architecture || ''}`.toLowerCase()
  if (FAST_MODEL_RE.test(haystack)) return 'Fast'
  if (QUALITY_MODEL_RE.test(haystack)) return 'Best quality'
  return 'Balanced'
}

const AUDIO_MODEL_RE = /audio|tts|music|voice|vocal/

export function isAudioModel(model: ApiModel): boolean {
  if (model.family === 'tts') return true
  const haystack = `${model.architecture || ''} ${model.name || ''} ${model.model_type || ''}`.toLowerCase()
  return AUDIO_MODEL_RE.test(haystack)
}

/** AspectRatio options surfaced in the project-setup form. Mirrors
 *  `DirectorAspectRatioSelector` so the two surfaces pick from the
 *  same set; ultra-wide (21:9) only shows when the project's video
 *  model supports it. */
export const PROJECT_SETUP_ASPECT_RATIOS: ReadonlyArray<{ value: AspectRatio; label: string; desc: string }> = [
  { value: '16:9', label: '16:9', desc: 'Wide' },
  { value: '9:16', label: '9:16', desc: 'Portrait' },
  { value: '1:1', label: '1:1', desc: 'Square' },
  { value: '4:3', label: '4:3', desc: 'Classic' },
  { value: '3:4', label: '3:4', desc: 'Tall' },
  { value: '21:9', label: '21:9', desc: 'Cinema' },
]

/** Resolution preset options. `auto` is intentionally excluded because
 *  the project setup is what the user wants every generation to
 *  START with — "auto" is a per-take decision that lives on the
 *  right column of the Director. */
export const PROJECT_SETUP_RESOLUTIONS: ReadonlyArray<{ value: ResolutionPreset; label: string }> = [
  { value: '480p', label: '480p' },
  { value: '540p', label: '540p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
]

export interface ProjectSetupFormProps {
  value: ProjectSetupDefaults
  onChange: (next: ProjectSetupDefaults) => void
  disabled?: boolean
  /** Render compact version (less spacing) — used inside the small
   *  Edit setup modal so it fits next to other controls. */
  compact?: boolean
  /** Hide the skill selector (e.g. when already chosen via project Type). */
  hideSkill?: boolean
}

/**
 * ProjectSetupForm — reusable fields editor for project-level choices.
 *
 * Used by both the New project dialog (ProjectsPage) and the per-card
 * Edit setup affordance. Every change flows through `onChange` so the
 * parent can own the submit / persist logic (keep the source of truth
 * in one place — the form is a pure controlled component).
 */
export function ProjectSetupForm({
  value,
  onChange,
  disabled = false,
  compact = false,
  hideSkill = false,
}: ProjectSetupFormProps) {
  const safeValue: ProjectSetupDefaults = { ...DEFAULT_PROJECT_SETUP, ...value }
  const update = (patch: Partial<ProjectSetupDefaults>) => onChange({ ...safeValue, ...patch })

  const supportsUltraWide = (safeValue.video_model || '').toLowerCase().startsWith('minimax_h3')
  const aspectOptions = PROJECT_SETUP_ASPECT_RATIOS.filter(opt => opt.value !== '21:9' || supportsUltraWide)

  const sectionCls = compact ? 'space-y-1.5' : 'space-y-2'

  return (
    <div className={`text-sm ${compact ? 'space-y-2.5' : 'space-y-3'}`}>
      {/* Skill — which Director workflow this project plans with.
          Chosen once here so the Director chat never asks again;
          changing it later re-syncs the Director through
          applyWorkspaceSetup. */}
      {!hideSkill && (
        <fieldset className={sectionCls} aria-label="Director skill">
          <legend className="text-2xs uppercase tracking-wider text-text-muted mb-1">Skill</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Director skill">
            {([
              { id: 'music_video' as const, label: 'Music Video', desc: 'Automated music video from audio', Icon: Music },
              { id: 'short_film' as const, label: 'Short Film', desc: 'Dialogue-driven scenes from audio', Icon: Film },
            ]).map(({ id, label, desc, Icon }) => {
              const active = (safeValue.director_skill || 'music_video') === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={desc}
                  disabled={disabled}
                  onClick={() => update({ director_skill: id })}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    active
                      ? 'border-accent-blue/60 bg-accent-blue/5'
                      : 'border-border hover:border-border-light'
                  }`}
                >
                  <Icon size={15} className={active ? 'text-accent-blue shrink-0' : 'text-text-muted shrink-0'} />
                  <span className="text-xs font-medium text-text-primary truncate">{label}</span>
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      {/* Output — aspect + resolution. Always visible because every
          project needs a render format and "use whatever was last"
          is the worst possible default for a fresh project. */}
      <fieldset className={sectionCls} aria-label="Output format">
        <legend className="text-2xs uppercase tracking-wider text-text-muted mb-1">Output format</legend>
        <div className="flex gap-2">
          <div className="flex-1">
            <FormSelect
              label="Aspect ratio"
              value={safeValue.aspect_ratio || ''}
              onChange={next => update({ aspect_ratio: next as AspectRatio })}
              options={aspectOptions.map(opt => ({ value: opt.value, label: `${opt.label} — ${opt.desc}` }))}
              disabled={disabled}
            />
          </div>
          <div className="flex-1">
            <FormSelect
              label="Resolution"
              value={safeValue.resolution || ''}
              onChange={next => update({ resolution: next as ResolutionPreset })}
              options={PROJECT_SETUP_RESOLUTIONS.map(opt => ({ value: opt.value, label: opt.label }))}
              disabled={disabled}
            />
          </div>
        </div>
      </fieldset>

      {/* Workflow — Seamless (one continuous timeline across windows)
          and Auto (skip every review step). Both default to off so the
          Director always opens with manual review unless the project
          creator opted in. */}
      <fieldset className={sectionCls} aria-label="Workflow defaults">
        <legend className="text-2xs uppercase tracking-wider text-text-muted mb-1">Workflow</legend>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(safeValue.seamless)}
            disabled={disabled}
            onClick={() => update({ seamless: !safeValue.seamless })}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left select-none transition-all ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${safeValue.seamless ? 'border-accent-blue/60 bg-accent-blue/5' : 'border-border hover:border-border-light'}`}
          >
            <span className="min-w-0">
              <span className="text-xs text-text-secondary block leading-tight">Seamless</span>
              <span className="text-2xs text-text-muted block leading-tight truncate">continuous sliding window</span>
            </span>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(safeValue.auto_mode)}
            disabled={disabled}
            onClick={() => update({ auto_mode: !safeValue.auto_mode })}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left select-none transition-all ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${safeValue.auto_mode ? 'border-accent-blue/60 bg-accent-blue/5' : 'border-border hover:border-border-light'}`}
          >
            <span className="min-w-0">
              <span className="text-xs text-text-secondary block leading-tight">Auto</span>
              <span className="text-2xs text-text-muted block leading-tight truncate">skip review steps</span>
            </span>
          </button>
        </div>
      </fieldset>

      {/* About — optional metadata shown on the project card. */}
      <fieldset className={sectionCls} aria-label="About this project">
        <legend className="text-2xs uppercase tracking-wider text-text-muted mb-1">About</legend>
        <div className="grid grid-cols-2 gap-2 items-start">
          <label className="block min-w-0">
            <span className="text-xs text-text-secondary block mb-1">Description</span>
            <input
              type="text"
              value={safeValue.description || ''}
              onChange={e => update({ description: e.target.value })}
              disabled={disabled}
              placeholder="What is this project about?"
              className="w-full rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-accent-blue"
            />
          </label>
          <label className="block min-w-0">
            <span className="text-xs text-text-secondary block mb-1">Tags</span>
            <input
              type="text"
              value={(safeValue.tags || []).join(', ')}
              onChange={e => update({ tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
              disabled={disabled}
              placeholder="film, draft, reel"
              className="w-full rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-accent-blue"
            />
          </label>
        </div>
      </fieldset>
    </div>
  )
}

function FormSelect({
  label, value, onChange, options, disabled, inline,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  disabled?: boolean
  /** When true, the label sits on the same row as the select
   *  (label + select in a flex row, label keeps a fixed width) —
   *  used by the tight Output format row where "Aspect ratio" and
   *  "Resolution" share two columns side-by-side. Long labels in
   *  narrow columns (model pickers) stay stacked by default. */
  inline?: boolean
}) {
  return (
    <label className={inline ? 'flex items-center gap-2 min-w-0' : 'block'}>
      <span className={inline ? 'text-xs text-text-secondary shrink-0' : 'text-xs text-text-secondary block mb-1'}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={`${inline ? 'flex-1 min-w-0' : 'w-full'} rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-accent-blue`}
      >
        {options.map(opt => (
          <option key={opt.value || 'blank'} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  )
}

/** Compact summary used in the Project card chip ("Music Video · 16:9 · 720p · LTX-2"). */
export function ProjectSetupSummary({
  setup, videoModelLabel, imageModelLabel,
}: {
  setup?: ProjectSetupDefaults
  videoModelLabel?: string
  imageModelLabel?: string
}): string {
  if (!setup) return 'Default settings'
  const parts: string[] = []
  const skillLabel = setup.director_skill === 'short_film' ? 'Short Film'
    : setup.director_skill === 'music_video' ? 'Music Video' : undefined
  if (skillLabel) parts.push(skillLabel)
  if (setup.aspect_ratio) parts.push(setup.aspect_ratio)
  if (setup.resolution) parts.push(setup.resolution)
  if (setup.video_model) parts.push(videoModelLabel || shortModelLabel(setup.video_model))
  if (setup.image_model && !parts.includes(videoModelLabel || '') && setup.image_model !== setup.video_model) {
    parts.push(imageModelLabel || shortModelLabel(setup.image_model))
  }
  return parts.length ? parts.join(' · ') : 'Default settings'
}

/** Friendly model name from the catalog id ("ltx2_22B_distilled_1_1" → "LTX-2 Distilled"). */
export function shortModelLabel(modelType: string): string {
  if (!modelType) return ''
  return modelType
    .replace(/_/g, ' ')
    .replace(/\s+\d+\s*$/, '')
    .split(' ')
    .filter(Boolean)
    .map(part => part.match(/^[a-z]+$/i) ? part.toUpperCase() : part)
    .slice(0, 4)
    .join(' ')
}

/** Re-export GenerationMode typing helper to keep the imports next to the form. */
export type { GenerationMode }
