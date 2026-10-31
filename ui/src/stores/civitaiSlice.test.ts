import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCivitAISlice } from './civitaiSlice'
import * as api from '../api/client'

vi.mock('../api/client', () => ({
  searchCivitAI: vi.fn(),
  fetchCivitAIModel: vi.fn(),
  startCivitAIDownload: vi.fn(),
  fetchCivitAIDownloads: vi.fn(),
  reloadModels: vi.fn(),
}))

describe('civitaiSlice', () => {
  let state: Record<string, any>
  const set = vi.fn((patch) => {
    if (typeof patch === 'function') {
      state = { ...state, ...patch(state) }
    } else {
      state = { ...state, ...patch }
    }
  })
  const get = vi.fn(() => state)

  beforeEach(() => {
    state = {
      loraBrowserOpen: false,
      loraBrowserArch: null,
      loraBrowserDefaultDir: null,
      civitSearchResults: [],
      civitSearchCursor: null,
      civitSearchLoading: false,
      civitSearchError: null,
      civitSelectedModel: null,
      civitDownloads: [],
      params: { model_type: 'test-model' },
      loadLoras: vi.fn(),
      loadModels: vi.fn(),
      pollCivitAIDownloads: vi.fn(),
    }
    vi.clearAllMocks()
  })

  it('sets loraBrowserOpen to true and clears selection', () => {
    const slice = createCivitAISlice(set, get, {} as any)
    slice.setLoraBrowserOpen(true, 'flux')
    expect(set).toHaveBeenCalledWith({
      loraBrowserOpen: true,
      loraBrowserArch: 'flux',
      civitSearchResults: [],
      civitSearchCursor: null,
      civitSelectedModel: null,
    })
    expect(state.pollCivitAIDownloads).toHaveBeenCalled()
  })

  it('searches CivitAI and stores results', async () => {
    const dummyItems = [{ id: 123, name: 'Cool LoRA' }]
    vi.mocked(api.searchCivitAI).mockResolvedValueOnce({
      items: dummyItems as any,
      metadata: { nextCursor: 'cur1' },
    })

    const slice = createCivitAISlice(set, get, {} as any)
    await slice.searchCivitAI({ query: 'cool' })

    expect(set).toHaveBeenCalledWith({ civitSearchLoading: true, civitSearchError: null })
    expect(set).toHaveBeenCalledWith({
      civitSearchResults: dummyItems,
      civitSearchCursor: 'cur1',
      civitSearchLoading: false,
      civitSelectedModel: null,
    })
  })

  it('selects and clears CivitAI model details', async () => {
    const dummyModel = { id: 123, name: 'Detailed LoRA' }
    vi.mocked(api.fetchCivitAIModel).mockResolvedValueOnce(dummyModel as any)

    const slice = createCivitAISlice(set, get, {} as any)
    await slice.selectCivitAIModel(123)

    expect(set).toHaveBeenCalledWith({ civitSelectedModel: dummyModel })

    slice.clearCivitSelection()
    expect(set).toHaveBeenCalledWith({ civitSelectedModel: null })
  })
})
