// Director Queue domain client (feature A17).
//
// Domain-split replacement for the queue functions in `client.ts`,
// routed through the secure transport (`apiFetch`) and the
// standardized error contract (`ensureOk`). Every call accepts an
// AbortSignal so the owning slice can cancel explicitly.

import { apiFetch } from './transport'
import { ensureOk } from './errors'
import type { DirectorQueueEntryDetail, DirectorQueueState } from '../types'

const QUEUE_URL = '/api/v1/director/queue'

async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await ensureOk(await apiFetch(path, { ...init, signal }))
  return (await res.json()) as T
}

export const queueApi = {
  fetch(signal?: AbortSignal): Promise<DirectorQueueState> {
    return request<DirectorQueueState>(QUEUE_URL, { cache: 'no-store' }, signal)
  },

  enqueue(params: Record<string, unknown>, signal?: AbortSignal): Promise<DirectorQueueState> {
    return request<DirectorQueueState>(QUEUE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
    }, signal)
  },

  start(signal?: AbortSignal): Promise<DirectorQueueState> {
    return request<DirectorQueueState>(`${QUEUE_URL}/start`, { method: 'POST' }, signal)
  },

  pause(signal?: AbortSignal): Promise<DirectorQueueState> {
    return request<DirectorQueueState>(`${QUEUE_URL}/pause`, { method: 'POST' }, signal)
  },

  getEntry(entryId: string, signal?: AbortSignal): Promise<DirectorQueueEntryDetail> {
    return request<DirectorQueueEntryDetail>(`${QUEUE_URL}/${encodeURIComponent(entryId)}`, { cache: 'no-store' }, signal)
  },

  update(entryId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<DirectorQueueState> {
    return request<DirectorQueueState>(`${QUEUE_URL}/${encodeURIComponent(entryId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
    }, signal)
  },

  async remove(entryId: string, signal?: AbortSignal): Promise<void> {
    await ensureOk(await apiFetch(`${QUEUE_URL}/${encodeURIComponent(entryId)}`, { method: 'DELETE', signal }))
  },

  reorder(entryIds: string[], signal?: AbortSignal): Promise<DirectorQueueState> {
    return request<DirectorQueueState>(`${QUEUE_URL}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_ids: entryIds }),
    }, signal)
  },
}
