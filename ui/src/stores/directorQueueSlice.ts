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
 * Notes for integrators
 * ---------------------
 * * The slice imports `api` lazily inside each action — keeps the
 *   cold-boot cost of the store zero when the user is on a screen
 *   that doesn't touch the queue.
 * * All write actions normalize the result by reloading the queue so
 *   the UI never diverges from the server.
 */

import type { StateCreator } from 'zustand'

import type { DirectorQueueEntry } from '../types'
import type { AppState } from './useStore'

export type DirectorQueueSlice = Pick<AppState,
  | 'directorQueue'
  | 'directorQueueLoading'
  | 'directorQueueEditingEntryId'
  | 'loadDirectorQueue'
  | 'addDirectorQueueEntry'
  | 'updateDirectorQueueEntry'
  | 'deleteDirectorQueueEntry'
  | 'startDirectorQueue'
  | 'pauseDirectorQueue'
  | 'reorderDirectorQueue'
  | 'setDirectorQueueEditingEntryId'
>

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
      const { fetchDirectorQueue } = await import('../api/client')
      const queue = await fetchDirectorQueue()
      set({ directorQueue: queue, directorQueueLoading: false })
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  addDirectorQueueEntry: async (params) => {
    set({ directorQueueLoading: true })
    try {
      const { enqueueDirectorPipeline } = await import('../api/client')
      await enqueueDirectorPipeline(params)
      await get().loadDirectorQueue()
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  updateDirectorQueueEntry: async (entryId, patch) => {
    set({ directorQueueLoading: true })
    try {
      const { updateDirectorQueueEntry } = await import('../api/client')
      await updateDirectorQueueEntry(entryId, patch)
      await get().loadDirectorQueue()
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  deleteDirectorQueueEntry: async (entryId) => {
    set({ directorQueueLoading: true })
    try {
      const { deleteDirectorQueueEntry } = await import('../api/client')
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
      const { startDirectorQueue } = await import('../api/client')
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
      const { pauseDirectorQueue } = await import('../api/client')
      await pauseDirectorQueue()
      set({ directorQueueLoading: false })
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  reorderDirectorQueue: async (entryIds) => {
    set({ directorQueueLoading: true })
    try {
      const { reorderDirectorQueue } = await import('../api/client')
      await reorderDirectorQueue(entryIds)
      await get().loadDirectorQueue()
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  setDirectorQueueEditingEntryId: (entryId) => {
    set({ directorQueueEditingEntryId: entryId })
  },
})

export type { DirectorQueueEntry }
