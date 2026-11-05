/**
 * Regression tests for the speaker photo reaching the Director pipeline.
 *
 * A speaker photo is picked in the browser and uploaded immediately, so
 * its server path is already known and it survives a reload (where the
 * in-memory `File` is gone). The planning path used to key on the
 * `File` instead of the path, which silently dropped every reference
 * restored from a draft — the photo was visible in the UI and never
 * reached the LLM as a character reference.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDirectorPlanningSlice } from './directorPlanningSlice'
import * as api from '../api/client'

describe('director speaker reference upload', () => {
  let state: Record<string, any>
  let set: any
  let get: any
  let mockDeps: any
  let uploadSpy: any
  // Filled in right after each slice is created, so get() can see the
  // slice's own actions the way the real store does.
  const sliceRef: { current: Record<string, any> } = { current: {} }

  beforeEach(() => {
    vi.restoreAllMocks()
    state = {
      directorMusicSource: null,
      directorMusicModel: 'ace_step',
      directorSongDescription: '',
      directorSongInstrumental: false,
      directorSongStyle: '',
      directorSongLyrics: '',
      directorSongDuration: 120,
      directorStep: 'style',
      directorClipPlans: [],
      directorPlannedClips: [],
      directorCharacterRefs: [],
      directorCharacterRefPaths: [],
      directorCharacterRefLabels: [],
      directorLocationRefs: [],
      directorLocationRefPaths: [],
      directorLocationRefLabels: [],
      directorSpeakerMappings: [],
      directorAnalysis: { bpm: 120, beats: [] },
      directorSceneDescription: 'a scene',
      directorTechnicalPrompt: '',
      directorEnergyBias: 0,
      directorReferenceImage: null,
      directorReferenceImagePath: null,
      directorAutoMode: false,
      directorSkill: 'music_video',
      directorUsesGeneratedShotImages: false,
      servicesConfig: { use_director_v2: false },
      params: {},
    }
    set = vi.fn((patch: any) => {
      const next = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...next }
    })
    // The slice reaches its own helpers through get(), the same way the
    // real store does. `sliceRef` is filled in right after the slice is
    // created, so the getter always sees the slice's actions.
    get = vi.fn(() => ({ ...state, ...sliceRef.current }))

    uploadSpy = vi.spyOn(api, 'uploadImage').mockResolvedValue({
      filename: 'x.jpeg', path: '/uploads/x.jpeg', url: '/api/v1/uploads/x.jpeg',
    } as never)
    vi.spyOn(api, 'planClipPromptsAndImages').mockResolvedValue({
      clip_plans: [{ video_prompt: 'v', image_prompt: 'i' }],
    } as never)

    mockDeps = {
      startDirectLlmStreamPolling: vi.fn(() => vi.fn()),
      directorUsesGeneratedShotImages: vi.fn(() => false),
      resolveResolution: vi.fn(() => '1280x720'),
      normalizeH3ClipFrameSchedule: vi.fn((frames: number[]) => frames),
      getAnalysisSequence: () => 0,
      bumpAnalysisSequence: () => 1,
      getAnalyzeController: () => null,
      setAnalyzeController: () => {},
      getAnalyzeStopPoll: () => null,
      setAnalyzeStopPoll: () => {},
      getTrackGenSequence: () => 0,
      bumpTrackGenSequence: () => 1,
      getTrackGenPoll: () => null,
      setTrackGenPoll: () => {},
      getTrackGenController: () => null,
      setTrackGenController: () => {},
      getImageGenSequence: () => 0,
      bumpImageGenSequence: () => 1,
      getImageGenJob: () => null,
      setImageGenJob: () => {},
      getImageGenPoll: () => null,
      setImageGenPoll: () => {},
      getV2PlanController: () => null,
      setV2PlanController: () => {},
      bumpPipelineAttachToken: vi.fn(() => 1),
      getNegativePromptDebounce: () => null,
      setNegativePromptDebounce: () => {},
    }
  })

  it('reuses the known server path instead of re-uploading the photo', async () => {
    state.directorSpeakerMappings = [
      { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing', imagePath: '/uploads/gary.jpeg' },
    ]
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    const result = await (slice as any)._uploadDirectorRefs()

    expect(result.speakerImagePaths['SPEAKER_00']).toBe('/uploads/gary.jpeg')
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  it('still uploads a photo that has no server path yet', async () => {
    const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' })
    state.directorSpeakerMappings = [
      { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing', image: file },
    ]
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    const result = await (slice as any)._uploadDirectorRefs()

    expect(uploadSpy).toHaveBeenCalledWith(file)
    expect(result.speakerImagePaths['SPEAKER_00']).toBe('/uploads/x.jpeg')
  })

  it('sends the speaker photo as a character reference after a reload', async () => {
    // A restored mapping: the server path survives, the File does not.
    state.directorPlannedClips = [{ start: 0, end: 10, duration_frames: 10 }]
    state.directorSpeakerMappings = [
      { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing', imagePath: '/uploads/gary.jpeg' },
    ]
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)
    sliceRef.current = slice as never

    await slice.directorPlanPrompts()

    const call = (api.planClipPromptsAndImages as any).mock.calls[0]
    expect(call[0].character_ref_paths).toContain('/uploads/gary.jpeg')
    expect(call[0].character_ref_labels).toContain('gary')
  })

  it('does not duplicate a photo that is already a character reference', async () => {
    state.directorPlannedClips = [{ start: 0, end: 10, duration_frames: 10 }]
    state.directorCharacterRefPaths = ['/uploads/gary.jpeg']
    state.directorCharacterRefLabels = ['gary']
    state.directorSpeakerMappings = [
      { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing', imagePath: '/uploads/gary.jpeg' },
    ]
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)
    sliceRef.current = slice as never

    await slice.directorPlanPrompts()

    const call = (api.planClipPromptsAndImages as any).mock.calls[0]
    const paths = call[0].character_ref_paths as string[]
    expect(paths.filter(p => p === '/uploads/gary.jpeg')).toHaveLength(1)
  })
})
