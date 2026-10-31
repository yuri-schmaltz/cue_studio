import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRecipesSlice } from './recipesSlice'
import * as api from '../api/client'

vi.mock('../api/client', () => ({
  fetchRecipes: vi.fn(),
  fetchRecipe: vi.fn(),
  saveRecipeFromOutput: vi.fn(),
  deleteRecipe: vi.fn(),
  startCivitAIDownload: vi.fn(),
}))

describe('recipesSlice', () => {
  let state: Record<string, any>
  const set = vi.fn((patch) => {
    if (typeof patch === 'function') {
      state = { ...state, ...patch(state) }
    } else {
      state = { ...state, ...patch }
    }
  })
  const get = vi.fn(() => state)
  const deps = {
    getModelMode: vi.fn((modelType, family) => 'video' as const),
  }

  beforeEach(() => {
    state = {
      recipesOpen: false,
      recipes: [],
      recipesLoading: false,
      models: [],
      availableLoras: [],
      params: {},
      selectedModelPerMode: {},
      loadRecipes: vi.fn(),
      loadModelOptions: vi.fn(),
      loadLoras: vi.fn(),
      pollCivitAIDownloads: vi.fn(),
    }
    vi.clearAllMocks()
  })

  it('toggles recipesOpen and triggers loadRecipes when opening', () => {
    const slice = createRecipesSlice(set, get, {} as any, deps)
    slice.setRecipesOpen(true)
    expect(set).toHaveBeenCalledWith({ recipesOpen: true })
    expect(state.loadRecipes).toHaveBeenCalled()
  })

  it('loads recipes successfully', async () => {
    const dummyRecipes = [{ id: 'r1', name: 'Vintage Look' }]
    vi.mocked(api.fetchRecipes).mockResolvedValueOnce({ recipes: dummyRecipes as any })

    const slice = createRecipesSlice(set, get, {} as any, deps)
    await slice.loadRecipes()

    expect(set).toHaveBeenCalledWith({ recipesLoading: true })
    expect(set).toHaveBeenCalledWith({ recipes: dummyRecipes, recipesLoading: false })
  })

  it('deletes a recipe', async () => {
    state.recipes = [{ id: 'r1' }, { id: 'r2' }]
    vi.mocked(api.deleteRecipe).mockResolvedValueOnce({ deleted: 'r1' } as any)

    const slice = createRecipesSlice(set, get, {} as any, deps)
    await slice.deleteRecipe('r1')

    expect(api.deleteRecipe).toHaveBeenCalledWith('r1')
    expect(state.recipes).toEqual([{ id: 'r2' }])
  })
})
