/* eslint-disable react-refresh/only-export-components -- shared options between
   ProjectSetup form chips and the Director right-column override live here
   so the two surfaces stay in lockstep. */
import { useEffect, useState } from 'react'
import { Film, Music } from 'lucide-react'
import type { ProjectSetupDefaults, AspectRatio, ResolutionPreset, GenerationMode } from '../../types'
import { DEFAULT_PROJECT_SETUP } from '../../types'
import { fetchModels, type ApiModel } from '../../api/client'
import { NsfwToggle } from '../NSFW/NsfwToggle'

/** Speed/quality tier shown as a text suffix in the model pickers
 *  ("LTX-2 22B Distilled · Fastest"). Native <select> options can't
 *  carry badges or colors, so the classification lives in the label.
 *
 *  Heuristic from naming signals only — the catalog exposes no
 *  measured benchmarks. Fast variants name themselves (distilled,
 *  turbo, schnell, lightning, lite, klein-4B, 1.3B-class); quality
 *  variants too (dev, pro, max, ultra, radiance, XL/full, 14B+).
 *  Anything else is Balanced. Fastest wins ties (a "14B turbo" is
 *  still built for speed). */
export type ModelSpeedTier = 'Fastest' | 'Balanced' | 'Best quality'

const FAST_MODEL_RE = /(distill|turbo|schnell|lightning|flash|hyper|lite|klein[_-]?4b|(^|[\s_.-])1[._]3b\b|_1b\b)/
const QUALITY_MODEL_RE = /(^|[\s_.-])(dev|pro|max|ultra|radiance|xl|full)(?=[\s_.-]|$)|(^|[\s_.-])(1[49]|19|20|22|25)b\b/

export function modelSpeedTier(model: ApiModel): ModelSpeedTier {
  const haystack = `${model.name || ''} ${model.model_type || ''} ${model.architecture || ''}`.toLowerCase()
  if (FAST_MODEL_RE.test(haystack)) return 'Fastest'
  if (QUALITY_MODEL_RE.test(haystack)) return 'Best quality'
  return 'Balanced'
}

/** Audio-only models (TTS / voice / music generators). They get their
 *  own picker bound to `music_model` instead of polluting the video /
 *  image lists — verified against the live catalog (ACE-Step, Chatterbox,
 *  IndexTTS, Qwen3-TTS, MiniMax-Music, DramaBox/Scenema/Kugel audio…).
 *  Talking-head *video* models (Ditto, Fantasy Talking) don't match. */
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

/** One-click starting setups for the New project dialog. Each template
 *  pins format AND skill together so picking "Short film" can't leave
 *  the project on the Music Video skill by accident. Model/advanced
 *  choices stay per-project because they depend on the installed
 *  catalog. */
export const PROJECT_SETUP_TEMPLATES: ReadonlyArray<{ value: string; label: string; desc: string; setup: Partial<ProjectSetupDefaults> }> = [
  { value: 'short-film', label: 'Short film', desc: '16:9 · 720p', setup: { aspect_ratio: '16:9', resolution: '720p', director_skill: 'short_film' } },
  { value: 'reels', label: 'Reels', desc: '9:16 · 1080p', setup: { aspect_ratio: '9:16', resolution: '1080p', director_skill: 'music_video' } },
  { value: 'cinema', label: 'Cinema', desc: '21:9 · 1080p', setup: { aspect_ratio: '21:9', resolution: '1080p', director_skill: 'music_video' } },
  { value: 'square', label: 'Square', desc: '1:1 · 1080p', setup: { aspect_ratio: '1:1', resolution: '1080p', director_skill: 'music_video' } },
]

export interface ProjectSetupFormProps {
  value: ProjectSetupDefaults
  onChange: (next: ProjectSetupDefaults) => void
  disabled?: boolean
  /** Render compact version (less spacing) — used inside the small
   *  Edit setup modal so it fits next to other controls. */
  compact?: boolean
  /** Current Studio model selection per kind, used to name the
   *  effective default in "Use last selected (LTX-2 22B)". Optional —
   *  without it the option shows the plain label. */
  studioModels?: { video?: string; image?: string; audio?: string }
}

/**
 * ProjectSetupForm — reusable fields editor for project-level choices.
 *
 * Used by both the New project dialog (ProjectsPage) and the per-card
 * Edit setup affordance. Each section is collapsible; defaults stay
 * open so the user sees the model pickers without having to expand
 * every group. Every change flows through `onChange` so the parent can
 * own the submit / persist logic (keep the source of truth in one
 * place — the form is a pure controlled component).
 */
