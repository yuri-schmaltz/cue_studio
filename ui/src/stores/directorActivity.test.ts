import { describe, expect, it } from 'vitest'
import type { PipelineStatus } from '../api/client'
import { computeDirectorActivity, directorStepForPipelineStatus } from './directorActivity'

function status(patch: Partial<PipelineStatus>): PipelineStatus {
  return { status: 'running', phase: 'planning', progress: { current: 0, total: 0 }, ...patch } as PipelineStatus
}

describe('Director state presentation', () => {
  it('keeps the approval step when a paused production is reopened', () => {
    expect(directorStepForPipelineStatus(status({ status: 'paused', pause_reason: 'review_prompts' }), 'upload')).toBe('review')
    expect(directorStepForPipelineStatus(status({ status: 'paused', pause_reason: 'review_images' }), 'upload')).toBe('review_video')
    expect(computeDirectorActivity(status({ status: 'paused' }), null).label).toBe('Awaiting your review')
  })
  it('never displays completed progress for a failed or cancelled run', () => {
    for (const terminal of ['failed', 'cancelled'] as const) {
      const activity = computeDirectorActivity(status({ status: terminal }), null)
      expect(Number.isNaN(activity.fraction)).toBe(true)
      expect(activity.label).toContain(terminal)
    }
    expect(computeDirectorActivity(status({ status: 'completed' }), null).fraction).toBe(1)
  })
  it('clamps progress and keeps an indeterminate state until the backend reports progress', () => {
    const activity = computeDirectorActivity(status({ phase: 'planning', progress: { current: 5, total: 2, message: '', step: 0, total_steps: 0 } }), null)
    expect(activity.fraction).toBe(1)
    expect(Number.isNaN(computeDirectorActivity(null, 'Starting…').fraction)).toBe(true)
  })
  it('maps resumed planning back to the planning stage', () => {
    expect(directorStepForPipelineStatus(status({ phase: 'resuming' }), 'review_video')).toBe('plan')
    expect(computeDirectorActivity(status({ phase: 'resuming' }), null).label).toContain('Resuming')
  })
})
