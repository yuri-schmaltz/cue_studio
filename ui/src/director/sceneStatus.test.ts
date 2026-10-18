// Tests for the per-scene status derivations (feature A12).

import { describe, expect, it } from 'vitest'

import type { DirectorImageGenProgress } from '../types'
import { deriveImageSceneStatus, deriveVideoSceneStatus } from './sceneStatus'

const progress = (
  overrides: Partial<DirectorImageGenProgress> = {},
): DirectorImageGenProgress => ({
  current: 0,
  total: 3,
  currentClipLabel: '',
  status: 'generating',
  ...overrides,
})

describe('deriveImageSceneStatus', () => {
  const base = { index: 1, hasImage: false, regenerating: false, progress: null }

  it('is pending with no image and no run', () => {
    expect(deriveImageSceneStatus(base)).toBe('pending')
  })

  it('is generating while the per-clip spinner overrides everything', () => {
    expect(
      deriveImageSceneStatus({ ...base, regenerating: true, hasImage: true }),
    ).toBe('generating')
  })

  it('is ready once the start image exists', () => {
    expect(deriveImageSceneStatus({ ...base, hasImage: true })).toBe('ready')
  })

  it('is failed when the error is stamped on this clip index', () => {
    expect(
      deriveImageSceneStatus({
        ...base,
        progress: progress({ status: 'error', failed_clip_index: 1, current: 0 }),
      }),
    ).toBe('failed')
  })

  it('falls back to the failing current index when no clip index was stamped', () => {
    expect(
      deriveImageSceneStatus({
        ...base,
        progress: progress({ status: 'error', current: 1 }),
      }),
    ).toBe('failed')
  })

  it('ignores an error stamped on a different clip', () => {
    expect(
      deriveImageSceneStatus({
        ...base,
        progress: progress({ status: 'error', failed_clip_index: 2, current: 2 }),
      }),
    ).toBe('pending')
  })

  it('is generating while the run is on this clip', () => {
    expect(
      deriveImageSceneStatus({
        ...base,
        progress: progress({ current: 1, status: 'generating' }),
      }),
    ).toBe('generating')
  })

  it('stays pending when the run finished on another clip', () => {
    expect(
      deriveImageSceneStatus({
        ...base,
        progress: progress({ current: 1, status: 'done' }),
      }),
    ).toBe('pending')
  })
})

describe('deriveVideoSceneStatus', () => {
  const base = {
    index: 1,
    hasStartImage: false,
    regenerating: false,
    pipelineFailed: false,
    pipelineRunning: false,
    currentClip: null,
    failedClipIndex: null,
  }

  it('is pending with no signal at all', () => {
    expect(deriveVideoSceneStatus(base)).toBe('pending')
  })

  it('is generating while the per-clip re-roll spinner runs', () => {
    expect(deriveVideoSceneStatus({ ...base, regenerating: true })).toBe('generating')
  })

  it('is failed for the clip the pipeline stopped on', () => {
    expect(
      deriveVideoSceneStatus({
        ...base,
        pipelineFailed: true,
        currentClip: 2,
        failedClipIndex: 1,
      }),
    ).toBe('failed')
  })

  it('does not fail other clips while the pipeline is failed', () => {
    expect(
      deriveVideoSceneStatus({
        ...base,
        index: 0, // clip 1 — the failure happened on clip 2 (index 1)
        hasStartImage: true,
        pipelineFailed: true,
        currentClip: 2,
        failedClipIndex: 1,
      }),
    ).toBe('ready')
  })

  it('is ready once the start image exists', () => {
    expect(deriveVideoSceneStatus({ ...base, hasStartImage: true })).toBe('ready')
  })

  it('is generating while the pipeline renders this clip', () => {
    expect(
      deriveVideoSceneStatus({
        ...base,
        pipelineRunning: true,
        currentClip: 2,
      }),
    ).toBe('generating')
  })

  it('keeps other clips pending while the pipeline renders clip 1', () => {
    expect(
      deriveVideoSceneStatus({
        ...base,
        pipelineRunning: true,
        currentClip: 1,
      }),
    ).toBe('pending')
  })
})
