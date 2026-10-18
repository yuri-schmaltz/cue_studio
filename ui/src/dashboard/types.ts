// Work dashboard contract (feature A11).
//
// The spec's `GET /api/dashboard/summary` endpoint does not exist in
// this backend (app/routers/ ships workspaces, queue, productions,
// video_editor, wizard, mcp — no dashboard router). Instead of
// inventing a path, the summary is derived client-side from data the
// store already loads at boot (workspaces, jobs, director queue,
// outputs) — `dashboard/summary.ts` is the pure mapping layer, so the
// aggregation logic stays unit-testable without a network round-trip.

import type { AppSection } from '../types'
import type { QueueState } from '../queue/types'

export interface DashboardContinueProject {
  id: string
  name: string
  section: AppSection
  updatedAt: string
}

export interface DashboardQueueItem {
  id: string
  label: string
  status: QueueState
  /** Human action for the row's primary button ('Open' / 'Cancel' /
   *  'Review'); null when the row is informational only. */
  action: { label: string; kind: 'open' | 'cancel' | 'review' } | null
}

export interface DashboardRecentOutput {
  id: string
  thumb: string
  type: 'video' | 'image' | 'audio'
  projectId: string
}

export interface DashboardSummary {
  continueProject: DashboardContinueProject | null
  queue: DashboardQueueItem[]
  recentOutputs: DashboardRecentOutput[]
  /** Total projects (excluding the implicit `default` workspace). */
  projectCount: number
}

/** Spec risk mitigation: cap "últimas saídas" so the block can't grow
 *  unbounded. */
export const MAX_RECENT_OUTPUTS = 8
