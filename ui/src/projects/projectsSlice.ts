// Projects slice (feature A17).
//
// Owns the project list state with explicit request cancellation:
//
// - each `fetch` gets its own `AbortController` (cancelled by `cancel`
//   or implicitly by a newer fetch),
// - late responses are discarded: a response only lands in the store
//   if it is still the newest request (sequence check), so a slow
//   response can never overwrite the state of a newer scope,
// - failures surface as the standardized `ApiError` (A15).
//
// The slice is standalone (its own zustand store via
// `useProjectsStore.ts`); `useStore.ts` is untouched, per the
// incremental-migration plan of A17.

import type { StateCreator } from 'zustand'

import { ApiError } from '../api/errors'
import { projectsApi } from '../api/projects'
import type { ProjectSummary } from '../types/projects'

export interface ProjectsSlice {
  byId: Record<string, ProjectSummary>
  loading: boolean
  error?: ApiError
  fetch(signal?: AbortSignal): Promise<void>
  cancel(): void
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

export const createProjectsSlice: StateCreator<ProjectsSlice, [], [], ProjectsSlice> = (set, get) => {
  let controller: AbortController | null = null
  let sequence = 0

  return {
    byId: {},
    loading: false,

    fetch: async (signal?: AbortSignal) => {
      // A new fetch supersedes any request still in flight.
      controller?.abort()
      const local = new AbortController()
      controller = local
      const mySequence = ++sequence
      if (signal) {
        if (signal.aborted) local.abort()
        else signal.addEventListener('abort', () => local.abort(), { once: true })
      }
      set({ loading: true, error: undefined })
      try {
        const list = await projectsApi.list(local.signal)
        if (mySequence !== sequence) return // superseded — discard late response
        const byId: Record<string, ProjectSummary> = {}
        for (const project of list) byId[project.id] = project
        set({ byId, loading: false, error: undefined })
      } catch (err) {
        if (mySequence !== sequence) return // superseded — discard late failure
        if (local.signal.aborted || isAbortError(err)) return
        set({
          loading: false,
          error: err instanceof ApiError
            ? err
            : new ApiError({ message: err instanceof Error ? err.message : 'Failed to load projects' }, 0),
        })
      } finally {
        if (controller === local) controller = null
      }
    },

    cancel: () => {
      controller?.abort()
      controller = null
      if (get().loading) set({ loading: false })
    },
  }
}
