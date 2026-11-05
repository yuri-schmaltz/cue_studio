import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDirectorPlanningSlice } from './directorPlanningSlice'
import * as api from '../api/client'

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

  it('reconciles a time-anchored briefing against the analysed audio', async () => {
    state.directorAnalysis = { duration: 255 }
    const reconcileSpy = vi.spyOn(api, 'reconcileScript').mockResolvedValue({
      script: { scenes: [], global_style: '', global_technical: '', span: [0, 45], anchored: true },
      report: {
        status: 'excerpt',
        scene_count: 3,
        anchored_scene_count: 3,
        audio_duration: 255,
        covered_start: 0,
        covered_end: 45,
        covered_seconds: 45,
        coverage_ratio: 0.1765,
        uncovered_seconds: 210,
        gaps: [],
      },
    })
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    state.directorSceneDescription = 'CENA 1: A (0:00 - 0:45)\nSomething.'
    await slice.directorReconcileScript()

    expect(reconcileSpy).toHaveBeenCalledWith({
      scene_description: 'CENA 1: A (0:00 - 0:45)\nSomething.',
      audio_duration: 255,
    })
    expect(state.directorScriptReconciliation?.report.status).toBe('excerpt')
  })

  it('clears the reconciliation when the briefing is emptied', async () => {
    const reconcileSpy = vi.spyOn(api, 'reconcileScript')
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    state.directorSceneDescription = '   '
    await slice.directorReconcileScript()

    expect(reconcileSpy).not.toHaveBeenCalled()
    expect(state.directorScriptReconciliation).toBeNull()
  })

  it('restricts the clip plan to the scripted window', async () => {
    state.directorAnalysis = { duration: 255 }
    const planSpy = vi.spyOn(api, 'planClipStructure').mockResolvedValue({
      clips: [{
        start: 0,
        end: 45,
        section_label: 'verse',
        beat_count: 8,
        duration_frames: 120,
        energy: 0.5,
        suggested_prompt_hint: '',
      }],
    })
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    await slice.directorSetScriptWindow({ start: 0, end: 45 })

    expect(planSpy).toHaveBeenCalledWith(
      expect.objectContaining({ window_start: 0, window_end: 45 }),
    )
    expect(state.directorScriptWindow).toEqual({ start: 0, end: 45 })
    expect(state.directorPlannedClips).toHaveLength(1)
  })

  it('releases the window and plans the whole track again', async () => {
    state.directorAnalysis = { duration: 255 }
    const planSpy = vi.spyOn(api, 'planClipStructure').mockResolvedValue({ clips: [] })
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    state.directorScriptWindow = { start: 0, end: 45 }
    await slice.directorSetScriptWindow(null)

    const call = planSpy.mock.calls[0][0]
    expect(call.window_start).toBeUndefined()
    expect(call.window_end).toBeUndefined()
    expect(state.directorScriptWindow).toBeNull()
  })

  it('keeps the script window when the energy bias changes', async () => {
    state.directorAnalysis = { duration: 255 }
    const planSpy = vi.spyOn(api, 'planClipStructure').mockResolvedValue({ clips: [] })
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    state.directorScriptWindow = { start: 0, end: 45 }
    await slice.directorSetEnergyBias(2)

    expect(planSpy).toHaveBeenCalledWith(
      expect.objectContaining({ energy_bias: 2, window_start: 0, window_end: 45 }),
    )
  })

  it('sends the briefing to the planner when the script drives the structure', async () => {
    state.directorAnalysis = { duration: 255 }
    state.directorSceneDescription = 'CENA 1: A (0:00 - 0:11)'
    state.directorStructureSource = 'script'
    state.directorScriptGranularity = 'beat'
    const planSpy = vi.spyOn(api, 'planClipStructure').mockResolvedValue({ clips: [] })
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    await slice.directorEnsureStructure()

    expect(planSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        structure_source: 'script',
        script_granularity: 'beat',
        scene_description: 'CENA 1: A (0:00 - 0:11)',
      }),
    )
  })

  it('omits the briefing from the audio-driven plan', async () => {
    state.directorAnalysis = { duration: 255 }
    state.directorSceneDescription = 'CENA 1: A (0:00 - 0:11)'
    state.directorStructureSource = 'audio'
    const planSpy = vi.spyOn(api, 'planClipStructure').mockResolvedValue({ clips: [] })
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    await slice.directorEnsureStructure()

    const call = planSpy.mock.calls[0][0]
    expect(call.structure_source).toBeUndefined()
    expect(call.scene_description).toBeUndefined()
  })

  it('re-plans when the structure source changes', async () => {
    state.directorAnalysis = { duration: 255 }
    state.directorSceneDescription = 'CENA 1: A (0:00 - 0:11)'
    state.directorStructureSource = 'audio'
    const planSpy = vi.spyOn(api, 'planClipStructure').mockResolvedValue({ clips: [] })
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    await slice.directorSetStructureSource('script')

    expect(state.directorStructureSource).toBe('script')
    expect(planSpy).toHaveBeenCalledWith(
      expect.objectContaining({ structure_source: 'script' }),
    )
  })

  it('re-plans when the script granularity changes', async () => {
    state.directorAnalysis = { duration: 255 }
    state.directorSceneDescription = 'CENA 1: A (0:00 - 0:11)'
    state.directorStructureSource = 'script'
    state.directorScriptGranularity = 'beat'
    const planSpy = vi.spyOn(api, 'planClipStructure').mockResolvedValue({ clips: [] })
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    await slice.directorSetScriptGranularity('scene')

    expect(state.directorScriptGranularity).toBe('scene')
    expect(planSpy).toHaveBeenCalledWith(
      expect.objectContaining({ script_granularity: 'scene' }),
    )
  })

  it('keeps the script source when the energy bias changes', async () => {
    state.directorAnalysis = { duration: 255 }
    state.directorSceneDescription = 'CENA 1: A (0:00 - 0:11)'
    state.directorStructureSource = 'script'
    const planSpy = vi.spyOn(api, 'planClipStructure').mockResolvedValue({ clips: [] })
    const slice = createDirectorPlanningSlice(set, get, {} as any, mockDeps)

    await slice.directorSetEnergyBias(1)

    expect(planSpy).toHaveBeenCalledWith(
      expect.objectContaining({ structure_source: 'script' }),
    )
  })
})
