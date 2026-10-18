/**
 * Tests for the code → suggested-action mapping (feature A15).
 */

import { describe, expect, it } from 'vitest'

import { errorActionFor } from './error-actions'
import { ApiError } from './errors'

function apiError(code: string): ApiError {
  return new ApiError({ code, message: 'x' }, 400)
}

describe('errorActionFor', () => {
  it('suggests cancel for not-allowed / conflict style codes', () => {
    expect(errorActionFor(apiError('queue.cancel.not_allowed')).kind).toBe('cancel')
    expect(errorActionFor(apiError('project.conflict')).kind).toBe('cancel')
    expect(errorActionFor(apiError('project.exists')).kind).toBe('cancel')
  })

  it('suggests support for auth and permission problems', () => {
    expect(errorActionFor(apiError('auth.token.expired')).kind).toBe('support')
    expect(errorActionFor(apiError('workspace.permission.denied')).kind).toBe('support')
    expect(errorActionFor(apiError('llm.forbidden')).kind).toBe('support')
  })

  it('suggests retry for transient capacity problems', () => {
    expect(errorActionFor(apiError('queue.busy')).kind).toBe('retry')
    expect(errorActionFor(apiError('llm.timeout')).kind).toBe('retry')
    expect(errorActionFor(apiError('model.unavailable')).kind).toBe('retry')
  })

  it('defaults to retry for unknown codes and non-ApiError values', () => {
    expect(errorActionFor(apiError('weird.unknown.code')).kind).toBe('retry')
    expect(errorActionFor(new Error('boom')).kind).toBe('retry')
    expect(errorActionFor('boom').kind).toBe('retry')
  })

  it('provides a label and hint for every action', () => {
    for (const code of ['queue.cancel.not_allowed', 'queue.busy', 'auth.token.expired']) {
      const action = errorActionFor(apiError(code))
      expect(action.label).toBeTruthy()
      expect(action.hint).toBeTruthy()
    }
  })
})
