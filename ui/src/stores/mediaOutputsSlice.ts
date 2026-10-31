/**
 * Media Outputs & Gallery slice.
 *
 * Encapsulates the state and actions for the Studio Media Gallery / Outputs:
 * - listagem e paginação (loadOutputs, loadMoreOutputs, refreshOutputs)
 * - filtros de mídia e busca
 * - favoritos e metadados
 * - seleções individuais, por intervalo e em lote
 * - exclusão individual e bulk
 * - restauração de parâmetros e reroll
 */

import type { StateCreator } from 'zustand'
import * as api from '../api/client'
import type { AppState } from './useStore'
import type { OutputFile, MediaFilter, OutputMetadata } from '../types'

export type MediaOutputsSlice = {
  outputs: OutputFile[]
  outputsTotal: number
  selectedOutput: number
  setSelectedOutput: (i: number) => void
  mediaFilter: MediaFilter
  outputSearchQuery: string
  setMediaFilter: (f: MediaFilter) => void
  setOutputSearchQuery: (q: string) => void
  filteredOutputs: () => OutputFile[]
  outputsLoading: boolean
  loadOutputs: () => Promise<void>
  loadMoreOutputs: () => Promise<void>
  refreshOutputs: () => Promise<void>
  toggleFavorite: (name: string) => Promise<void>
  selectedOutputMeta: OutputMetadata | null
  metadataLoading: boolean
  loadOutputMetadata: (name: string) => Promise<void>
  loadSettingsFromOutput: () => Promise<void>
  rerollGeneration: () => Promise<void>
  rejoinClipGroup: (groupId: string) => Promise<void>
  deleteSelectedOutput: () => Promise<void>
  mediaGallerySelectedNames: Set<string>
  setMediaGallerySelectedNames: (next: Set<string>) => void
  toggleMediaGallerySelection: (name: string) => void
  toggleMediaGallerySelectionRange: (fromName: string, toName: string) => void
  selectAllMediaGallery: (names: string[]) => void
  clearMediaGallerySelection: () => void
  bulkDeleteSelectedOutputs: () => Promise<{ deleted: number; failed: number }>
}

export type MediaOutputsSliceDeps = {
  getModelMode: (modelType: string, familyId: string) => any
  normalizeStudioImageWorkflow: (value: unknown) => any
  normalizeStudioVideoWorkflow: (value: unknown, model?: any) => any
  isOmniVideoModel: (modelType?: string | null) => boolean
  captureVideoSubModeStash: (state: any) => any
  sfxModelTypes: readonly string[]
  isMusicModelType: (modelType?: string | null) => boolean
  findResolutionSelection: (model: any, res: any, currentAspect?: any, currentFps?: any) => any
  defaultRecastMapping: any
}

// Memoization cache for filteredOutputs — ensures stable references
let _foCachedOutputs: OutputFile[] = []
let _foCachedFilter: MediaFilter = 'all'
let _foCachedResult: OutputFile[] = []

export function computeFilteredOutputs(outputs: OutputFile[], mediaFilter: MediaFilter): OutputFile[] {
  if (outputs === _foCachedOutputs && mediaFilter === _foCachedFilter) {
    return _foCachedResult
  }
  _foCachedOutputs = outputs
  _foCachedFilter = mediaFilter
  if (mediaFilter === 'all') {
    _foCachedResult = outputs
  } else if (mediaFilter === 'videos') {
    _foCachedResult = outputs.filter(o => o.type === 'video')
  } else if (mediaFilter === 'images') {
    _foCachedResult = outputs.filter(o => o.type === 'image')
  } else if (mediaFilter === 'audio') {
    _foCachedResult = outputs.filter(o => o.type === 'audio')
  } else if (mediaFilter === 'avatars') {
    _foCachedResult = outputs.filter(o => !!o.edit_sub_mode || o.mode === 'avatar')
  } else if (mediaFilter === 'multiclip') {
    _foCachedResult = outputs
  } else if (mediaFilter === 'favorites') {
    _foCachedResult = outputs.filter(o => o.favorite)
  } else {
    _foCachedResult = outputs
  }
  return _foCachedResult
}

