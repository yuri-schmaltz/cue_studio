// @vitest-environment jsdom
/**
 * Acceptance tests for <QueuePage> (feature A14): one shared label
 * table everywhere, confirm-before-cancel for running jobs, action
 * gating straight from QUEUE_ACTIONS, and the persisted "Restart
 * recovery" section (GET /api/v1/queue + resume endpoint).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { QueuePage } from './QueuePage'
import { useStore } from '../../stores/useStore'
import type { PersistedQueueJob } from '../../queue/types'
import type { DirectorQueueEntry, DirectorQueueState, GenerationJob } from '../../types'

const runningJob: GenerationJob = {
  id: 'job-running',
  kind: 'generation',
  status: 'running',
  progress: 0.4,
  step: 2,
  totalSteps: 5,
  phase: 'rendering clip 3',
  message: '',
  outputFiles: [],
  error: null,
  generationEtaSeconds: 240,
}

const heldJob: GenerationJob = {
  id: 'job-held',
  kind: 'generation',
  status: 'held',
  progress: 0,
  step: 0,
  totalSteps: 0,
  phase: '',
  message: '',
  outputFiles: [],
  error: null,
}

const directorEntries: DirectorQueueEntry[] = [
  {
    id: 'dq-review',
    status: 'awaiting_review',
    message: 'Scene ready',
    created_at: 3,
    scene_description: 'Chorus performance',
    pipeline_type: 'music_video',
    image_model: 'flux',
    video_model: 'kling',
    pipeline_id: 'pipeline-1',
  },
  {
    id: 'dq-queued',
    status: 'queued',
    message: 'Waiting its turn',
    created_at: 2,
    scene_description: 'Intro shot',
    pipeline_type: 'music_video',
    image_model: 'flux',
    video_model: 'kling',
  },
  {
    id: 'dq-failed',
    status: 'failed',
    message: 'Out of memory',
    created_at: 1,
    scene_description: 'Bridge shot',
    pipeline_type: 'music_video',
    image_model: 'flux',
    video_model: 'kling',
  },
]

const directorQueue: DirectorQueueState = {
  version: 1,
  paused: false,
  running: false,
  entries: directorEntries,
}

const persistedJobs: PersistedQueueJob[] = [
  { id: 'pj-failed', status: 'failed', media_path: '/out/failed', can_resume: true, attempt: 2, title: 'Night drive clip' },
  { id: 'pj-done', status: 'done', media_path: '/out/done', can_resume: false, title: 'Skyline still' },
  // Backend fallback after a restart: no record, no media → not a queue item.
  { id: 'pj-unknown', status: 'unknown', media_path: null, can_resume: false, title: 'Ghost job' },
]

const stopGeneration = vi.fn<(jobId?: string) => void>()
const fetchCalls: Array<{ url: string; method: string }> = []

function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response
}

beforeEach(() => {
  fetchCalls.length = 0
  stopGeneration.mockClear()
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    fetchCalls.push({ url, method: init?.method ?? 'GET' })
    if (url.includes('/api/v1/director/queue')) return Promise.resolve(jsonResponse(directorQueue))
    if (url.includes('/resume')) {
      return Promise.resolve(jsonResponse({
        ok: true,
        status: 'running',
        skipped: false,
        replayed: false,
        message: 'Resumed',
      }))
    }
    if (url.includes('/api/v1/queue')) {
      return Promise.resolve(jsonResponse({ count: persistedJobs.length, jobs: persistedJobs }))
    }
    return Promise.reject(new Error(`Unexpected fetch in QueuePage test: ${url}`))
  })
  useStore.setState({
    jobs: [runningJob, heldJob],
    isEnhancing: false,
    directorQueue,
    directorQueueLoading: false,
    pipelineId: null,
    pipelineStatus: null,
    activeWorkspace: 'demo-project',
    stopGeneration,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('QueuePage (A14)', () => {
  it('renders shared labels, the real ETA, and the filtered item count', async () => {
    render(<QueuePage />)
    await screen.findByTestId('queue-recovery-section')

    // Every section reads from the single QUEUE_LABELS table.
    expect(screen.getByText('Studio · Generating · Step 2/5 · ~4m remaining')).toBeInTheDocument()
    expect(screen.getByText('Studio · Waiting')).toBeInTheDocument()
    expect(screen.getByText('Awaiting review · Scene ready')).toBeInTheDocument()
    expect(screen.getByText('Failed · Out of memory')).toBeInTheDocument()
    // `unknown` persisted rows are no queue items — they never count.
    expect(screen.getByText('6 items')).toBeInTheDocument()
    expect(screen.queryByText('Ghost job')).toBeNull()
    // No live pipeline → no "Director now" row (and no invented ETA).
    expect(screen.queryByText('Director now')).toBeNull()
  })

  it('confirms before cancelling a running job, cancels held jobs directly', () => {
    render(<QueuePage />)
    fireEvent.click(screen.getByTitle('Stop generation'))
    // Confirmation first: nothing was dispatched yet.
    expect(screen.getByRole('dialog', { name: 'Stop this generation?' })).toBeInTheDocument()
    expect(stopGeneration).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Stop generation' }))
    expect(stopGeneration).toHaveBeenCalledTimes(1)
    expect(stopGeneration).toHaveBeenCalledWith('job-running')
    expect(screen.queryByRole('dialog')).toBeNull()

    // Held items stay one-click cancellable (spec A14 §2.1).
    fireEvent.click(screen.getByTitle('Remove held generation'))
    expect(stopGeneration).toHaveBeenCalledTimes(2)
    expect(stopGeneration).toHaveBeenCalledWith('job-held')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers the Director review action only for awaiting_review entries', () => {
    render(<QueuePage />)
    expect(screen.getAllByRole('button', { name: 'Open Director project' })).toHaveLength(1)
    // Queue maintenance stays available for the editable entries only.
    expect(screen.getAllByRole('button', { name: 'Remove from queue' })).toHaveLength(2)
  })

  it('gates Restart recovery actions and reports the resume result', async () => {
    render(<QueuePage />)
    await screen.findByTestId('queue-recovery-section')

    expect(screen.getByTestId('queue-recovery-pj-failed')).toBeInTheDocument()
    expect(screen.getByTestId('queue-recovery-pj-done')).toBeInTheDocument()
    expect(screen.queryByTestId('queue-recovery-pj-unknown')).toBeNull()

    // failed → Resume only; done → Review only (QUEUE_ACTIONS).
    expect(screen.getByTestId('queue-recovery-resume-pj-failed')).toBeInTheDocument()
    expect(screen.queryByTestId('queue-recovery-resume-pj-done')).toBeNull()
    expect(screen.getByTestId('queue-recovery-review-pj-done')).toBeInTheDocument()
    expect(screen.queryByTestId('queue-recovery-review-pj-failed')).toBeNull()

    fireEvent.click(screen.getByTestId('queue-recovery-resume-pj-failed'))
    expect(await screen.findByRole('status')).toHaveTextContent('Resumed')
    expect(fetchCalls.some(call => (
      call.url.includes('/api/v1/queue/pj-failed/resume') && call.method === 'POST'
    ))).toBe(true)

    fireEvent.click(screen.getByTestId('queue-recovery-review-pj-done'))
    expect(useStore.getState().appSection).toBe('medias')
  })
})
