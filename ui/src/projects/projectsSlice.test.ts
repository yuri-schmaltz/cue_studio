/**
 * Tests for the projects slice (feature A17): loading, standardized
 * errors, explicit cancellation and late-response discarding.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'

import { createProjectsSlice } from './projectsSlice'
import type { ProjectsSlice } from './projectsSlice'
import { ApiError } from '../api/errors'
import type { ProjectSummary } from '../types/projects'

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('../api/projects', () => ({ projectsApi: apiMocks }))

function createTestStore() {
  return create<ProjectsSlice>()((...args) => createProjectsSlice(...args))
}

const PROJECT: ProjectSummary = { id: 'abc', name: 'abc', type: 'music-video', updatedAt: '2026-01-01T00:00:00.000Z' }

describe('projectsSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.list.mockResolvedValue([PROJECT])
    apiMocks.create.mockResolvedValue(undefined)
  })

  it('starts empty', () => {
    const store = createTestStore()
    expect(store.getState().byId).toEqual({})
    expect(store.getState().loading).toBe(false)
    expect(store.getState().error).toBeUndefined()
  })

  it('loads projects into byId', async () => {
    const store = createTestStore()
    await store.getState().fetch()
    expect(store.getState().byId).toEqual({ abc: PROJECT })
    expect(store.getState().loading).toBe(false)
    expect(store.getState().error).toBeUndefined()
  })

  it('surfaces failures as ApiError', async () => {
    apiMocks.list.mockRejectedValue(new ApiError({ code: 'workspace.failed', message: 'nope' }, 500))
    const store = createTestStore()
    await store.getState().fetch()
    expect(store.getState().loading).toBe(false)
    expect(store.getState().error?.code).toBe('workspace.failed')
  })

  it('wraps non-ApiError failures too', async () => {
    apiMocks.list.mockRejectedValue(new Error('network down'))
    const store = createTestStore()
    await store.getState().fetch()
    expect(store.getState().error).toBeInstanceOf(ApiError)
    expect(store.getState().error?.message).toBe('network down')
  })

  it('cancel() aborts the in-flight request and clears loading', async () => {
    apiMocks.list.mockImplementation((signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const store = createTestStore()
    const pending = store.getState().fetch()
    store.getState().cancel()
    await pending
    expect(store.getState().loading).toBe(false)
    expect(store.getState().error).toBeUndefined()
    expect(store.getState().byId).toEqual({})
  })

  it('discards a late response superseded by a newer fetch', async () => {
    const slow = Promise.resolve([PROJECT])
    const fast = Promise.resolve([{ ...PROJECT, id: 'xyz', name: 'xyz' }])
    apiMocks.list.mockReturnValueOnce(slow).mockReturnValueOnce(fast)
    const store = createTestStore()
    const first = store.getState().fetch()
    const second = store.getState().fetch()
    await second
    await first
    expect(store.getState().byId).toEqual({ xyz: { ...PROJECT, id: 'xyz', name: 'xyz' } })
    expect(store.getState().loading).toBe(false)
  })

  it('passes an abort signal per request', async () => {
    const store = createTestStore()
    await store.getState().fetch()
    const signal = apiMocks.list.mock.calls[0][0] as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })
})
