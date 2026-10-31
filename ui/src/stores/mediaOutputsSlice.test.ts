import { describe, expect, it, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import { createMediaOutputsSlice, computeFilteredOutputs, type MediaOutputsSlice } from './mediaOutputsSlice'
import type { OutputFile } from '../types'

vi.mock('../api/client', () => ({
  fetchOutputs: vi.fn(),
  toggleFavorite: vi.fn(),
  fetchOutputMetadata: vi.fn(),
  deleteOutput: vi.fn(),
  deleteUpload: vi.fn(),
  rejoinClips: vi.fn(),
}))

import * as api from '../api/client'

const mockOutputs: OutputFile[] = [
  { name: 'video1.mp4', url: '/v1.mp4', type: 'video', mode: 'video', edit_sub_mode: null, favorite: false, size: 100, created_at: 1, metadata_ready: true, metadata_updated_at: 1 },
  { name: 'image1.png', url: '/i1.png', type: 'image', mode: 'image', edit_sub_mode: null, favorite: true, size: 200, created_at: 2, metadata_ready: true, metadata_updated_at: 2 },
  { name: 'audio1.wav', url: '/a1.wav', type: 'audio', mode: 'audio', edit_sub_mode: null, favorite: false, size: 300, created_at: 3, metadata_ready: true, metadata_updated_at: 3 },
  { name: 'edit1.mp4', url: '/e1.mp4', type: 'video', mode: 'video', edit_sub_mode: 'retake', favorite: false, size: 400, created_at: 4, metadata_ready: true, metadata_updated_at: 4 },
]

function createTestStore() {
  const deps = {
    getModelMode: vi.fn(),
    normalizeStudioImageWorkflow: vi.fn(),
    normalizeStudioVideoWorkflow: vi.fn(),
    isOmniVideoModel: vi.fn(),
    captureVideoSubModeStash: vi.fn(),
    sfxModelTypes: [],
    isMusicModelType: vi.fn(),
    findResolutionSelection: vi.fn(),
    defaultRecastMapping: {},
  }
  return create<MediaOutputsSlice>()((set, get, store) =>
    createMediaOutputsSlice(set as never, get as never, store as never, deps),
  )
}

describe('computeFilteredOutputs', () => {
  it('filters by media type', () => {
    expect(computeFilteredOutputs(mockOutputs, 'all')).toHaveLength(4)
    expect(computeFilteredOutputs(mockOutputs, 'videos')).toHaveLength(2)
    expect(computeFilteredOutputs(mockOutputs, 'images')).toHaveLength(1)
    expect(computeFilteredOutputs(mockOutputs, 'audio')).toHaveLength(1)
    expect(computeFilteredOutputs(mockOutputs, 'avatars')).toHaveLength(1)
    expect(computeFilteredOutputs(mockOutputs, 'favorites')).toHaveLength(1)
  })
})

describe('mediaOutputsSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with default values', () => {
    const store = createTestStore()
    const state = store.getState()
    expect(state.outputs).toEqual([])
    expect(state.outputsTotal).toBe(0)
    expect(state.mediaFilter).toBe('all')
    expect(state.mediaGallerySelectedNames.size).toBe(0)
  })

  it('loads outputs from API', async () => {
    vi.mocked(api.fetchOutputs).mockResolvedValue({
      outputs: mockOutputs as never,
      total: 4,
    })
    vi.mocked(api.fetchOutputMetadata).mockResolvedValue({} as never)

    const store = createTestStore()
    await store.getState().loadOutputs()

    expect(api.fetchOutputs).toHaveBeenCalledWith(100, 0, { workspace: undefined })
    expect(store.getState().outputs).toHaveLength(4)
    expect(store.getState().outputsTotal).toBe(4)
  })

  it('toggles selection and supports range selection', () => {
    const store = createTestStore()
    store.setState({ outputs: mockOutputs })

    store.getState().toggleMediaGallerySelection('video1.mp4')
    expect(store.getState().mediaGallerySelectedNames.has('video1.mp4')).toBe(true)

    store.getState().toggleMediaGallerySelectionRange('video1.mp4', 'audio1.wav')
    expect(store.getState().mediaGallerySelectedNames.size).toBe(3)

    store.getState().clearMediaGallerySelection()
    expect(store.getState().mediaGallerySelectedNames.size).toBe(0)
  })

  it('toggles favorite on an item', async () => {
    vi.mocked(api.toggleFavorite).mockResolvedValue({ favorite: true })
    const store = createTestStore()
    store.setState({ outputs: mockOutputs })

    await store.getState().toggleFavorite('video1.mp4')
    expect(api.toggleFavorite).toHaveBeenCalledWith('video1.mp4')
    expect(store.getState().outputs.find(o => o.name === 'video1.mp4')?.favorite).toBe(true)
  })
})
