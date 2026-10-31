/**
 * CivitAI & LoRA browser slice.
 *
 * Encapsulates search, details, and download polling for CivitAI resources.
 */
import type { StateCreator } from 'zustand'
import * as api from '../api/client'
import type { AppState } from './useStore'
import { downloadNeedsPolling, waitForDownloadPoll } from './utils'

const CIVIT_DOWNLOAD_POLL_MS = 2000

export type CivitAISlice = Pick<
  AppState,
  | 'loraBrowserOpen'
  | 'loraBrowserArch'
  | 'loraBrowserDefaultDir'
  | 'setLoraBrowserDefaultDir'
  | 'setLoraBrowserOpen'
  | 'civitSearchResults'
  | 'civitSearchCursor'
  | 'civitSearchLoading'
  | 'civitSearchError'
  | 'civitSelectedModel'
  | 'civitDownloads'
  | 'searchCivitAI'
  | 'selectCivitAIModel'
  | 'clearCivitSelection'
  | 'startCivitAIDownload'
  | 'pollCivitAIDownloads'
>

let _civitDownloadPollTask: Promise<void> | null = null
let _civitDownloadPollController: AbortController | null = null
let _civitDownloadPollRequested = false
const _civitRefreshedCheckpointDownloads = new Set<string>()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _civitDownloadPollController?.abort()
    _civitDownloadPollController = null
    _civitDownloadPollTask = null
    _civitDownloadPollRequested = false
    _civitRefreshedCheckpointDownloads.clear()
  })
}

export const createCivitAISlice: StateCreator<
  AppState,
  [],
  [],
  CivitAISlice
> = (set, get) => ({
  loraBrowserOpen: false,
  loraBrowserArch: null,
  loraBrowserDefaultDir: null,
  setLoraBrowserDefaultDir: (dir) => set({ loraBrowserDefaultDir: dir }),
  setLoraBrowserOpen: (open, arch) => {
    if (open) {
      set({
        loraBrowserOpen: true,
        loraBrowserArch: arch || null,
        civitSearchResults: [],
        civitSearchCursor: null,
        civitSelectedModel: null,
      })
      get().pollCivitAIDownloads()
    } else {
      set({ loraBrowserOpen: false })
      const modelType = get().params.model_type
      if (modelType) get().loadLoras(modelType)
    }
  },
  civitSearchResults: [],
  civitSearchCursor: null,
  civitSearchLoading: false,
  civitSearchError: null,
  civitSelectedModel: null,
  civitDownloads: [],

  searchCivitAI: async (params, append = false) => {
    set({ civitSearchLoading: true, civitSearchError: null })
    try {
      const result = await api.searchCivitAI(params as Parameters<typeof api.searchCivitAI>[0])
      if (append) {
        set(s => ({
          civitSearchResults: [...s.civitSearchResults, ...result.items],
          civitSearchCursor: result.metadata?.nextCursor || null,
          civitSearchLoading: false,
        }))
      } else {
        set({
          civitSearchResults: result.items,
          civitSearchCursor: result.metadata?.nextCursor || null,
          civitSearchLoading: false,
          civitSelectedModel: null,
        })
      }
    } catch (e) {
      console.error('CivitAI search failed:', e)
      const msg = e instanceof Error ? e.message : 'CivitAI search failed'
      set({ civitSearchLoading: false, civitSearchError: msg })
    }
  },

  selectCivitAIModel: async (modelId) => {
    try {
      const model = await api.fetchCivitAIModel(modelId)
      set({ civitSelectedModel: model })
    } catch (e) {
      console.error('Failed to fetch model details:', e)
    }
  },

  clearCivitSelection: () => set({ civitSelectedModel: null }),

  startCivitAIDownload: async (params) => {
    try {
      await api.startCivitAIDownload(params as Parameters<typeof api.startCivitAIDownload>[0])
      get().pollCivitAIDownloads()
    } catch (e) {
      console.error('Download failed:', e)
    }
  },

  pollCivitAIDownloads: () => {
    _civitDownloadPollRequested = true
    if (_civitDownloadPollTask) return

    const controller = new AbortController()
    _civitDownloadPollController = controller
    const poll = async () => {
      let consecutiveErrors = 0
      try {
        while (!controller.signal.aborted) {
          _civitDownloadPollRequested = false
          try {
            const { downloads } = await api.fetchCivitAIDownloads()
            consecutiveErrors = 0
            set({ civitDownloads: downloads })

            const completedCheckpoints = downloads.filter(download =>
              download.status === 'completed'
              && !!download.model_type
              && !_civitRefreshedCheckpointDownloads.has(download.id)
            )
            if (completedCheckpoints.length > 0) {
              try {
                await api.reloadModels()
                await get().loadModels()
                completedCheckpoints.forEach(download => {
                  _civitRefreshedCheckpointDownloads.add(download.id)
                })
              } catch (error) {
                console.warn('Checkpoint model refresh failed; will retry:', error)
              }
            }

            if (_civitDownloadPollRequested) continue

            if (!downloads.some(download => downloadNeedsPolling(download, Date.now()))) return
            await waitForDownloadPoll(CIVIT_DOWNLOAD_POLL_MS, controller.signal)
          } catch (error) {
            if (controller.signal.aborted) return
            consecutiveErrors += 1
            if (_civitDownloadPollRequested) continue
            const knownWork = get().civitDownloads.some(download =>
              downloadNeedsPolling(download, Date.now())
            )
            if (!get().loraBrowserOpen && !knownWork && consecutiveErrors > 3) {
              console.warn('Download polling paused after repeated errors:', error)
              return
            }
            const retryMs = Math.min(10_000, 1000 * (2 ** Math.min(consecutiveErrors - 1, 3)))
            await waitForDownloadPoll(retryMs, controller.signal)
          }
        }
      } finally {
        if (_civitDownloadPollController === controller) {
          _civitDownloadPollController = null
          _civitDownloadPollTask = null
        }
      }
    }

    _civitDownloadPollTask = poll()
  },
})
