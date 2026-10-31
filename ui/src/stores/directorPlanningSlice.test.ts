import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDirectorPlanningSlice, DIRECTOR_NEGATIVE_PROMPT_DEBOUNCE_MS } from './directorPlanningSlice'

describe('directorPlanningSlice', () => {
  let state: Record<string, any>
  let set: any
  let get: any
  let mockDeps: any

  beforeEach(() => {
    state = {
      directorMusicSource: null,
      directorMusicModel: 'ace_step',
      directorSongDescription: '',
      directorSongInstrumental: false,
      directorSongStyle: '',
      directorSongLyrics: '',
      directorSongDuration: 120,
      directorStep: 'upload',
      directorClipPlans: [],
      directorPlannedClips: [],
      directorCharacterRefs: [],
      directorCharacterRefPaths: [],
      directorCharacterRefLabels: [],
      directorLocationRefs: [],
      directorLocationRefPaths: [],
      directorLocationRefLabels: [],
      directorSpeakerMappings: [],
      directorAnalysis: null,
      directorEnergyBias: 0,
      params: {},
      selectedModelPerMode: { video: 'test_model' },
      savedParamsPerMode: {},
      savedLoraPerMode: {},
      directorVideoInferenceStepsByModel: {},
    }
    set = vi.fn((patch: any) => {
      const next = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...next }
    })
    get = vi.fn(() => state)

    let analysisSeq = 0
    let trackGenSeq = 0
    let imageGenSeq = 0
    let analyzeCtrl: AbortController | null = null
    let trackCtrl: AbortController | null = null
    let v2PlanCtrl: AbortController | null = null
    let analyzeStop: (() => void) | null = null
    let trackGenPoll: any = null
    let imageGenJob: string | null = null
    let imageGenPoll: any = null
    let debounceTimer: any = null

    mockDeps = {
      startDirectLlmStreamPolling: vi.fn(() => vi.fn()),
      directorUsesGeneratedShotImages: vi.fn(() => false),
      resolveResolution: vi.fn(() => '1280x720'),
      normalizeH3ClipFrameSchedule: vi.fn((frames: number[]) => frames),
      getAnalysisSequence: () => analysisSeq,
      bumpAnalysisSequence: () => ++analysisSeq,
      getAnalyzeController: () => analyzeCtrl,
      setAnalyzeController: (c: any) => { analyzeCtrl = c },
      getAnalyzeStopPoll: () => analyzeStop,
      setAnalyzeStopPoll: (fn: any) => { analyzeStop = fn },
      getTrackGenSequence: () => trackGenSeq,
      bumpTrackGenSequence: () => ++trackGenSeq,
      getTrackGenPoll: () => trackGenPoll,
      setTrackGenPoll: (poll: any) => { trackGenPoll = poll },
      getTrackGenController: () => trackCtrl,
      setTrackGenController: (c: any) => { trackCtrl = c },
      getImageGenSequence: () => imageGenSeq,
      bumpImageGenSequence: () => ++imageGenSeq,
      getImageGenJob: () => imageGenJob,
      setImageGenJob: (j: any) => { imageGenJob = j },
      getImageGenPoll: () => imageGenPoll,
      setImageGenPoll: (poll: any) => { imageGenPoll = poll },
      getV2PlanController: () => v2PlanCtrl,
      setV2PlanController: (c: any) => { v2PlanCtrl = c },
      bumpPipelineAttachToken: vi.fn(() => 1),
      getNegativePromptDebounce: () => debounceTimer,
      setNegativePromptDebounce: (t: any) => { debounceTimer = t },
    }
  })

  it('updates basic music metadata and clamps song duration', () => {
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    slice.setDirectorMusicSource('generate')
    expect(state.directorMusicSource).toBe('generate')

    slice.setDirectorMusicModel('music_gen_v2')
    expect(state.directorMusicModel).toBe('music_gen_v2')

    slice.setDirectorSongDuration(5) // below minimum 10
    expect(state.directorSongDuration).toBe(10)

    slice.setDirectorSongDuration(10000) // above maximum 3600
    expect(state.directorSongDuration).toBe(3600)
  })

  it('adds, reorders and removes character references correctly', () => {
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)
    const file1 = new File(['a'], 'a.png', { type: 'image/png' })
    const file2 = new File(['b'], 'b.png', { type: 'image/png' })

    slice.directorAddCharacterRef(file1)
    slice.directorAddCharacterRef(file2)
    expect(state.directorCharacterRefs).toHaveLength(2)

    slice.directorSetCharacterRefLabel(0, 'Hero')
    slice.directorSetCharacterRefLabel(1, 'Villain')
    expect(state.directorCharacterRefLabels).toEqual(['Hero', 'Villain'])

    slice.directorReorderCharacterRefs(0, 1)
    expect(state.directorCharacterRefs[0]).toBe(file2)
    expect(state.directorCharacterRefLabels).toEqual(['Villain', 'Hero'])

    slice.directorRemoveCharacterRef(0)
    expect(state.directorCharacterRefs).toHaveLength(1)
    expect(state.directorCharacterRefLabels).toEqual(['Hero'])
  })

  it('cancels in-flight track generation properly', () => {
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)
    const ctrl = new AbortController()
    mockDeps.setTrackGenController(ctrl)

    const aborted = slice.cancelDirectorTrackGen()
    expect(aborted).toBe(true)
    expect(state.directorTrackGenerating).toBe(false)
    expect(state.directorLoading).toBe(false)
    expect(mockDeps.getTrackGenController()).toBeNull()
  })

  it('edits clip plans in place', () => {
    state.directorClipPlans = [
      { video_prompt: 'prompt 1', image_prompt: 'img 1' },
      { video_prompt: 'prompt 2', image_prompt: 'img 2' },
    ]
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    slice.directorEditClipPlan(1, 'video_prompt', 'updated prompt 2')
    expect(state.directorClipPlans[1].video_prompt).toBe('updated prompt 2')
    expect(state.directorClipPlans[0].video_prompt).toBe('prompt 1')
  })
})
