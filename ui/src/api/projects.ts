// Projects domain client (feature A17).
//
// Sits on top of the secure transport (`apiFetch` from A01 — no
// window.fetch monkey-patch) and the standardized error contract
// (`ensureOk` from A15). Every call accepts an AbortSignal so each
// request owns its cancellation.

import { apiFetch } from './transport'
import { ensureOk } from './errors'
import type { ProjectSummary, ProjectType } from '../types/projects'

/** Raw workspace row as returned by GET /api/v1/workspaces (the
 *  backend calls projects "workspaces"). */
interface WorkspaceRow {
  name: string
  modified?: number | null
  setup?: { director_skill?: string }
}

function toSummary(row: WorkspaceRow): ProjectSummary {
  const type: ProjectType = row.setup?.director_skill === 'short_film' ? 'short-film' : 'music-video'
  return {
    id: row.name,
    name: row.name,
    type,
    updatedAt: row.modified ? new Date(row.modified * 1000).toISOString() : new Date(0).toISOString(),
  }
}

export const projectsApi = {
  async list(signal?: AbortSignal): Promise<ProjectSummary[]> {
    const res = await ensureOk(await apiFetch('/api/v1/workspaces', { cache: 'no-store', signal }))
    const body = (await res.json()) as { workspaces?: WorkspaceRow[] }
    // The implicit `default` workspace is a backend compatibility
    // bucket, not a user-facing project — never expose it here.
    return (body.workspaces ?? [])
      .filter((row) => row.name !== 'default')
      .map(toSummary)
  },

  async create(payload: { name: string; type: ProjectType }, signal?: AbortSignal): Promise<void> {
    // `type` is carried by the contract; the backend currently only
    // accepts the folder name (skill selection is persisted through
    // the project-setup endpoint afterwards).
    await ensureOk(await apiFetch('/api/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: payload.name }),
      signal,
    }))
  },
}
