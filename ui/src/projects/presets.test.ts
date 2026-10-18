/**
 * Tests for the project presets module (feature A10).
 */

import { describe, expect, it } from 'vitest'

import {
  applyPreset,
  DEFAULT_PRESETS,
  presetById,
  presetForType,
  presetSummary,
  trackOverrides,
} from './presets'
import { DEFAULT_PROJECT_SETUP } from '../types'
import type { ProjectSetupDefaults } from '../types'

const mvPreset = presetForType('music-video')!
const sfPreset = presetForType('short-film')!

describe('presetForType', () => {
  it('recommends the matching preset per project type', () => {
    expect(presetForType('music-video').id).toBe('mv-default')
    expect(presetForType('short-film').id).toBe('sf-default')
    expect(presetForType('custom').id).toBe('custom-default')
  })

  it('never returns undefined even for an unknown type', () => {
    expect(presetForType('nope' as never)).toBeTruthy()
  })
})

describe('presetById', () => {
  it('resolves known ids and rejects empty/unknown ones', () => {
    expect(presetById('sf-default')?.id).toBe('sf-default')
    expect(presetById('')).toBeUndefined()
    expect(presetById(null)).toBeUndefined()
    expect(presetById('missing')).toBeUndefined()
  })
})

describe('applyPreset', () => {
  it('fills the setup with the preset defaults and records the id', () => {
    const setup = applyPreset(DEFAULT_PROJECT_SETUP, sfPreset)
    expect(setup.director_skill).toBe('short_film')
    expect(setup.aspect_ratio).toBe('16:9')
    expect(setup.resolution).toBe('720p')
    expect(setup.preset_id).toBe('sf-default')
    expect(setup.overrides).toEqual([])
  })

  it('keeps non-preset fields from the base setup', () => {
    const base = { ...DEFAULT_PROJECT_SETUP, description: 'my film', video_model: 'ltx2' }
    const setup = applyPreset(base, mvPreset)
    expect(setup.description).toBe('my film')
    expect(setup.video_model).toBe('ltx2')
  })

  it('lets overrides win over the preset and records them', () => {
    const setup = applyPreset(DEFAULT_PROJECT_SETUP, mvPreset, { resolution: '1080p' })
    expect(setup.resolution).toBe('1080p')
    expect(setup.preset_id).toBe('mv-default')
    expect(setup.overrides).toEqual(['resolution'])
  })

  it('never drops an override that diverges from the preset defaults', () => {
    // Saved override scenario: setup already carries 1080p, preset says 720p.
    const saved = applyPreset(DEFAULT_PROJECT_SETUP, mvPreset, { resolution: '1080p' })
    // Re-applying the preset (e.g. preset list refresh) keeps the override.
    const reapplied = applyPreset(saved, mvPreset)
    expect(reapplied.resolution).toBe('1080p')
    expect(reapplied.overrides).toEqual(['resolution'])
  })

  it('is idempotent when nothing diverges', () => {
    const first = applyPreset(DEFAULT_PROJECT_SETUP, mvPreset)
    const second = applyPreset(first, mvPreset)
    expect(second).toEqual(first)
  })
})

describe('trackOverrides', () => {
  it('lists only fields that diverge from the preset, in stable order', () => {
    const setup: ProjectSetupDefaults = {
      ...DEFAULT_PROJECT_SETUP,
      resolution: '1080p',
      auto_mode: true,
      director_skill: 'music_video',
    }
    expect(trackOverrides(setup, mvPreset)).toEqual(['resolution', 'auto_mode'])
  })

  it('returns an untouched preset as empty', () => {
    expect(trackOverrides(applyPreset(DEFAULT_PROJECT_SETUP, sfPreset), sfPreset)).toEqual([])
  })
})

describe('presetSummary', () => {
  it('renders a compact human summary', () => {
    expect(presetSummary(sfPreset)).toBe('Short Film · 16:9 · 720p · manual')
  })
})

describe('DEFAULT_PRESETS', () => {
  it('covers every project type with at least one recommendation', () => {
    for (const type of ['music-video', 'short-film', 'custom'] as const) {
      expect(DEFAULT_PRESETS.some(p => p.recommendedFor.includes(type))).toBe(true)
    }
  })
})
