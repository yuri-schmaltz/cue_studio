// Project creation presets (feature A10).
//
// Quick creation path: name + type + recommended preset. The preset
// fills the real `ProjectSetupDefaults` fields and the user can expand
// "more options" to override anything before creating.
//
// Adaptation from the spec contract: the spec's preset `defaults`
// (`destination` / `skill` / `format` / `workflow`) don't map 1:1 onto
// this app's setup schema — a project's destination IS its workspace
// folder, and "format" is aspect ratio + resolution. The presets below
// therefore drive the fields that actually exist in `setup.json`:
// `director_skill`, `aspect_ratio`, `resolution`, `seamless`,
// `auto_mode`. The chosen preset id and any overridden field names are
// persisted on the setup itself (`preset_id` + `overrides`) so the
// Edit setup dialog can show them again and a preset update can never
// silently wipe a saved override.

import type { ProjectSetupDefaults, AspectRatio, ResolutionPreset } from '../types'
import { DEFAULT_PROJECT_SETUP } from '../types'
import type { ProjectType } from '../types/projects'

/** Preset defaults expressed over the real setup fields. */
export interface ProjectPresetDefaults {
  skill: ProjectSetupDefaults['director_skill']
  aspect_ratio: AspectRatio
  resolution: ResolutionPreset
  seamless: boolean
  auto_mode: boolean
}

export interface ProjectPreset {
  id: string
  label: string
  recommendedFor: ProjectType[]
  defaults: ProjectPresetDefaults
}

export const DEFAULT_PRESETS: ProjectPreset[] = [
  {
    id: 'mv-default',
    label: 'Music Video — padrão',
    recommendedFor: ['music-video'],
    defaults: { skill: 'music_video', aspect_ratio: '16:9', resolution: '720p', seamless: false, auto_mode: false },
  },
  {
    id: 'sf-default',
    label: 'Short Film — padrão',
    recommendedFor: ['short-film'],
    defaults: { skill: 'short_film', aspect_ratio: '16:9', resolution: '720p', seamless: false, auto_mode: false },
  },
  {
    id: 'custom-default',
    label: 'Custom',
    recommendedFor: ['custom'],
    defaults: { skill: 'music_video', aspect_ratio: '16:9', resolution: '720p', seamless: false, auto_mode: false },
  },
]

/** Setup fields a preset owns — also the fields tracked for overrides. */
export const PRESET_FIELDS = [
  'director_skill',
  'aspect_ratio',
  'resolution',
  'seamless',
  'auto_mode',
] as const

export type PresetField = (typeof PRESET_FIELDS)[number]

/** Recommended preset for a project type (first match, `custom` first
 *  as a safety net so every type resolves to a preset). */
export function presetForType(type: ProjectType): ProjectPreset {
  return DEFAULT_PRESETS.find(p => p.recommendedFor.includes(type))
    ?? DEFAULT_PRESETS.find(p => p.recommendedFor.includes('custom'))
    ?? DEFAULT_PRESETS[0]
}

export function presetById(id: string | null | undefined): ProjectPreset | undefined {
  if (!id) return undefined
  return DEFAULT_PRESETS.find(p => p.id === id)
}

/** Current values of the preset-owned fields on a setup. */
function readPresetFields(setup: ProjectSetupDefaults): Record<PresetField, unknown> {
  return {
    director_skill: setup.director_skill,
    aspect_ratio: setup.aspect_ratio,
    resolution: setup.resolution,
    seamless: setup.seamless,
    auto_mode: setup.auto_mode,
  }
}

/** Preset defaults keyed by the matching setup field name. */
function presetFieldValues(preset: ProjectPreset): Record<PresetField, unknown> {
  return {
    director_skill: preset.defaults.skill,
    aspect_ratio: preset.defaults.aspect_ratio,
    resolution: preset.defaults.resolution,
    seamless: preset.defaults.seamless,
    auto_mode: preset.defaults.auto_mode,
  }
}

/** Names of preset-owned fields on `setup` that diverge from the
 *  preset's defaults. Stable ordering (PRESET_FIELDS order). */
export function trackOverrides(setup: ProjectSetupDefaults, preset: ProjectPreset): PresetField[] {
  const current = readPresetFields(setup)
  const defaults = presetFieldValues(preset)
  return PRESET_FIELDS.filter(field => current[field] !== defaults[field])
}

/**
 * Apply a preset's defaults onto a base setup.
 *
 * - Always starts from `DEFAULT_PROJECT_SETUP` merged with `base` so
 *   non-preset fields (models, description, cover…) are preserved.
 * - Precedence per preset field: explicit `overrides` argument → the
 *   base setup's already-recorded override (never drop a saved
 *   override when the preset is re-applied) → the preset default.
 * - Records `preset_id` and the recomputed `overrides` list on the
 *   returned setup so the choice survives the round-trip through
 *   `setup.json`.
 */
export function applyPreset(
  base: ProjectSetupDefaults,
  preset: ProjectPreset,
  overrides?: Partial<ProjectSetupDefaults>,
): ProjectSetupDefaults {
  const baseRecorded = new Set(
    Array.isArray(base.overrides) ? base.overrides : [],
  ) as Set<string>
  const pick = <K extends PresetField>(field: K, presetValue: ProjectSetupDefaults[K]): ProjectSetupDefaults[K] => {
    if (overrides && overrides[field] !== undefined) return overrides[field] as ProjectSetupDefaults[K]
    if (baseRecorded.has(field) && base[field] !== undefined) return base[field]
    return presetValue
  }
  const merged: ProjectSetupDefaults = {
    ...DEFAULT_PROJECT_SETUP,
    ...base,
    ...overrides,
    director_skill: pick('director_skill', preset.defaults.skill) || 'music_video',
    aspect_ratio: pick('aspect_ratio', preset.defaults.aspect_ratio as ProjectSetupDefaults['aspect_ratio']),
    resolution: pick('resolution', preset.defaults.resolution as ProjectSetupDefaults['resolution']),
    seamless: pick('seamless', preset.defaults.seamless),
    auto_mode: pick('auto_mode', preset.defaults.auto_mode),
  }
  return {
    ...merged,
    preset_id: preset.id,
    overrides: trackOverrides(merged, preset),
  }
}

/** One-line summary of what a preset applies ("16:9 · 720p · manual"). */
export function presetSummary(preset: ProjectPreset): string {
  const { defaults } = preset
  const skill = defaults.skill === 'short_film' ? 'Short Film' : 'Music Video'
  const workflow = defaults.auto_mode ? 'auto' : 'manual'
  return `${skill} · ${defaults.aspect_ratio} · ${defaults.resolution} · ${workflow}`
}
