/**
 * Tests for the projects domain client (feature A17).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { projectsApi } from './projects'
import { ApiError } from './errors'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('projectsApi.list', () => {
  it('maps workspaces to project summaries and hides the implicit default', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      workspaces: [
        { name: 'default', modified: 100 },
        { name: 'my-film', modified: 1700000000, setup: { director_skill: 'short_film' } },
        { name: 'clip', modified: null },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const projects = await projectsApi.list()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/workspaces', expect.objectContaining({ cache: 'no-store' }))
    expect(projects).toEqual([
      { id: 'my-film', name: 'my-film', type: 'short-film', updatedAt: new Date(1700000000 * 1000).toISOString() },
      { id: 'clip', name: 'clip', type: 'music-video', updatedAt: new Date(0).toISOString() },
    ])
  })

  it('propagates the abort signal to the transport', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ workspaces: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await projectsApi.list(controller.signal)
    const calls = fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>
    expect(calls[0][1].signal).toBe(controller.signal)
  })

  it('converts error responses into ApiError (A15 contract)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 'workspace.failed', message: 'nope', operationId: 'op-1' }, 500)))
    await expect(projectsApi.list()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'workspace.failed',
      status: 500,
    })
  })
})

describe('projectsApi.create', () => {
  it('posts the project name through the transport', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    await projectsApi.create({ name: 'new-film', type: 'music-video' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/workspaces', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'new-film' }),
    }))
  })

  it('rejects with ApiError when the backend refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'exists' }, 409)))
    await expect(projectsApi.create({ name: 'x', type: 'custom' })).rejects.toBeInstanceOf(ApiError)
  })
})
