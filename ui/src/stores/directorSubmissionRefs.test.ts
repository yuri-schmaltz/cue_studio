/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression tests for the speaker photo in the Director submission.
 *
 * The pipeline receives the speaker photo as a character reference, and
 * the backend matches `character_ref_paths` to `character_ref_labels` by
 * index. The submission used to carry only the explicitly uploaded
 * character refs, so a photo attached to a speaker never reached the
 * renderer — even though the UI showed it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as api from '../api/client'
import { startDirectorPipeline } from './directorSubmission'

describe('director submission — speaker references', () => {
  let state: Record<string, any>
  let set: any
  let get: any
  let startSpy: any

  beforeEach(() => {
    vi.restoreAllMocks()
    startSpy = vi.spyOn(api, 'startPipeline').mockResolvedValue({ pipeline_id: 'p1' } as never)
    vi.spyOn(api, 'enqueueDirectorPipeline').mockResolvedValue({} as never)

    state = {
      directorSkill: 'music_video',
      directorSceneDescription: 'a scene',
      directorAnalysis: { bpm: 120, beats: [] },
      directorPlannedClips: [{ start: 0, end: 10, duration_frames: 10 }],
      directorAudioPath: '/tmp/a.wav',
      directorReferenceImage: null,
      directorReferenceImagePath: null,
      directorCharacterRefs: [],
      directorCharacterRefPaths: [],
      directorCharacterRefLabels: [],
      directorLocationRefs: [],
      directorLocationRefPaths: [],
      directorLocationRefLabels: [],
      directorSpeakerMappings: [
        { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing', imagePath: '/uploads/gary.jpeg' },
      ],
      directorAutoMode: false,
      directorSeamless: false,
      directorShotImageGuidance: 'auto',
      directorResolution: '720p',
      directorAspectRatio: '16:9',
      directorVideoMaxShotFramesByModel: {},
      directorH3TurboModeByModel: {},
      directorH3TurboPresetByModel: {},
      directorH3FirstBlockCacheByModel: {},
      directorH3FirstBlockCacheMultiplierByModel: {},
      directorH3FirstBlockCacheWarmupByModel: {},
      selectedModelPerMode: { video: 'ltx2_22B' },
      savedParamsPerMode: {},
      savedLoraPerMode: {},
      directorImageSpatialUpsampling: false,
      directorImageFilmGrainIntensity: 0,
      directorImageFilmGrainSaturation: 0,
      directorVideoSpatialUpsampling: false,
      directorVideoFilmGrainIntensity: 0,
      directorVideoFilmGrainSaturation: 0,
      directorVideoSelfRefiner: false,
      shortFilmPath: null,
      shortFilmCharacters: [],
      shortFilmTargetDuration: 60,
      shortFilmNarrative: false,
      directorClipPlans: [],
      directorQueueLoading: false,
      directorLoading: false,
      directorError: null,
      directorProjectId: null,
      directorSourcePipelineId: null,
      activeWorkspace: 'test',
      servicesConfig: { llm_model_id: 'llm', llm_device: 'cpu', llm_provider: 'local' },
      llmStatus: { model_id: 'llm', device: 'cpu' },
      directorEnsureStructure: vi.fn(),
      models: [
        { model_type: 'ltx2_22B', director: { supports_voice_reference: false, voice_reference_mode: 'none' } },
        { model_type: 'flux2_klein', director: {} },
      ],
      directorVideoOptions: { frames_steps: 4, frames_minimum: 5 },
      directorMaxShotFrames: 0,
      imageModelDefaults: {},
      matchingImageParams: {},
      videoModelDefaults: {},
      matchingVideoParams: {},
      directorVideoInferenceStepsByModel: {},
      directorDefaultsByModel: {},
    }
    set = vi.fn((patch: any) => {
      const next = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...next }
    })
    get = vi.fn(() => state)
  })

  it('sends the speaker photo as a character reference', async () => {
    await startDirectorPipeline(set, get, 'now', {
      resolveResolution: vi.fn(() => '1280x720'),
      directorModelUsesFixedMediaStrength: vi.fn(() => false),
      onAttach: vi.fn(),
    } as never)

    const params = startSpy.mock.calls[0][0] as Record<string, any>
    expect(params.character_ref_paths).toContain('/uploads/gary.jpeg')
    expect(params.character_ref_labels).toContain('gary')
  })

  it('keeps the labels aligned with the paths', async () => {
    state.directorCharacterRefPaths = ['/uploads/hero.png']
    state.directorCharacterRefLabels = ['Hero']
    state.directorSpeakerMappings = [
      { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing', imagePath: '/uploads/gary.jpeg' },
    ]

    await startDirectorPipeline(set, get, 'now', {
      resolveResolution: vi.fn(() => '1280x720'),
      directorModelUsesFixedMediaStrength: vi.fn(() => false),
      onAttach: vi.fn(),
    } as never)

    const params = startSpy.mock.calls[0][0] as Record<string, any>
    const paths = params.character_ref_paths as string[]
    const labels = params.character_ref_labels as string[]
    expect(paths).toHaveLength(labels.length)
    expect(paths[paths.indexOf('/uploads/gary.jpeg')]).toBe('/uploads/gary.jpeg')
    expect(labels[paths.indexOf('/uploads/gary.jpeg')]).toBe('gary')
    expect(labels[paths.indexOf('/uploads/hero.png')]).toBe('Hero')
  })

  it('does not duplicate a photo that is already a character reference', async () => {
    state.directorCharacterRefPaths = ['/uploads/gary.jpeg']
    state.directorCharacterRefLabels = ['gary']
    state.directorSpeakerMappings = [
      { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing', imagePath: '/uploads/gary.jpeg' },
    ]

    await startDirectorPipeline(set, get, 'now', {
      resolveResolution: vi.fn(() => '1280x720'),
      directorModelUsesFixedMediaStrength: vi.fn(() => false),
      onAttach: vi.fn(),
    } as never)

    const params = startSpy.mock.calls[0][0] as Record<string, any>
    const paths = params.character_ref_paths as string[]
    expect(paths.filter(p => p === '/uploads/gary.jpeg')).toHaveLength(1)
  })

  it('does not invent a reference for a speaker without a photo', async () => {
    state.directorSpeakerMappings = [
      { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing' },
    ]

    await startDirectorPipeline(set, get, 'now', {
      resolveResolution: vi.fn(() => '1280x720'),
      directorModelUsesFixedMediaStrength: vi.fn(() => false),
      onAttach: vi.fn(),
    } as never)

    const params = startSpy.mock.calls[0][0] as Record<string, any>
    expect(params.character_ref_paths).toBeUndefined()
  })
})