export function ProjectSetupForm({
  value,
  onChange,
  disabled = false,
  compact = false,
  studioModels,
}: ProjectSetupFormProps) {
  const safeValue: ProjectSetupDefaults = { ...DEFAULT_PROJECT_SETUP, ...value }
  const [models, setModels] = useState<ApiModel[]>([])
  const update = (patch: Partial<ProjectSetupDefaults>) => onChange({ ...safeValue, ...patch })

  useEffect(() => {
    let cancelled = false
    fetchModels()
      .then(data => {
        if (!cancelled) setModels(data.models || [])
      })
      .catch(() => { if (!cancelled) setModels([]) })
    return () => { cancelled = true }
  }, [])

  const supportsUltraWide = (safeValue.video_model || '').toLowerCase().startsWith('minimax_h3')
  const aspectOptions = PROJECT_SETUP_ASPECT_RATIOS.filter(opt => opt.value !== '21:9' || supportsUltraWide)

  // Video/image pickers list the full installed catalog minus
  // audio-only models (those get their own picker below), each tagged
  // with its speed tier. Empty string means "use whatever the Studio
  // already has", which lets the form stay usable when the model
  // catalog isn't loaded yet (offline / first paint).
  const deduped = [...models]
    .filter((m, i, arr) => arr.findIndex(o => o.model_type === m.model_type) === i)
    .sort((a, b) => (a.name || a.model_type).localeCompare(b.name || b.model_type))
  const withTier = (m: ApiModel) => ({ value: m.model_type, label: `${m.name || m.model_type} · ${modelSpeedTier(m)}` })
  const lastSelectedLabel = (current?: string) =>
    current ? `Use last selected (${shortModelLabel(current)})` : 'Use last selected'
  const visualList = deduped.filter(m => !isAudioModel(m)).map(withTier)
  const modelOptions = [{ value: '', label: lastSelectedLabel(studioModels?.video) }, ...visualList]
  const imageModelOptions = [{ value: '', label: lastSelectedLabel(studioModels?.image) }, ...visualList]
  const audioModelOptions = [
    { value: '', label: lastSelectedLabel(studioModels?.audio) },
    ...deduped.filter(isAudioModel).map(withTier),
  ]

  const sectionCls = compact ? 'space-y-1.5' : 'space-y-2'

  return (
    <div className={`text-sm ${compact ? 'space-y-2.5' : 'space-y-3'}`}>
      {/* Skill — which Director workflow this project plans with.
          Chosen once here so the Director chat never asks again;
          changing it later re-syncs the Director through
          applyWorkspaceSetup. */}
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
          <label className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 select-none transition-all ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${safeValue.seamless ? 'border-accent-blue/60 bg-accent-blue/5' : 'border-border hover:border-border-light'}`}>
            <input
              type="checkbox"
              checked={Boolean(safeValue.seamless)}
              disabled={disabled}
              onChange={e => update({ seamless: e.target.checked })}
              className="accent-accent-blue w-3 h-3 shrink-0"
            />
            <span className="min-w-0">
              <span className="text-xs text-text-secondary block leading-tight">Seamless</span>
              <span className="text-2xs text-text-muted block leading-tight truncate">continuous sliding window</span>
            </span>
          </label>
          <label className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 select-none transition-all ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${safeValue.auto_mode ? 'border-accent-blue/60 bg-accent-blue/5' : 'border-border hover:border-border-light'}`}>
            <input
              type="checkbox"
              checked={Boolean(safeValue.auto_mode)}
              disabled={disabled}
              onChange={e => update({ auto_mode: e.target.checked })}
              className="accent-accent-blue w-3 h-3 shrink-0"
            />
            <span className="min-w-0">
              <span className="text-xs text-text-secondary block leading-tight">Auto</span>
              <span className="text-2xs text-text-muted block leading-tight truncate">skip review steps</span>
            </span>
          </label>
        </div>
      </fieldset>

      {/* Models — picked once at project creation so every take
          starts from a known baseline. Video/image share the full
          non-audio catalog; audio-only models (TTS/voice/music) get
          their own picker bound to `music_model`, which the Director
          already consumes for track generation. Empty string means
          "use whatever the Studio already has", which lets the form
          stay usable when the model catalog isn't loaded yet
          (offline / first paint). */}
      {/* Advanced defaults (models + about) start collapsed so the New
          project dialog fits without scrolling — one click expands. */}
      <details className="rounded-lg border border-border/60">
        <summary className="cursor-pointer select-none px-2.5 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors">
          Advanced defaults
        </summary>
        <div className="px-2.5 pb-2.5 space-y-3">
      {/* NSFW toggle — moved here from the Integrations drawer so
          users opt in to adult content generation at the moment
          they're creating the project that will actually need it.
          Lives inside Advanced defaults (collapsed by default) to
          keep the visible top of the form focused on skill + format
          + workflow + models. The toggle binds to the global
          ``servicesConfig.nsfw_mode`` flag, so LoRAs / model
          selectors / the LLM prompt start honoring the new value the
          moment it's flipped on — no extra wiring required. The
          ``disabled`` prop is forwarded so the Edit modal can lock
          the whole form (Edit doesn't change NSFW state). */}
      <fieldset className={sectionCls} aria-label="Content mode">
        <legend className="text-2xs uppercase tracking-wider text-text-muted mb-1">Content mode</legend>
        <NsfwToggle disabled={disabled} />
      </fieldset>

      <fieldset className={sectionCls} aria-label="Default models">
        <legend className="text-2xs uppercase tracking-wider text-text-muted mb-1">Models</legend>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <FormSelect
              label="Video model"
              value={safeValue.video_model || ''}
              onChange={next => update({ video_model: next })}
              options={modelOptions}
              disabled={disabled}
            />
          </div>
          <div className="flex-1 min-w-0">
            <FormSelect
              label="Image model"
              value={safeValue.image_model || ''}
              onChange={next => update({ image_model: next })}
              options={imageModelOptions}
              disabled={disabled}
            />
          </div>
          <div className="flex-1 min-w-0">
            <FormSelect
              label="Audio model"
              value={safeValue.music_model || ''}
              onChange={next => update({ music_model: next })}
              options={audioModelOptions}
              disabled={disabled}
            />
          </div>
        </div>
      </fieldset>

      {/* About — optional metadata shown on the project card. Kept at
          the bottom so the technical defaults stay the focus. */}
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
      </details>
    </div>
  )
}

function FormSelect({
  label, value, onChange, options, disabled,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs text-text-secondary block mb-1">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-accent-blue"
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
