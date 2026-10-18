// Standardized HTTP error contract (feature A15).
//
// The backend answers every 4xx/5xx with:
//   { "code": "queue.cancel.not_allowed", "message": "…", "operationId": "uuid" }
// (`detail` carries the payload for FastAPI HTTPException raises).
// The frontend deserializes that shape into `ApiError` so UI code can
// branch on `code` and use `operationId` as the idempotent retry key.

export interface ApiErrorPayload {
  code?: string
  message: string
  operationId?: string
}

export class ApiError extends Error {
  readonly code: string
  readonly operationId: string
  readonly status: number

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message)
    this.name = 'ApiError'
    this.code = payload.code ?? `http.${status}`
    this.operationId = payload.operationId ?? ''
    this.status = status
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** Build an `ApiError` from a non-2xx `Response`, consuming the body. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const fallbackMessage = `Request failed with status ${response.status}`
  let payload: ApiErrorPayload = { message: fallbackMessage }
  try {
    const body = asRecord(await response.json())
    // Two accepted envelopes: the standardized flat payload and the
    // FastAPI HTTPException default `{ detail: {...} }` (string detail
    // included for plain `HTTPException(detail="…")` raises).
    const detail = body ? asRecord(body.detail) : null
    const candidate = detail ?? body
    if (candidate) {
      payload = {
        code: typeof candidate.code === 'string' ? candidate.code : undefined,
        message:
          typeof candidate.message === 'string'
            ? candidate.message
            : typeof body?.detail === 'string'
              ? body.detail
              : fallbackMessage,
        operationId: typeof candidate.operationId === 'string' ? candidate.operationId : undefined,
      }
    }
  } catch {
    // Non-JSON body: keep the status-based fallback.
  }
  return new ApiError(payload, response.status)
}

/**
 * Guard for new code paths: throws `ApiError` when `response` is not
 * ok, otherwise returns the response unchanged so callers can chain
 * `.json()` as usual.
 */
export async function ensureOk(response: Response): Promise<Response> {
  if (!response.ok) throw await apiErrorFromResponse(response)
  return response
}
