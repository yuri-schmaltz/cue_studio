import { describe, expect, it, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import { createShortFilmSlice, type ShortFilmSlice } from './shortFilmSlice'

vi.mock('../api/client', () => ({
  uploadAudio: vi.fn(),
  analyzeAudio: vi.fn(),
  fetchAudioAnalyzeStatus: vi.fn(),
  planDialogueScenes: vi.fn(),
  directorV2Plan: vi.fn(),
  planShortFilmPrompts: vi.fn(),
  planShortFilmScript: vi.fn(),
}))

import * as api from '../api/client'

function createTestStore() {
  let sequence = 0
  let controller: AbortController | null = null
  let stopPoll: (() => void) | null = null

  const deps = {
    startDirectLlmStreamPolling: vi.fn(() => vi.fn()),
    directorUsesGeneratedShotImages: vi.fn(() => false),
    getAnalysisSequence: () => sequence,
    bumpAnalysisSequence: () => ++sequence,
    setAnalyzeController: (ctrl: AbortController | null) => { controller = ctrl },
    getAnalyzeController: () => controller,
    setAnalyzeStopPoll: (fn: (() => void) | null) => { stopPoll = fn },
  }

  return create<ShortFilmSlice & {
    directorPlannedClips: any[]
    directorSceneDescription: string
    directorAnalysis: any
    directorEnergyBias: number
    modelOptions: any
  }>()((set, get, store) => ({
    directorPlannedClips: [],
    directorSceneDescription: '',
    directorAnalysis: null,
    directorEnergyBias: 0,
    modelOptions: null,
    ...createShortFilmSlice(set as never, get as never, store as never, deps),
  }))
}

describe('shortFilmSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with default short film parameters', () => {
    const store = createTestStore()
    const state = store.getState()
    expect(state.shortFilmCharacters).toEqual([])
    expect(state.shortFilmPath).toBeNull()
    expect(state.shortFilmTargetDuration).toBe(30)
    expect(state.shortFilmNarrative).toBe(false)
  })

  it('updates target duration clamped between 10 and 3600 seconds', () => {
    const store = createTestStore()
    store.getState().shortFilmSetTargetDuration(5)
    expect(store.getState().shortFilmTargetDuration).toBe(10)

    store.getState().shortFilmSetTargetDuration(5000)
    expect(store.getState().shortFilmTargetDuration).toBe(3600)

    store.getState().shortFilmSetTargetDuration(120)
    expect(store.getState().shortFilmTargetDuration).toBe(120)
  })

  it('sets characters and narrative flag', () => {
    const store = createTestStore()
    const chars = [{ name: 'Robo', description: 'Tiny robot', visual_cues: 'metallic' }]
    store.getState().shortFilmSetCharacters(chars)
    expect(store.getState().shortFilmCharacters).toEqual(chars)

    store.getState().shortFilmSetNarrative(true)
    expect(store.getState().shortFilmNarrative).toBe(true)
  })

  it('updates pacing bias and recalculates dialogue scenes', async () => {
    vi.mocked(api.planDialogueScenes).mockResolvedValue({
      clips: [{ start: 0, end: 5, duration_frames: 80, section_label: 'intro', energy: 0.5, suggested_prompt_hint: '', beat_count: 0 }],
    })

    const store = createTestStore()
    store.setState({ directorAnalysis: { duration: 10, lyrics: [] } })

    await store.getState().shortFilmSetPacingBias(0.8)
    expect(api.planDialogueScenes).toHaveBeenCalled()
    expect(store.getState().directorPlannedClips).toHaveLength(1)
  })
})
