/**
 * Tests for the standardized HTTP error contract (feature A15).
 */

import { describe, expect, it } from 'vitest'

import { ApiError, apiErrorFromResponse, ensureOk } from './errors'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiErrorFromResponse', () => {
  it('deserializes the standardized flat payload', async () => {
    const response = jsonResponse(409, {
      code: 'queue.cancel.not_allowed',
      message: 'Job não pode ser cancelado',
      operationId: 'op-123',
    })
    const error = await apiErrorFromResponse(response)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('queue.cancel.not_allowed')
    expect(error.message).toBe('Job não pode ser cancelado')
    expect(error.operationId).toBe('op-123')
    expect(error.status).toBe(409)
  })

  it('unwraps the FastAPI { detail: {...} } envelope', async () => {
    const response = jsonResponse(500, {
      detail: { code: 'generation.failed', message: 'CUDA OOM', operationId: 'op-456' },
    })
    const error = await apiErrorFromResponse(response)
    expect(error.code).toBe('generation.failed')
    expect(error.message).toBe('CUDA OOM')
    expect(error.operationId).toBe('op-456')
  })

  it('handles a plain string detail', async () => {
    const response = jsonResponse(404, { detail: 'Not found' })
    const error = await apiErrorFromResponse(response)
    expect(error.message).toBe('Not found')
    expect(error.code).toBe('http.404')
  })

  it('falls back to the status when the body is missing or not JSON', async () => {
    const error = await apiErrorFromResponse(new Response('nope', { status: 502 }))
    expect(error.code).toBe('http.502')
    expect(error.message).toContain('502')
    expect(error.operationId).toBe('')
  })
})

describe('ensureOk', () => {
  it('passes successful responses through', async () => {
    const response = jsonResponse(200, { ok: true })
    await expect(ensureOk(response)).resolves.toBe(response)
  })

  it('throws ApiError for non-2xx responses', async () => {
    const response = jsonResponse(400, { code: 'project.invalid', message: 'Bad name', operationId: 'op-7' })
    await expect(ensureOk(response)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'project.invalid',
      status: 400,
      operationId: 'op-7',
    })
  })
})
