/**
 * Tests for the LLM lifecycle slice.
 *
* Ported from the standalone ``scripts/test-llm-slice.mjs`` harness
 * (esbuild bundle + ``assert``) so ``npm run test`` is the single
 * frontend test entrypoint (feature A06). The API client is mocked
 * the same way ``directorQueueSlice.test.ts`` does it, keeping the
 * slice logic testable in isolation from the network.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { create } from 'zustand'

import { createLlmSlice } from './llmSlice'
import type { LlmSlice } from './llmSlice'

const apiMocks = vi.hoisted(() => ({
  fetchLlmStatus: vi.fn(),
  fetchLlmModels: vi.fn(),
  fetchLlmRoles: vi.fn(),
  updateLlmRoles: vi.fn(),
  testLlmConnection: vi.fn(),
  loadLlm: vi.fn(),
  unloadLlm: vi.fn(),
}))

vi.mock('../api/client', () => apiMocks)

function createTestStore() {
  // The slice creator is typed against the full `AppState`; for an
  // isolated slice store we only keep the slice surface, so the
  // zustand `set` plumbing is cast down to `never` to satisfy the
  // creator's parameter types.
  return create<LlmSlice>()((set, _get, api) =>
    createLlmSlice(set as never, _get as never, api as never),
  )
}

describe('llmSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.fetchLlmStatus.mockResolvedValue({
      loaded: false, model_id: null, device: null, provider: '',
    })
    apiMocks.fetchLlmModels.mockResolvedValue({ models: [] })
    apiMocks.fetchLlmRoles.mockResolvedValue(null)
    apiMocks.updateLlmRoles.mockResolvedValue(null)
    apiMocks.testLlmConnection.mockResolvedValue({ status: 'ok', latency_ms: 1 })
    apiMocks.loadLlm.mockResolvedValue({
      loaded: true, model_id: 'm1', device: 'cuda', provider: 'transformers',
    })
    apiMocks.unloadLlm.mockResolvedValue(undefined)
  })

  it('starts with empty initial state', () => {
    const store = createTestStore()
    const s = store.getState()
    expect(s.llmStatus).toBeNull()
    expect(s.llmLoading).toBe(false)
    expect(s.llmModels).toEqual([])
    expect(s.llmRoles).toBeNull()
  })

  it('exposes the lifecycle actions', () => {
    const s = createTestStore().getState()
    for (const name of [
      'loadLlmStatus',
      'loadLlmModels',
      'loadLlmRoles',
      'saveLlmRoles',
      'testServerConnection',
      'loadLlm',
      'unloadLlm',
    ] as const) {
      expect(typeof s[name], `${name} must be a function`).toBe('function')
    }
  })

  it('loadLlmStatus stores the fetched status', async () => {
    apiMocks.fetchLlmStatus.mockResolvedValue({
      loaded: true, model_id: 'm1', device: 'cuda', provider: 'transformers',
    })
    const store = createTestStore()
    await store.getState().loadLlmStatus()
    expect(store.getState().llmStatus?.model_id).toBe('m1')
  })

  it('loadLlmModels stores the model list', async () => {
    apiMocks.fetchLlmModels.mockResolvedValue({ models: [{ id: 'm1' }] })
    const store = createTestStore()
    await store.getState().loadLlmModels()
    expect(store.getState().llmModels).toHaveLength(1)
  })

  it('loadLlm toggles the loading flag and stores the status', async () => {
    const store = createTestStore()
    await store.getState().loadLlm()
    expect(store.getState().llmLoading).toBe(false)
    expect(store.getState().llmStatus?.loaded).toBe(true)
  })

  it('loadLlm clears the loading flag when the call fails', async () => {
    apiMocks.loadLlm.mockRejectedValue(new Error('boom'))
    const store = createTestStore()
    await store.getState().loadLlm()
    expect(store.getState().llmLoading).toBe(false)
    expect(store.getState().llmStatus).toBeNull()
  })

  it('unloadLlm marks the status as unloaded', async () => {
    const store = createTestStore()
    await store.getState().loadLlm()
    await store.getState().unloadLlm()
    expect(store.getState().llmStatus?.loaded).toBe(false)
  })
})
