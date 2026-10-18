/**
 * Tests for the shared queue state contract (feature A14).
 */

import { describe, expect, it } from 'vitest'

import { QUEUE_ACTIONS, QUEUE_LABELS, queueAllows, queueStateFor, queueStatusLabel } from './types'

describe('queueStateFor', () => {
  it('normalizes statuses from every real source', () => {
    // Studio jobs / Director entries
    expect(queueStateFor('held')).toBe('queued')
    expect(queueStateFor('queued')).toBe('queued')
    expect(queueStateFor('preparing')).toBe('preparing')
    expect(queueStateFor('running')).toBe('running')
    expect(queueStateFor('awaiting_review')).toBe('awaiting_review')
    expect(queueStateFor('completed')).toBe('done')
    expect(queueStateFor('failed')).toBe('failed')
    expect(queueStateFor('cancelled')).toBe('cancelled')
    // Backend persisted jobs (GET /api/v1/queue)
    expect(queueStateFor('done')).toBe('done')
    expect(queueStateFor('interrupted')).toBe('failed')
  })

  it('maps unknown backend statuses to null (degrade gracefully)', () => {
    expect(queueStateFor('unknown')).toBeNull()
    expect(queueStateFor('')).toBeNull()
    expect(queueStateFor('weird_status')).toBeNull()
  })
})

describe('QUEUE_LABELS', () => {
  it('labels every state', () => {
    for (const state of Object.keys(QUEUE_ACTIONS) as Array<keyof typeof QUEUE_LABELS>) {
      expect(QUEUE_LABELS[state]).toBeTruthy()
    }
  })
})

describe('queueAllows', () => {
  it('cancel is only valid while queued/preparing/running', () => {
    expect(queueAllows('queued', 'cancel')).toBe(true)
    expect(queueAllows('preparing', 'cancel')).toBe(true)
    expect(queueAllows('running', 'cancel')).toBe(true)
    expect(queueAllows('awaiting_review', 'cancel')).toBe(false)
    expect(queueAllows('done', 'cancel')).toBe(false)
    expect(queueAllows('failed', 'cancel')).toBe(false)
    expect(queueAllows('cancelled', 'cancel')).toBe(false)
  })

  it('review is only valid on awaiting_review/done', () => {
    expect(queueAllows('awaiting_review', 'review')).toBe(true)
    expect(queueAllows('done', 'review')).toBe(true)
    expect(queueAllows('running', 'review')).toBe(false)
    expect(queueAllows('failed', 'review')).toBe(false)
  })

  it('reopen is only valid on failed/cancelled', () => {
    expect(queueAllows('failed', 'reopen')).toBe(true)
    expect(queueAllows('cancelled', 'reopen')).toBe(true)
    expect(queueAllows('done', 'reopen')).toBe(false)
    expect(queueAllows('running', 'reopen')).toBe(false)
  })
})

describe('queueStatusLabel', () => {
  it('renders normalized labels from QUEUE_LABELS for real statuses', () => {
    expect(queueStatusLabel('held')).toBe(QUEUE_LABELS.queued)
    expect(queueStatusLabel('queued')).toBe(QUEUE_LABELS.queued)
    expect(queueStatusLabel('running')).toBe(QUEUE_LABELS.running)
    expect(queueStatusLabel('awaiting_review')).toBe(QUEUE_LABELS.awaiting_review)
    expect(queueStatusLabel('completed')).toBe(QUEUE_LABELS.done)
    expect(queueStatusLabel('done')).toBe(QUEUE_LABELS.done)
    expect(queueStatusLabel('interrupted')).toBe(QUEUE_LABELS.failed)
    expect(queueStatusLabel('failed')).toBe(QUEUE_LABELS.failed)
    expect(queueStatusLabel('cancelled')).toBe(QUEUE_LABELS.cancelled)
  })

  it('falls back to a prettified raw status outside the taxonomy', () => {
    // The live Director pipeline can report `paused`, which is not a
    // queue state — degrade gracefully instead of crashing.
    expect(queueStatusLabel('paused')).toBe('Paused')
    expect(queueStatusLabel('some_phase')).toBe('Some phase')
  })
})
