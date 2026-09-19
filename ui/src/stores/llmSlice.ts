/**
 * LLM lifecycle slice.
 *
 * Why this lives in its own file
 * ------------------------------
 * ``useStore.ts`` is 12.5 kLOC and growing every quarter. The LLM
 * lifecycle fields (status, models, loading, load / unload) used to
 * live alongside the orchestration selectors in the main store.
 * Pulling them out into ``llmSlice.ts`` accomplishes three things:
 *
 * 1. **Smaller cognitive surface** — the main store's TypeScript
 *    type no longer references ``LlmStatus`` / ``LlmModelOption``
 *    unless the caller actually mounts the LLM-related panels.
 * 2. **Independent testing** — the slice is now mountable in
 *    isolation; ``useStore.ts``'s heavyweight selectors for
 *    models, prompts, generation jobs, etc. don't have to come
 *    along for the ride.
 * 3. **Trimmer ``useStore``** — every carve-out of this size
 *    makes the remaining orchestration logic easier to scan.
 *
 * The slice keeps the same field names the rest of the codebase
 * already consumes (``llmStatus``, ``llmLoading``, ``llmModels``,
 * ``loadLlmStatus``, ``loadLlmModels``, ``loadLlm``,
 * ``unloadLlm``) so the cutover is a single import / type merge
 * in ``useStore.ts`` rather than a renaming sweep across the UI.
 *
 * Why static imports here
 * -----------------------
 * Other slices in this codebase use lazy imports because the API
 * client transitively pulls in the bundled ``api.ts`` (3 kLOC) and
 * we want to defer that cost until the user opens a screen that
 * actually needs it. The LLM slice is consulted by
 * ``App.tsx``'s mount-time poll and by every settings panel; the
 * cost is paid at boot anyway, so a static import keeps the
 * ``vi.mock('../api/client')`` surface usable in vitest.
 */

import type { StateCreator } from 'zustand'
import {
  fetchLlmModels,
  fetchLlmStatus,
  loadLlm,
  unloadLlm,
} from '../api/client'

import type { LlmModelOption, LlmStatus } from '../types'
import type { AppState } from './useStore'

export type LlmSlice = {
  llmStatus: LlmStatus | null
  llmLoading: boolean
  llmModels: LlmModelOption[]
  loadLlmStatus: () => Promise<void>
  loadLlmModels: () => Promise<void>
  loadLlm: () => Promise<void>
  unloadLlm: () => Promise<void>
}

const initialState = {
  llmStatus: null as LlmStatus | null,
  llmLoading: false,
  llmModels: [] as LlmModelOption[],
}

export const createLlmSlice: StateCreator<
  AppState,
  [],
  [],
  LlmSlice
> = (set) => ({
  ...initialState,

  loadLlmStatus: async () => {
    try {
      const status = await fetchLlmStatus()
      set({ llmStatus: status })
    } catch (e) {
      // The caller (typically App.tsx's mount-time poll) doesn't
      // gate anything on llmStatus presence; surfacing the failure
      // through console.error lets on-call engineers see transient
      // network drops without crashing the boot path.
      console.error('Failed to load LLM status:', e)
    }
  },

  loadLlmModels: async () => {
    try {
      const data = await fetchLlmModels()
      set({ llmModels: data.models })
    } catch (e) {
      console.error('Failed to load LLM models:', e)
    }
  },

  loadLlm: async () => {
    set({ llmLoading: true })
    try {
      const result = await loadLlm()
      set({
        llmStatus: {
          loaded: result.loaded,
          model_id: result.model_id,
          device: result.device,
          provider: result.provider || '',
        },
        llmLoading: false,
      })
    } catch (e) {
      console.error('Failed to load LLM:', e)
      set({ llmLoading: false })
    }
  },

  unloadLlm: async () => {
    try {
      await unloadLlm()
      set({
        llmStatus: {
          loaded: false,
          model_id: null,
          device: null,
          provider: '',
        },
      })
    } catch (e) {
      console.error('Failed to unload LLM:', e)
    }
  },
})
