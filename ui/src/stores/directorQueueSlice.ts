/**
 * Director Queue slice.
 *
 * Encapsulates the state that the Director Queue UI needs to render
 * and the actions that hit the `/api/v1/director/queue[/...]` endpoints.
 *
 * Slice fields
 * ------------
 * * `directorQueue`            — current snapshot of the queue
 * * `directorQueueLoading`     — true while a fetch is in flight
 * * `directorQueueEditingEntryId` — id of the entry currently being
 *   inspected / edited inline
 *
 * Slice actions
 * -------------
 * * `loadDirectorQueue`        — reload the queue snapshot
 * * `addDirectorQueueEntry`    — freeze a project revision into the queue
 * * `updateDirectorQueueEntry` — patch an entry (label, priority)
 * * `deleteDirectorQueueEntry` — drop a single entry
 * * `startDirectorQueue`       — start the runner
 * * `pauseDirectorQueue`       — pause the runner
 * * `reorderDirectorQueue`     — reorder by id list
 *
 * This module is the third store cut; the goal is to leave the rest
 * of `useStore.ts` concerned with model lifecycle, generation, and
 * the workspace shell.
 *
 * Why static imports here
 * -----------------------
 * Other slices import the api client lazily because the client pulls
 * in the bundled `api.ts` (3K LOC) and we want to defer that cost.
 * The Director Queue is only ever used on the Queue page, which is
 * not on the cold-boot path. Using a static import here keeps the
 * test mock surface (`vi.mock('../api/client')`) usable; with
 * dynamic imports inside the slice body, vitest cannot intercept
 * the resolution and the test ends up calling the real network.
 */

import type { StateCreator } from 'zustand'
import {
  enqueueDirectorPipeline,
  fetchDirectorQueue,
  updateDirectorQueueEntry,
  deleteDirectorQueueEntry,
  startDirectorQueue,
  pauseDirectorQueue,
  reorderDirectorQueue,
} from '../api/client'

import type { DirectorQueueEntry } from '../types'
import type { AppState } from './useStore'

export type DirectorQueueSlice = Pick<AppState,
  | 'directorQueue'
  | 'directorQueueLoading'
  | 'directorQueueEditingEntryId'
  | 'loadDirectorQueue'
  | 'startDirectorQueue'
  | 'pauseDirectorQueue'
> & {
  addDirectorQueueEntry: (params: Record<string, unknown>) => Promise<void>
  updateDirectorQueueEntry: (
    entryId: string,
    patch: Partial<Pick<DirectorQueueEntry, 'message' | 'pipeline_id'>>
  ) => Promise<void>
  deleteDirectorQueueEntry: (entryId: string) => Promise<void>
  reorderDirectorQueue: (entryIds: string[]) => Promise<void>
  setDirectorQueueEditingEntryId: (entryId: string | null) => void
}

const initialState = {
  directorQueue: null as AppState['directorQueue'],
  directorQueueLoading: false,
  directorQueueEditingEntryId: null as string | null,
}

export const createDirectorQueueSlice: StateCreator<
  AppState,
  [],
  [],
  DirectorQueueSlice
> = (set, get) => ({
  ...initialState,

  loadDirectorQueue: async () => {
    set({ directorQueueLoading: true })
    try {
      const queue = await fetchDirectorQueue()
      set({ directorQueue: queue, directorQueueLoading: false })
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  addDirectorQueueEntry: async (params: Record<string, unknown>) => {
    set({ directorQueueLoading: true })
    try {
      await enqueueDirectorPipeline(params)
      await get().loadDirectorQueue()
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  updateDirectorQueueEntry: async (
    entryId: string,
    patch: Partial<Pick<DirectorQueueEntry, 'message' | 'pipeline_id'>>,
  ) => {
    set({ directorQueueLoading: true })
    try {
      await updateDirectorQueueEntry(entryId, patch)
      await get().loadDirectorQueue()
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  deleteDirectorQueueEntry: async (entryId: string) => {
    set({ directorQueueLoading: true })
    try {
      await deleteDirectorQueueEntry(entryId)
      set({
        directorQueueLoading: false,
        directorQueueEditingEntryId: null,
      })
      await get().loadDirectorQueue()
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  startDirectorQueue: async () => {
    set({ directorQueueLoading: true })
    try {
      await startDirectorQueue()
      set({ directorQueueLoading: false })
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  pauseDirectorQueue: async () => {
    set({ directorQueueLoading: true })
    try {
      await pauseDirectorQueue()
      set({ directorQueueLoading: false })
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  reorderDirectorQueue: async (entryIds: string[]) => {
    set({ directorQueueLoading: true })
    try {
      await reorderDirectorQueue(entryIds)
      await get().loadDirectorQueue()
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  setDirectorQueueEditingEntryId: (entryId: string | null) => {
    set({ directorQueueEditingEntryId: entryId })
  },
})

export type { DirectorQueueEntry }
