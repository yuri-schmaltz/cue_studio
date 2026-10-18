// Queue state contract (feature A14).
//
// One table for every queue surface: the label each internal state
// shows to the user and the actions that are valid in that state.
// Components must read from these tables instead of hardcoding status
// strings or inline conditionals (spec risk: label drift between
// places).
//
// The raw statuses come from three real sources and are normalized by
// `queueStateFor`:
//   - Studio jobs (store `jobs`): held / queued / running / completed /
//     failed / cancelled
//   - Director queue entries: + awaiting_review
//   - Backend persisted jobs (GET /api/v1/queue, feature A19): done /
//     interrupted / failed / unknown

export type QueueState =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'awaiting_review'
  | 'done'
  | 'failed'
  | 'cancelled'

export const QUEUE_LABELS: Record<QueueState, string> = {
  queued: 'Waiting',
  preparing: 'Preparing/download',
  running: 'Generating',
  awaiting_review: 'Awaiting review',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export type QueueAction = 'cancel' | 'review' | 'reopen' | 'download'

export const QUEUE_ACTIONS: Record<QueueState, ReadonlyArray<QueueAction>> = {
  queued: ['cancel'],
  preparing: ['cancel'],
  running: ['cancel'],
  awaiting_review: ['review'],
  done: ['review', 'download'],
  failed: ['reopen'],
  cancelled: ['reopen'],
}

/** Map a raw status from any queue source onto the shared QueueState.
 *  Returns null for statuses that shouldn't render as queue items
 *  (e.g. the backend's `unknown` after a restart). */
export function queueStateFor(rawStatus: string): QueueState | null {
  switch (rawStatus) {
    case 'held':
    case 'queued':
      return 'queued'
    case 'preparing':
      return 'preparing'
    case 'running':
      return 'running'
    case 'awaiting_review':
      return 'awaiting_review'
    case 'completed':
    case 'done':
      return 'done'
    // An interrupted job (server died mid-run) is resumable exactly
    // like a failed one — it maps onto the same label + reopen action.
    case 'failed':
    case 'interrupted':
      return 'failed'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return null
  }
}

/** Does `state` allow the given action? (Single source for the
 *  "cancel only while queued/running", "reopen only when failed"
 *  gating required by the spec.) */
export function queueAllows(state: QueueState, action: QueueAction): boolean {
  return QUEUE_ACTIONS[state].includes(action)
}

/** Status label for any raw status: normalized through the single
 *  QUEUE_LABELS table, with a prettified fallback for statuses outside
 *  the taxonomy (e.g. the live Director pipeline's "paused"). Risk
 *  mitigation for spec A14 §7: components must call this instead of
 *  hardcoding status strings. */
export function queueStatusLabel(rawStatus: string): string {
  const state = queueStateFor(rawStatus)
  if (state) return QUEUE_LABELS[state]
  return rawStatus.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}

// -------------------------------------------------------------------------
// Wire shapes for the persisted post-restart queue (GET /api/v1/queue —
// backend feature A19, consumed by the QueuePage "Restart recovery"
// section).
// -------------------------------------------------------------------------

export interface PersistedQueueJob {
  id: string
  /** Backend classifier status: done | interrupted | failed | unknown. */
  status: string
  /** Directory holding the job's generated media (null when none). */
  media_path: string | null
  can_resume: boolean
  production_id?: string | null
  attempt?: number | null
  title?: string | null
  interrupted_at?: string | null
}

export interface PersistedQueueList {
  count: number
  jobs: PersistedQueueJob[]
}

/** Envelope returned by POST /api/v1/queue/{job_id}/resume. */
export interface PersistedResumeResult {
  ok: boolean
  status: string
  skipped: boolean
  replayed: boolean
  message: string
  idempotency_key?: string
  out_dir?: string
}
