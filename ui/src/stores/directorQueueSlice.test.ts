/**
 * Tests for the Director Queue slice.
 *
 * The slice is built around a small set of pure state transitions
 * and HTTP calls. We mock the domain-split queue client so the slice
 * logic can be exercised in isolation. Vitest's `vi.mock` happens
 * once at module load; we wire each test's expected return value via
 * the ``apiMocks`` object so we don't have to re-mock per ``it``
 * block.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { create } from 'zustand'

import { createDirectorQueueSlice } from './directorQueueSlice'
import type { DirectorQueueSlice } from './directorQueueSlice'

const apiMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  enqueue: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
  reorder: vi.fn(),
}))

vi.mock('../api/queue', () => ({ queueApi: apiMocks }))

function createTestStore() {
  // The slice creator is typed against the full `AppState`; for an
  // isolated slice store we only keep the slice surface, so the
  // zustand `set`/`get` plumbing is cast down to `never` to satisfy
  // the creator's parameter types.
  return create<DirectorQueueSlice>()((set, get, api) =>
    createDirectorQueueSlice(set as never, get as never, api as never),
  )
}

const EMPTY_QUEUE = { version: 1, paused: false, running: false, entries: [] }

describe('directorQueueSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default behaviour: every endpoint resolves with an empty queue
    // snapshot. Individual tests override the relevant function for
    // their specific assertion.
    apiMocks.fetch.mockResolvedValue(EMPTY_QUEUE)
    apiMocks.enqueue.mockResolvedValue(EMPTY_QUEUE)
    apiMocks.update.mockResolvedValue(EMPTY_QUEUE)
    apiMocks.remove.mockResolvedValue(EMPTY_QUEUE)
    apiMocks.start.mockResolvedValue(EMPTY_QUEUE)
    apiMocks.pause.mockResolvedValue(EMPTY_QUEUE)
    apiMocks.reorder.mockResolvedValue(EMPTY_QUEUE)
  })

  it('starts with empty queue state', () => {
    const store = createTestStore()
    expect(store.getState().directorQueue).toBeNull()
    expect(store.getState().directorQueueLoading).toBe(false)
    expect(store.getState().directorQueueEditingEntryId).toBeNull()
  })

  it('loads the queue from the API', async () => {
    apiMocks.fetch.mockResolvedValue({
      version: 1, paused: false, running: false, entries: [{ id: 'e1' }],
    })
    const store = createTestStore()
    await store.getState().loadDirectorQueue()
    const state = store.getState()
    expect(state.directorQueue?.entries).toHaveLength(1)
    expect(state.directorQueueLoading).toBe(false)
  })

  it('clears loading flag when load fails', async () => {
    apiMocks.fetch.mockRejectedValue(new Error('boom'))
    const store = createTestStore()
    await expect(store.getState().loadDirectorQueue()).rejects.toThrow('boom')
    expect(store.getState().directorQueueLoading).toBe(false)
  })

  it('adds an entry and reloads the queue', async () => {
    apiMocks.enqueue.mockResolvedValue(EMPTY_QUEUE)
    apiMocks.fetch.mockResolvedValue({
      version: 1, paused: false, running: false, entries: [{ id: 'e2' }],
    })
    const store = createTestStore()
    await store.getState().addDirectorQueueEntry({ pipeline_id: 'p1' })
    expect(apiMocks.enqueue).toHaveBeenCalledWith({ pipeline_id: 'p1' })
    expect(store.getState().directorQueue?.entries[0].id).toBe('e2')
  })

  it('removes entry and clears editing id', async () => {
    const store = createTestStore()
    store.setState({ directorQueueEditingEntryId: 'e1' })
    await store.getState().deleteDirectorQueueEntry('e1')
    expect(store.getState().directorQueueEditingEntryId).toBeNull()
    expect(apiMocks.remove).toHaveBeenCalledWith('e1')
  })

  it('start and pause toggle the runner', async () => {
    apiMocks.start.mockResolvedValue({
      version: 1, paused: false, running: true, entries: [],
    })
    apiMocks.pause.mockResolvedValue({
      version: 1, paused: true, running: false, entries: [],
    })
    const store = createTestStore()
    await store.getState().startDirectorQueue()
    expect(store.getState().directorQueueLoading).toBe(false)
    await store.getState().pauseDirectorQueue()
    expect(store.getState().directorQueueLoading).toBe(false)
  })

  it('reorder triggers refetch', async () => {
    apiMocks.reorder.mockResolvedValue(EMPTY_QUEUE)
    apiMocks.fetch.mockResolvedValue({
      version: 1, paused: false, running: false, entries: [{ id: 'e3' }],
    })
    const store = createTestStore()
    await store.getState().reorderDirectorQueue(['e3'])
    expect(apiMocks.reorder).toHaveBeenCalledWith(['e3'])
    expect(store.getState().directorQueue?.entries[0].id).toBe('e3')
  })

  it('removes entry via removeDirectorQueueEntry and clears editing id', async () => {
    const store = createTestStore()
    store.setState({ directorQueueEditingEntryId: 'e1' })
    await store.getState().removeDirectorQueueEntry('e1')
    expect(store.getState().directorQueueEditingEntryId).toBeNull()
    expect(apiMocks.remove).toHaveBeenCalledWith('e1')
  })

  it('moves entry directionally via moveDirectorQueueEntry', async () => {
    const store = createTestStore()
    store.setState({
      directorQueue: {
        version: 1,
        paused: false,
        running: false,
        entries: [{ id: 'e1' }, { id: 'e2' }] as never,
      },
    })
    apiMocks.reorder.mockResolvedValue({
      version: 1,
      paused: false,
      running: false,
      entries: [{ id: 'e2' }, { id: 'e1' }],
    })
    await store.getState().moveDirectorQueueEntry('e1', 1)
    expect(apiMocks.reorder).toHaveBeenCalledWith(['e2', 'e1'])
    expect(store.getState().directorQueue?.entries[0].id).toBe('e2')
  })

  it('setDirectorQueueEditingEntryId updates the field', () => {
    const store = createTestStore()
    store.getState().setDirectorQueueEditingEntryId('e42')
    expect(store.getState().directorQueueEditingEntryId).toBe('e42')
    store.getState().setDirectorQueueEditingEntryId(null)
    expect(store.getState().directorQueueEditingEntryId).toBeNull()
  })
})
