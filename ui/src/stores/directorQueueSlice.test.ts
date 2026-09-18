/**
 * Tests for the Director Queue slice.
 *
 * The slice is built around a small set of pure state transitions
 * and HTTP calls. We mock the API client so the slice logic can be
 * exercised in isolation.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { create } from 'zustand'

import { createDirectorQueueSlice } from './directorQueueSlice'

const apiMocks = {
  fetchDirectorQueue: vi.fn(),
  enqueueDirectorPipeline: vi.fn(),
  updateDirectorQueueEntry: vi.fn(),
  deleteDirectorQueueEntry: vi.fn(),
  startDirectorQueue: vi.fn(),
  pauseDirectorQueue: vi.fn(),
  reorderDirectorQueue: vi.fn(),
}

vi.mock('../api/client', () => apiMocks)

type TestStore = ReturnType<typeof createTestStore>

function createTestStore() {
  return create<ReturnType<typeof createDirectorQueueSlice>>()(
    (...a) => ({
      ...createDirectorQueueSlice(...a),
    }),
  )
}

describe('directorQueueSlice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('starts with empty queue state', () => {
    const store = createTestStore()
    expect(store.getState().directorQueue).toBeNull()
    expect(store.getState().directorQueueLoading).toBe(false)
    expect(store.getState().directorQueueEditingEntryId).toBeNull()
  })

  it('loads the queue from the API', async () => {
    apiMocks.fetchDirectorQueue.mockResolvedValue({
      version: 1,
      paused: false,
      running: false,
      entries: [{ id: 'e1' }],
    })
    const store = createTestStore()
    await store.getState().loadDirectorQueue()
    const state = store.getState()
    expect(state.directorQueue?.entries).toHaveLength(1)
    expect(state.directorQueueLoading).toBe(false)
  })

  it('clears loading flag when load fails', async () => {
    apiMocks.fetchDirectorQueue.mockRejectedValue(new Error('boom'))
    const store = createTestStore()
    await expect(store.getState().loadDirectorQueue()).rejects.toThrow('boom')
    expect(store.getState().directorQueueLoading).toBe(false)
  })

  it('adds an entry and reloads the queue', async () => {
    apiMocks.enqueueDirectorPipeline.mockResolvedValue({})
    apiMocks.fetchDirectorQueue.mockResolvedValue({
      version: 1,
      paused: false,
      running: false,
      entries: [{ id: 'e2' }],
    })
    const store = createTestStore()
    await store.getState().addDirectorQueueEntry({ pipeline_id: 'p1' })
    expect(apiMocks.enqueueDirectorPipeline).toHaveBeenCalledWith({ pipeline_id: 'p1' })
    expect(store.getState().directorQueue?.entries[0].id).toBe('e2')
  })

  it('removes entry and clears editing id', async () => {
    apiMocks.deleteDirectorQueueEntry.mockResolvedValue(undefined)
    apiMocks.fetchDirectorQueue.mockResolvedValue({
      version: 1,
      paused: false,
      running: false,
      entries: [],
    })
    const store = createTestStore()
    store.setState({ directorQueueEditingEntryId: 'e1' })
    await store.getState().deleteDirectorQueueEntry('e1')
    expect(store.getState().directorQueueEditingEntryId).toBeNull()
    expect(apiMocks.deleteDirectorQueueEntry).toHaveBeenCalledWith('e1')
  })

  it('start and pause toggle the runner', async () => {
    apiMocks.startDirectorQueue.mockResolvedValue({ version: 1, paused: false, running: true, entries: [] })
    apiMocks.pauseDirectorQueue.mockResolvedValue({ version: 1, paused: true, running: false, entries: [] })
    const store = createTestStore()
    await store.getState().startDirectorQueue()
    expect(store.getState().directorQueueLoading).toBe(false)
    await store.getState().pauseDirectorQueue()
    expect(store.getState().directorQueueLoading).toBe(false)
  })

  it('reorder triggers refetch', async () => {
    apiMocks.reorderDirectorQueue.mockResolvedValue(undefined)
    apiMocks.fetchDirectorQueue.mockResolvedValue({
      version: 1,
      paused: false,
      running: false,
      entries: [{ id: 'e3' }],
    })
    const store = createTestStore()
    await store.getState().reorderDirectorQueue(['e3'])
    expect(apiMocks.reorderDirectorQueue).toHaveBeenCalledWith(['e3'])
    expect(store.getState().directorQueue?.entries[0].id).toBe('e3')
  })

  it('setDirectorQueueEditingEntryId updates the field', () => {
    const store = createTestStore()
    store.getState().setDirectorQueueEditingEntryId('e42')
    expect(store.getState().directorQueueEditingEntryId).toBe('e42')
    store.getState().setDirectorQueueEditingEntryId(null)
    expect(store.getState().directorQueueEditingEntryId).toBeNull()
  })
})
