/**
 * Recipes slice.
 *
 * Encapsulates the state and actions for Studio Recipes (one-click look presets).
 */
import type { StateCreator } from 'zustand'
import * as api from '../api/client'
import type { AppState } from './useStore'
import type { GenerateParams, GenerationMode } from '../types'

export type RecipesSlice = Pick<
  AppState,
  | 'recipesOpen'
  | 'recipes'
  | 'recipesLoading'
  | 'setRecipesOpen'
  | 'loadRecipes'
  | 'applyRecipe'
  | 'saveRecipeFromOutput'
  | 'deleteRecipe'
  | 'downloadRecipeLora'
>

export type RecipesSliceDeps = {
  getModelMode: (modelType: string, familyId: string) => GenerationMode
}

export const createRecipesSlice = (
  set: Parameters<StateCreator<AppState, [], [], RecipesSlice>>[0],
  get: Parameters<StateCreator<AppState, [], [], RecipesSlice>>[1],
  _store: Parameters<StateCreator<AppState, [], [], RecipesSlice>>[2],
  deps: RecipesSliceDeps,
): RecipesSlice => ({
  recipesOpen: false,
  setRecipesOpen: (open) => {
    set({ recipesOpen: open })
    if (open) get().loadRecipes()
  },
  recipes: [],
  recipesLoading: false,
  loadRecipes: async () => {
    set({ recipesLoading: true })
    try {
      const { recipes } = await api.fetchRecipes()
      set({ recipes, recipesLoading: false })
    } catch (e) {
      console.error('Failed to load recipes:', e)
      set({ recipes: [], recipesLoading: false })
    }
  },
  applyRecipe: async (id) => {
    const recipe = await api.fetchRecipe(id)
    const { models } = get()
    const model = models.find(m => m.model_type === recipe.model_type)
    const mode = model
      ? deps.getModelMode(recipe.model_type, model.family)
      : ((recipe.mode as GenerationMode) || 'video')

    const activated = (recipe.loras || []).map(l => l.filename)
    const multipliers = (recipe.loras || []).map(l => String(l.multiplier ?? '1.0')).join(' ')
    const loraWeights: Record<string, number[]> = {}
    for (const l of recipe.loras || []) {
      loraWeights[l.filename] = String(l.multiplier ?? '1.0').split(';').map(Number)
    }

    set(s => ({
      generationMode: mode,
      params: {
        ...s.params,
        ...(recipe.params as Partial<GenerateParams>),
        model_type: recipe.model_type,
        prompt: recipe.prompt_example || '',
        activated_loras: activated,
        loras_multipliers: multipliers,
        seed: -1,
        repeat_generation: 1,
        image_mode: mode === 'image' ? 1 : 0,
      },
      loraWeights,
      availableLoras: [],
      selectedModelPerMode: { ...s.selectedModelPerMode, [mode]: recipe.model_type },
      h3WindowPlan: null,
    }))

    if (recipe.model_type) {
      get().loadModelOptions(recipe.model_type)
      const vlen = (recipe.params as Record<string, unknown>)?.video_length
      const fps = model?.fps || 16
      if (typeof vlen === 'number' && vlen > 0) {
        set({ durationSeconds: Math.round((vlen / fps) * 10) / 10 })
      }
      await get().loadLoras(recipe.model_type)
    }

    const present = new Set(
      get().availableLoras.map(x => (x || '').replace(/\\/g, '/').split('/').pop() || '')
    )
    const missing = (recipe.loras || []).filter(l => !present.has(l.filename))
    return { missing }
  },
  saveRecipeFromOutput: async (outputName, name, description, nsfw) => {
    await api.saveRecipeFromOutput({ output_name: outputName, name, description, nsfw })
    if (get().recipesOpen) get().loadRecipes()
  },
  deleteRecipe: async (id) => {
    await api.deleteRecipe(id)
    set(s => ({ recipes: s.recipes.filter(r => r.id !== id) }))
  },
  downloadRecipeLora: async (lora, modelType) => {
    if (!lora.source_url) {
      throw new Error('This recipe has no download source for that LoRA — install it manually.')
    }
    const model = get().models.find(m => m.model_type === modelType)
    await api.startCivitAIDownload({
      download_url: lora.source_url,
      filename: lora.filename,
      target_arch: (model?.architecture as string) || '',
      model_id: 0,
      version_id: 0,
      trained_words: [],
      model_name: lora.filename,
      images: [],
    })
    get().pollCivitAIDownloads()
  },
})