export const createMediaOutputsSlice = (
  set: Parameters<StateCreator<AppState, [], [], MediaOutputsSlice>>[0],
  get: Parameters<StateCreator<AppState, [], [], MediaOutputsSlice>>[1],
  _store: Parameters<StateCreator<AppState, [], [], MediaOutputsSlice>>[2],
  deps: MediaOutputsSliceDeps,
): MediaOutputsSlice => ({
  outputs: [],
  outputsTotal: 0,
  selectedOutput: 0,
  setSelectedOutput: (i) => {
    set({ selectedOutput: i })
    const outputs = get().filteredOutputs()
    const output = outputs[i]
    if (output) {
      get().loadOutputMetadata(output.name)
    } else {
      set({ selectedOutputMeta: null })
    }
  },
  mediaFilter: 'all',
  outputSearchQuery: '',
  setMediaFilter: (f) => {
    const prevFilter = get().mediaFilter
    set({ mediaFilter: f, selectedOutput: 0 })
    const backendFilters: MediaFilter[] = ['favorites', 'multiclip']
    if (backendFilters.includes(f) || backendFilters.includes(prevFilter)) {
      get().loadOutputs()
      return
    }
    const filtered = get().filteredOutputs()
    if (filtered.length > 0) {
      get().loadOutputMetadata(filtered[0].name)
    } else {
      set({ selectedOutputMeta: null })
    }
  },
  setOutputSearchQuery: (q) => {
    set({ outputSearchQuery: q, selectedOutput: 0 })
    if (q.trim()) {
      get().loadOutputs()
    } else if (get().mediaFilter === 'all') {
      get().loadOutputs()
    }
  },
  filteredOutputs: () => {
    const { outputs, mediaFilter } = get()
    return computeFilteredOutputs(outputs, mediaFilter)
  },

  outputsLoading: false,
  loadOutputs: async () => {
    const PAGE_SIZE = 100
    const { mediaFilter, outputSearchQuery, browsingUploads } = get()
    const isBackendFilter = mediaFilter === 'favorites' || mediaFilter === 'multiclip' || outputSearchQuery.trim()
    const ws = browsingUploads ? '__uploads__' : undefined
    set({ outputsLoading: true })
    try {
      const { outputs: apiOutputs, total } = isBackendFilter
        ? await api.fetchOutputs(0, 0, {
            favoritesOnly: mediaFilter === 'favorites',
            multiclipOnly: mediaFilter === 'multiclip',
            search: outputSearchQuery.trim() || undefined,
            workspace: ws,
          })
        : await api.fetchOutputs(PAGE_SIZE, 0, { workspace: ws })
      const outputs: OutputFile[] = apiOutputs.map(o => ({
        name: o.name,
        url: o.url,
        type: o.type,
        mode: (o.mode as OutputFile['mode']) || null,
        edit_sub_mode: (o.edit_sub_mode as OutputFile['edit_sub_mode']) || null,
        favorite: o.favorite || false,
        size: o.size,
        created_at: o.created_at,
        metadata_ready: o.metadata_ready,
        metadata_updated_at: o.metadata_updated_at,
      }))
      set({ outputs, outputsTotal: total, selectedOutput: 0, outputsLoading: false })
      if (outputs.length > 0) {
        get().loadOutputMetadata(outputs[0].name)
      }
    } catch (e) {
      console.error('Failed to load outputs:', e)
      set({ outputsLoading: false })
    }
  },

  loadMoreOutputs: async () => {
    const PAGE_SIZE = 100
    const current = get().outputs
    const total = get().outputsTotal
    if (current.length >= total) return
    try {
      const { outputs: apiOutputs, total: newTotal } = await api.fetchOutputs(PAGE_SIZE, current.length, {
        workspace: get().browsingUploads ? '__uploads__' : undefined,
      })
      const more: OutputFile[] = apiOutputs.map(o => ({
        name: o.name,
        url: o.url,
        type: o.type,
        mode: (o.mode as OutputFile['mode']) || null,
        edit_sub_mode: (o.edit_sub_mode as OutputFile['edit_sub_mode']) || null,
        favorite: o.favorite || false,
        size: o.size,
        created_at: o.created_at,
        metadata_ready: o.metadata_ready,
        metadata_updated_at: o.metadata_updated_at,
      }))
      const existingNames = new Set(current.map(o => o.name))
      const unique = more.filter(o => !existingNames.has(o.name))
      if (unique.length > 0) {
        set({ outputs: [...current, ...unique], outputsTotal: newTotal })
      }
    } catch {
      // Silent fail
    }
  },

  refreshOutputs: async () => {
    try {
      const { outputs: apiOutputs, total } = await api.fetchOutputs(50, 0)
      const fresh: OutputFile[] = apiOutputs.map(o => ({
        name: o.name,
        url: o.url,
        type: o.type,
        mode: (o.mode as OutputFile['mode']) || null,
        edit_sub_mode: (o.edit_sub_mode as OutputFile['edit_sub_mode']) || null,
        favorite: o.favorite || false,
        size: o.size,
        created_at: o.created_at,
        metadata_ready: o.metadata_ready,
        metadata_updated_at: o.metadata_updated_at,
      }))
      const current = get().outputs
      const currentNames = new Set(current.map(o => o.name))
      const newItems = fresh.filter(o => !currentNames.has(o.name))
      const freshByName = new Map(fresh.map(output => [output.name, output]))
      let metadataChanged = false
      const refreshedCurrent = current.map(output => {
        const freshOutput = freshByName.get(output.name)
        if (!freshOutput) return output
        if (
          freshOutput.metadata_ready !== output.metadata_ready
          || freshOutput.metadata_updated_at !== output.metadata_updated_at
        ) {
          metadataChanged = true
          return freshOutput
        }
        return output
      })
      if (newItems.length > 0 || metadataChanged) {
        const merged = [...newItems, ...refreshedCurrent]
        const sel = get().selectedOutput
        set({ outputs: merged, outputsTotal: total, selectedOutput: sel + newItems.length })
      }
    } catch {
      // Silent fail
    }
  },

  toggleFavorite: async (name) => {
    try {
      const result = await api.toggleFavorite(name)
      set(s => ({
        outputs: s.outputs.map(o => o.name === name ? { ...o, favorite: result.favorite } : o),
      }))
    } catch (e) {
      console.error('Failed to toggle favorite:', e)
    }
  },

  selectedOutputMeta: null,
  metadataLoading: false,

  loadOutputMetadata: async (name) => {
    set({ metadataLoading: true, selectedOutputMeta: null })
    try {
      const meta = await api.fetchOutputMetadata(name)
      set({ selectedOutputMeta: meta, metadataLoading: false })
    } catch (e) {
      console.error('[LoadSettings] fetchOutputMetadata FAILED for', name, '-', e)
      set({ selectedOutputMeta: null, metadataLoading: false })
    }
  },

  loadSettingsFromOutput: async () => {
    const { restoreOutputSettings } = await import('./outputRestoration')
    await restoreOutputSettings(set, get, {
      getModelMode: deps.getModelMode,
      _normalizeStudioImageWorkflow: deps.normalizeStudioImageWorkflow,
      _normalizeStudioVideoWorkflow: deps.normalizeStudioVideoWorkflow,
      _isOmniVideoModel: deps.isOmniVideoModel,
      captureVideoSubModeStash: deps.captureVideoSubModeStash,
      sfxModelTypes: deps.sfxModelTypes,
      isMusicModelType: deps.isMusicModelType,
      findResolutionSelection: deps.findResolutionSelection,
      DEFAULT_RECAST_MAPPING: deps.defaultRecastMapping,
    })
  },

  rerollGeneration: async () => {
    await get().loadSettingsFromOutput()
    setTimeout(() => get().startGeneration(), 100)
  },

  rejoinClipGroup: async (groupId) => {
    try {
      const result = await api.rejoinClips(groupId)
      const outputsRes = await fetch('/api/v1/outputs')
      if (outputsRes.ok) {
        const data = await outputsRes.json()
        set({ outputs: data.files || [] })
      }
      const allOutputs = get().outputs
      const newIdx = allOutputs.findIndex(o => o.name === result.filename)
      if (newIdx >= 0) {
        set({ selectedOutput: newIdx })
        get().loadOutputMetadata(result.filename)
      }
    } catch (e) {
      console.error('Failed to rejoin clips:', e)
    }
  },

  deleteSelectedOutput: async () => {
    const outputs = get().filteredOutputs()
    const idx = get().selectedOutput
    const output = outputs[idx]
    if (!output) return

    try {
      await api.deleteOutput(output.name)
      const allOutputs = get().outputs.filter(o => o.name !== output.name)
      const newIdx = Math.min(idx, Math.max(0, allOutputs.length - 1))
      set({ outputs: allOutputs, selectedOutput: newIdx })
      const selection = get().mediaGallerySelectedNames
      if (selection.has(output.name)) {
        const next = new Set(selection)
        next.delete(output.name)
        set({ mediaGallerySelectedNames: next })
      }
      const newFiltered = get().filteredOutputs()
      if (newFiltered[newIdx]) {
        get().loadOutputMetadata(newFiltered[newIdx].name)
      } else {
        set({ selectedOutputMeta: null })
      }
    } catch (e) {
      console.error('Failed to delete output:', e)
    }
  },

  mediaGallerySelectedNames: new Set<string>(),
  setMediaGallerySelectedNames: (next) => {
    set({ mediaGallerySelectedNames: next })
  },
  toggleMediaGallerySelection: (name) => {
    const current = get().mediaGallerySelectedNames
    const next = new Set(current)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    set({ mediaGallerySelectedNames: next })
  },
  toggleMediaGallerySelectionRange: (fromName, toName) => {
    const list = get().filteredOutputs()
    const fromIdx = list.findIndex(o => o.name === fromName)
    const toIdx = list.findIndex(o => o.name === toName)
    if (fromIdx === -1 || toIdx === -1) return
    const start = Math.min(fromIdx, toIdx)
    const end = Math.max(fromIdx, toIdx)
    const next = new Set(get().mediaGallerySelectedNames)
    for (let i = start; i <= end; i++) {
      const file = list[i]
      if (file) next.add(file.name)
    }
    set({ mediaGallerySelectedNames: next })
  },
  selectAllMediaGallery: (names) => {
    set({ mediaGallerySelectedNames: new Set(names) })
  },
  clearMediaGallerySelection: () => {
    set({ mediaGallerySelectedNames: new Set() })
  },
  bulkDeleteSelectedOutputs: async () => {
    const selection = get().mediaGallerySelectedNames
    const names = Array.from(selection)
    if (names.length === 0) return { deleted: 0, failed: 0 }

    const filtered = get().filteredOutputs()
    const filteredNames = new Set(filtered.map(o => o.name))
    const targets = names.filter(n => filteredNames.has(n))
    if (targets.length === 0) {
      set({ mediaGallerySelectedNames: new Set() })
      return { deleted: 0, failed: 0 }
    }

    let deleted = 0
    let failed = 0
    const browsingUploads = get().browsingUploads
    const workspace = browsingUploads ? '__uploads__' : undefined
    const survivors = new Set(targets)
    for (const name of targets) {
      try {
        if (browsingUploads) {
          await api.deleteUpload(name)
        } else {
          await api.deleteOutput(name, workspace)
        }
        survivors.delete(name)
        deleted++
      } catch (e) {
        console.error('Bulk delete failed for', name, e)
        failed++
      }
    }

    if (deleted > 0) {
      const removed = new Set(targets.filter(n => !survivors.has(n)))
      const allOutputs = get().outputs.filter(o => !removed.has(o.name))
      const filteredAfter = get().filteredOutputs().filter(o => !removed.has(o.name))
      const idx = get().selectedOutput
      const newIdx = Math.min(idx, Math.max(0, filteredAfter.length - 1))
      const newSelection = new Set(get().mediaGallerySelectedNames)
      removed.forEach(name => newSelection.delete(name))
      set({
        outputs: allOutputs,
        selectedOutput: newIdx,
        mediaGallerySelectedNames: newSelection,
      })
      const nextVisible = filteredAfter[newIdx]
      if (nextVisible) {
        get().loadOutputMetadata(nextVisible.name)
      } else {
        set({ selectedOutputMeta: null })
      }
    }

    return { deleted, failed }
  },
})
