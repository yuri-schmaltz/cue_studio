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
 * Why the queue client lives in `api/queue.ts`
 * --------------------------------------------
 * The monolithic `api/client` (3K LOC) still carries the legacy
 * queue functions; the Director Queue endpoints are served here by
 * the domain-split client built in A17 on top of the secure
 * transport. It exposes one plain function per endpoint, so the test
 * mock surface (`vi.mock('../api/queue')`) works exactly like
 * before.
 */

import type { StateCreator } from 'zustand'
import { queueApi } from '../api/queue'

import type { DirectorQueueEntry } from '../types'
import type { AppState } from './useStore'

export type DirectorQueueSlice = Pick<AppState,
  | 'directorQueue'
  | 'directorQueueLoading'
  | 'directorQueueEditingEntryId'
  | 'loadDirectorQueue'
  | 'startDirectorQueue'
  | 'pauseDirectorQueue'
  | 'removeDirectorQueueEntry'
  | 'moveDirectorQueueEntry'
  | 'queueCurrentDirectorPipeline'
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
      const queue = await queueApi.fetch()
      set({ directorQueue: queue, directorQueueLoading: false })
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  addDirectorQueueEntry: async (params: Record<string, unknown>) => {
    set({ directorQueueLoading: true })
    try {
      await queueApi.enqueue(params)
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
      await queueApi.update(entryId, patch)
      await get().loadDirectorQueue()
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  deleteDirectorQueueEntry: async (entryId: string) => {
    set({ directorQueueLoading: true })
    try {
      await queueApi.remove(entryId)
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

  removeDirectorQueueEntry: async (entryId: string) => {
    set({ directorQueueLoading: true })
    try {
      await queueApi.remove(entryId)
      if (get().directorQueueEditingEntryId === entryId) {
        set({ directorQueueEditingEntryId: null })
      }
      await get().loadDirectorQueue()
    } catch (e) {
      set({
        directorQueueLoading: false,
        directorError: e instanceof Error ? e.message : 'Failed to remove queued project',
      })
    }
  },

  moveDirectorQueueEntry: async (entryId: string, direction: -1 | 1) => {
    const queue = get().directorQueue
    if (!queue) return
    const ids = queue.entries.map(entry => entry.id)
    const from = ids.indexOf(entryId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    set({ directorQueueLoading: true })
    try {
      const updated = await queueApi.reorder(ids)
      set({ directorQueue: updated, directorQueueLoading: false })
    } catch (e) {
      set({
        directorQueueLoading: false,
        directorError: e instanceof Error ? e.message : 'Failed to reorder Director queue',
      })
    }
  },

  startDirectorQueue: async () => {
    set({ directorQueueLoading: true })
    try {
      const queue = await queueApi.start()
      set({
        directorQueue: queue,
        directorQueueLoading: false,
        directorQueueEditingEntryId: null,
      })
    } catch (err) {
      set({
        directorQueueLoading: false,
        directorError: err instanceof Error ? err.message : 'Failed to start queue',
      })
      throw err
    }
  },

  pauseDirectorQueue: async () => {
    set({ directorQueueLoading: true })
    try {
      const queue = await queueApi.pause()
      set({ directorQueue: queue, directorQueueLoading: false })
    } catch (err) {
      set({
        directorQueueLoading: false,
        directorError: err instanceof Error ? err.message : 'Failed to pause queue',
      })
      throw err
    }
  },

  reorderDirectorQueue: async (entryIds: string[]) => {
    set({ directorQueueLoading: true })
    try {
      await queueApi.reorder(entryIds)
      await get().loadDirectorQueue()
    } catch (err) {
      set({ directorQueueLoading: false })
      throw err
    }
  },

  queueCurrentDirectorPipeline: async () => {
    await get().startDirectorPipeline('queue')
  },

  setDirectorQueueEditingEntryId: (entryId: string | null) => {
    set({ directorQueueEditingEntryId: entryId })
  },
})

export type { DirectorQueueEntry }
