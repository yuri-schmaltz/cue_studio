/* eslint-disable react-refresh/only-export-components -- shared options between
   ProjectSetup form chips and the Director right-column override live here
   so the two surfaces stay in lockstep. */
import { useEffect, useState } from 'react'
import { Film, Music } from 'lucide-react'
import type { ProjectSetupDefaults, AspectRatio, ResolutionPreset, GenerationMode } from '../../types'
import { DEFAULT_PROJECT_SETUP } from '../../types'
import { fetchModels, type ApiModel } from '../../api/client'
import { NsfwToggle } from '../NSFW/NsfwToggle'

/** Curated models registry for clean, noise-free project selection with meaningful labels */
export interface CuratedModelInfo {
  name: string
  badge: string
  category: 'video' | 'image' | 'audio'
}

export const CURATED_MODELS: Record<string, CuratedModelInfo> = {
  // === VIDEO ===
  'scail2_14B': { name: 'SCAIL-2 14B', badge: 'Top Qualidade · 14B', category: 'video' },
  'scail2_14B_fast': { name: 'SCAIL-2 14B Fast', badge: 'Equilibrado · Rápido', category: 'video' },
  'ltx2_25': { name: 'LTX-2.5 Distilled', badge: 'Mais Rápido · 4-step', category: 'video' },
  'ltx2_25_dev': { name: 'LTX-2.5 Dev', badge: 'Alta Fidelidade · 22B', category: 'video' },
  'ltx2_22B_distilled_1_1': { name: 'LTX-2.3 Distilled 1.1', badge: 'Equilibrado · Fluido', category: 'video' },
  'ltx2_22B': { name: 'LTX-2.3 Dev 22B', badge: 'Alta Qualidade · 22B', category: 'video' },
  'minimax_h3': { name: 'MiniMax H3 First/Last', badge: 'Top Cenas Longas', category: 'video' },
  'minimax_h3_ref2va': { name: 'MiniMax H3 Omni', badge: 'Consistência de Personagem', category: 'video' },
  'ovi_1_1': { name: 'Wan 2.2 Ovi 10B', badge: 'Alta Dinâmica · 10B', category: 'video' },
  't2v_2_2': { name: 'Wan 2.2 14B', badge: 'Top Qualidade · Cinema', category: 'video' },
  't2v_1.3B': { name: 'Wan 2.1 1.3B', badge: 'Super Leve · Rápido', category: 'video' },
  'vace_ditto_14B': { name: 'Ditto 14B', badge: 'Especializado: Lip-Sync', category: 'video' },
  'fantasy': { name: 'Fantasy Talking 14B', badge: 'Especializado: Lip-Sync', category: 'video' },

  // === IMAGE ===
  'flux2_dev': { name: 'Flux 2 Dev 32B', badge: 'Top Qualidade Absoluta', category: 'image' },
  'flux': { name: 'Flux 1 Dev 12B', badge: 'Padrão Ouro · LoRAs', category: 'image' },
  'flux2_klein_9b': { name: 'Flux 2 Klein 9B', badge: 'Mais Equilibrado · 9B', category: 'image' },
  'flux2_klein_4b': { name: 'Flux 2 Klein 4B', badge: 'Super Rápido · 4B', category: 'image' },
  'flux_chroma_radiance': { name: 'Flux 1 Radiance 8.9B', badge: 'Cores Cinematográficas', category: 'image' },
  'krea2_raw': { name: 'Krea 2 RAW', badge: 'Fotorrealismo & Textura', category: 'image' },
  'krea2_turbo': { name: 'Krea 2 Turbo', badge: 'Rápido & Criativo', category: 'image' },
  'qwen_image_20B': { name: 'Qwen Image 20B', badge: 'Prompt Rico · 20B', category: 'image' },
  'qwen_image_edit_20B': { name: 'Qwen Image Edit 20B', badge: 'Edição & Inpainting', category: 'image' },
  'z_image': { name: 'Z-Image Turbo 6B', badge: 'Leve & Rápido · 6B', category: 'image' },

  // === AUDIO ===
  'minimax_music3': { name: 'MiniMax-Music3', badge: 'Música: Top Arranjo & Vocal', category: 'audio' },
  'ace_step_v1_5_xl_sft': { name: 'ACE-Step v1.5 XL 4B', badge: 'Música: Alta Fidelidade', category: 'audio' },
  'ace_step_v1_5': { name: 'ACE-Step v1.5 Turbo 2B', badge: 'Música: Rápido & Batidas', category: 'audio' },
  'kugelaudio_0_open': { name: 'KugelAudio 0 Open 7B', badge: 'Voz: Top Expressão & Fala', category: 'audio' },
  'chatterbox': { name: 'Chatterbox Multilingual', badge: 'Voz: Multilíngue', category: 'audio' },
  'qwen3_tts_base': { name: 'Qwen3 TTS 1.7B', badge: 'Voz: Leve & Rápido', category: 'audio' },
  'dramabox_audio': { name: 'DramaBox Audio', badge: 'Efeitos & Ambiência', category: 'audio' },
}

