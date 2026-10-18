/**
 * Tests for the work dashboard summary builder (feature A11).
 *
 * The backend has no aggregation endpoint, so `buildDashboardSummary`
 * IS the aggregation logic — these tests pin down its derivations:
 * continue card, queue filtering, action gating and output capping.
 */

import { describe, expect, it } from 'vitest'

import type { Workspace } from '../api/client'
import type { DirectorQueueEntry, GenerationJob, OutputFile } from '../types'
import { buildDashboardSummary, type DashboardSummaryInput } from './summary'
import { MAX_RECENT_OUTPUTS } from './types'

function workspace(name: string, modified?: number): Workspace {
  return { name, path: `/tmp/${name}`, ...(modified != null ? { modified } : {}) }
}

function job(overrides: Partial<GenerationJob> & { status: GenerationJob['status'] }): GenerationJob {
  return {
    id: 'job-1',
    progress: 0,
    step: 0,
    totalSteps: 1,
    phase: 'Sampling',
    message: '',
    outputFiles: [],
    error: null,
    ...overrides,
  }
}

function directorEntry(
  overrides: Partial<DirectorQueueEntry> & { status: DirectorQueueEntry['status'] },
): DirectorQueueEntry {
  return {
    id: 'entry-1',
    message: '',
    created_at: 0,
    scene_description: 'Foggy mountain',
    pipeline_type: 'full_scene',
    image_model: 'flux',
    video_model: 'ltx',
    ...overrides,
  }
}

function output(index: number, created_at: number): OutputFile {
  return {
    name: `out-${index}.png`,
    url: `/api/v1/files/out-${index}.png`,
    type: 'image',
    mode: null,
    favorite: false,
    size: 1024,
    created_at,
  }
}

function input(overrides: Partial<DashboardSummaryInput> = {}): DashboardSummaryInput {
  return {
    workspaces: [],
    activeWorkspace: 'default',
    jobs: [],
    directorEntries: [],
    outputs: [],
    ...overrides,
  }
}

describe('buildDashboardSummary', () => {
  it('derives nothing but projectCount=0 on an empty store', () => {
    const summary = buildDashboardSummary(input())
    expect(summary.continueProject).toBeNull()
    expect(summary.queue).toEqual([])
    expect(summary.recentOutputs).toEqual([])
    expect(summary.projectCount).toBe(0)
  })

  it('excludes the implicit default workspace from projectCount and continue', () => {
    const summary = buildDashboardSummary(input({
      workspaces: [workspace('default', 500)],
    }))
    expect(summary.projectCount).toBe(0)
    expect(summary.continueProject).toBeNull()
  })

  it('picks the most recently modified project for the continue card', () => {
    const summary = buildDashboardSummary(input({
      workspaces: [
        workspace('old-film', 100),
        workspace('new-film', 900),
        workspace('middle-film', 500),
      ],
      activeWorkspace: 'default',
    }))
    expect(summary.projectCount).toBe(3)
    expect(summary.continueProject?.name).toBe('new-film')
    expect(summary.continueProject?.section).toBe('director')
  })

  it('prefers the active project when it is a real workspace', () => {
    const summary = buildDashboardSummary(input({
      workspaces: [
        workspace('old-film', 100),
        workspace('new-film', 900),
      ],
      activeWorkspace: 'old-film',
    }))
    expect(summary.continueProject?.name).toBe('old-film')
  })

  it('keeps only active queue items from both sources', () => {
    const summary = buildDashboardSummary(input({
      jobs: [
        job({ id: 'running-1', status: 'running' }),
        job({ id: 'held-1', status: 'held' }),
        job({ id: 'done-1', status: 'completed' }),
        job({ id: 'failed-1', status: 'failed' }),
      ],
      directorEntries: [
        directorEntry({ id: 'review-1', status: 'awaiting_review' }),
        directorEntry({ id: 'finished-1', status: 'completed' }),
      ],
    }))
    expect(summary.queue.map(item => item.id)).toEqual([
      'running-1',
      'held-1',
      'review-1',
    ])
  })

  it('normalizes states and gates the row action through the A14 contract', () => {
    const summary = buildDashboardSummary(input({
      jobs: [
        job({ id: 'held-1', status: 'held', phase: 'Queued' }),
        job({ id: 'running-1', status: 'running', phase: 'Sampling' }),
      ],
      directorEntries: [
        directorEntry({ id: 'review-1', status: 'awaiting_review' }),
        directorEntry({ id: 'queued-1', status: 'queued', scene_description: '' }),
      ],
    }))
    const byId = Object.fromEntries(summary.queue.map(item => [item.id, item]))
    expect(byId['held-1'].status).toBe('queued')
    expect(byId['held-1'].action?.kind).toBe('cancel')
    expect(byId['running-1'].status).toBe('running')
    expect(byId['running-1'].label).toBe('Sampling')
    expect(byId['review-1'].status).toBe('awaiting_review')
    expect(byId['review-1'].action?.kind).toBe('review')
    // No scene description → pipeline type label, cancel still allowed.
    expect(byId['queued-1'].label).toBe('full scene project')
    expect(byId['queued-1'].action?.kind).toBe('cancel')
  })

  it('sorts recent outputs newest-first and caps them at MAX_RECENT_OUTPUTS', () => {
    const outputs = Array.from({ length: MAX_RECENT_OUTPUTS + 5 }, (_, index) =>
      output(index, 100 + index),
    )
    const summary = buildDashboardSummary(input({ outputs }))
    expect(summary.recentOutputs).toHaveLength(MAX_RECENT_OUTPUTS)
    // Newest first.
    expect(summary.recentOutputs[0].id).toBe(`out-${MAX_RECENT_OUTPUTS + 4}.png`)
    expect(summary.recentOutputs[MAX_RECENT_OUTPUTS - 1].id)
      .toBe(`out-${5}.png`)
  })

  it('tags outputs with the active workspace as their project', () => {
    const summary = buildDashboardSummary(input({
      activeWorkspace: 'some-film',
      outputs: [output(1, 100)],
    }))
    expect(summary.recentOutputs[0].projectId).toBe('some-film')
  })
})
