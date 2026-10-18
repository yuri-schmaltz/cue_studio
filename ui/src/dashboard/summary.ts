// Work dashboard summary builder (feature A11).
//
// Pure mapping layer: store data in, `DashboardSummary` out. No
// network, no store access — unit-testable with plain fixtures.
//
// The spec's backend aggregation endpoint doesn't exist in this app,
// so every block is derived from state the client already has:
//   - "Continuar" → most recently modified real project (the app has
//     no per-project "briefing aberto" flag; folder mtime is the
//     closest honest signal),
//   - queue → active Studio jobs + active Director entries, normalized
//     through the shared A14 state contract,
//   - recent outputs → newest first, capped at MAX_RECENT_OUTPUTS.

import type { Workspace } from '../api/client'
import type { DirectorQueueEntry, GenerationJob, OutputFile } from '../types'
import { queueAllows, queueStateFor } from '../queue/types'
import {
  MAX_RECENT_OUTPUTS,
  type DashboardQueueItem,
  type DashboardRecentOutput,
  type DashboardSummary,
} from './types'

const ACTIVE_JOB_STATUSES = new Set(['held', 'queued', 'running', 'awaiting_review'])

export interface DashboardSummaryInput {
  workspaces: Workspace[]
  activeWorkspace: string
  jobs: GenerationJob[]
  directorEntries: DirectorQueueEntry[]
  outputs: OutputFile[]
}

function studioJobToItem(job: GenerationJob, index: number): DashboardQueueItem | null {
  const state = queueStateFor(job.status)
  if (!state) return null
  const label = job.phase || job.message || job.kind || 'Studio'
  const action = queueAllows(state, 'cancel')
    ? { label: 'Cancel', kind: 'cancel' as const }
    : null
  return { id: job.id || `studio-${index}`, label, status: state, action }
}

function directorEntryToItem(entry: DirectorQueueEntry): DashboardQueueItem | null {
  const state = queueStateFor(entry.status)
  if (!state) return null
  const label = entry.scene_description || `${entry.pipeline_type.replace(/_/g, ' ')} project`
  const action = queueAllows(state, 'review')
    ? { label: 'Review', kind: 'review' as const }
    : queueAllows(state, 'cancel')
      ? { label: 'Cancel', kind: 'cancel' as const }
      : { label: 'Open', kind: 'open' as const }
  return { id: entry.id, label, status: state, action }
}

export function buildDashboardSummary(input: DashboardSummaryInput): DashboardSummary {
  const projects = input.workspaces.filter(w => w.name !== 'default')

  // Continue card: prefer the active project when it's a real one,
  // otherwise the most recently modified project.
  const newest = [...projects].sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))[0]
  const continueTarget =
    projects.find(w => w.name === input.activeWorkspace) ?? newest ?? null
  const continueProject = continueTarget
    ? {
        id: continueTarget.name,
        name: continueTarget.name,
        section: 'director' as const,
        updatedAt: continueTarget.modified
          ? new Date(continueTarget.modified * 1000).toISOString()
          : new Date(0).toISOString(),
      }
    : null

  // Queue block: only active items — the dashboard must not pollute
  // with finished history (spec acceptance: "não polui quando vazia").
  const studioItems = input.jobs
    .filter(job => ACTIVE_JOB_STATUSES.has(job.status))
    .map((job, index) => studioJobToItem(job, index))
    .filter((item): item is DashboardQueueItem => item !== null)
  const directorItems = input.directorEntries
    .filter(entry => ACTIVE_JOB_STATUSES.has(entry.status))
    .map(directorEntryToItem)
    .filter((item): item is DashboardQueueItem => item !== null)

  const recentOutputs: DashboardRecentOutput[] = [...input.outputs]
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, MAX_RECENT_OUTPUTS)
    .map((output: OutputFile, index) => ({
      id: output.name || `output-${index}`,
      thumb: output.url,
      type: output.type,
      projectId: input.activeWorkspace,
    }))

  return {
    continueProject,
    queue: [...studioItems, ...directorItems],
    recentOutputs,
    projectCount: projects.length,
  }
}