export type ModelSpeedTier = 'Fastest' | 'Balanced' | 'Best quality'

const FAST_MODEL_RE = /(distill|turbo|schnell|lightning|flash|hyper|lite|klein[_-]?4b|(^|[\s_.-])1[._]3b\b|_1b\b)/
const QUALITY_MODEL_RE = /(^|[\s_.-])(dev|pro|max|ultra|radiance|xl|full)(?=[\s_.-]|$)|(^|[\s_.-])(1[49]|19|20|22|25)b\b/

export function modelSpeedTier(model: ApiModel): string {
  const curated = CURATED_MODELS[model.model_type]
  if (curated) return curated.badge
  const haystack = `${model.name || ''} ${model.model_type || ''} ${model.architecture || ''}`.toLowerCase()
  if (FAST_MODEL_RE.test(haystack)) return 'Rápido'
  if (QUALITY_MODEL_RE.test(haystack)) return 'Alta Qualidade'
  return 'Equilibrado'
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
  hideSkill = false,
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

  const isCuratedVideo = (m: ApiModel) => CURATED_MODELS[m.model_type]?.category === 'video'
  const isCuratedImage = (m: ApiModel) => CURATED_MODELS[m.model_type]?.category === 'image'

  const toOption = (m: ApiModel) => {
    const curated = CURATED_MODELS[m.model_type]
    const label = curated ? `${curated.name} · ${curated.badge}` : `${m.name || m.model_type} · ${modelSpeedTier(m)}`
    return { value: m.model_type, label }
  }

  const lastSelectedLabel = (current?: string) =>
    current ? `Use last selected (${shortModelLabel(current)})` : 'Use last selected'

  // Curated models in stable curated order + any currently selected model that may not be in curated
  const curatedVideoList = Object.keys(CURATED_MODELS)
    .filter(k => CURATED_MODELS[k].category === 'video')
    .map(k => models.find(m => m.model_type === k))
    .filter((m): m is ApiModel => Boolean(m))
    .map(toOption)

  const curatedImageList = Object.keys(CURATED_MODELS)
    .filter(k => CURATED_MODELS[k].category === 'image')
    .map(k => models.find(m => m.model_type === k))
    .filter((m): m is ApiModel => Boolean(m))
    .map(toOption)

  const curatedAudioList = Object.keys(CURATED_MODELS)
    .filter(k => CURATED_MODELS[k].category === 'audio')
    .map(k => models.find(m => m.model_type === k))
    .filter((m): m is ApiModel => Boolean(m))
    .map(toOption)

  // Fallback to full list if models haven't loaded or curated returns empty
  const rawVideo = models.filter(m => !isAudioModel(m) && !isCuratedImage(m)).map(toOption)
  const rawImage = models.filter(m => !isAudioModel(m) && !isCuratedVideo(m)).map(toOption)
  const rawAudio = models.filter(isAudioModel).map(toOption)

  const videoOptions = [
    { value: '', label: lastSelectedLabel(studioModels?.video) },
    ...(curatedVideoList.length ? curatedVideoList : rawVideo),
  ]
  const imageOptions = [
    { value: '', label: lastSelectedLabel(studioModels?.image) },
    ...(curatedImageList.length ? curatedImageList : rawImage),
  ]
  const audioOptions = [
    { value: '', label: lastSelectedLabel(studioModels?.audio) },
    ...(curatedAudioList.length ? curatedAudioList : rawAudio),
  ]

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

      {/* Models — picked once at project creation so every take
          starts from a known baseline. Video/image share the full
          non-audio catalog; audio-only models (TTS/voice/music) get
          their own picker bound to `music_model`, which the Director
          (offline / first paint). */}

      {/* Advanced options (content mode, models, about) */}
      <div className="rounded-lg border border-border/60 p-2.5 space-y-3">
        {/* NSFW toggle — moved here from the Integrations drawer so
            users opt in to adult content generation at the moment
            they're creating the project that will actually need it.
            The toggle binds to the global ``servicesConfig.nsfw_mode``
            flag, so LoRAs / model selectors / the LLM prompt start
            honoring the new value the moment it's flipped on. */}
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
                options={videoOptions}
                disabled={disabled}
              />
            </div>
            <div className="flex-1 min-w-0">
              <FormSelect
                label="Image model"
                value={safeValue.image_model || ''}
                onChange={next => update({ image_model: next })}
                options={imageOptions}
                disabled={disabled}
              />
            </div>
            <div className="flex-1 min-w-0">
              <FormSelect
                label="Audio model"
                value={safeValue.music_model || ''}
                onChange={next => update({ music_model: next })}
                options={audioOptions}
                disabled={disabled}
              />
            </div>
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
