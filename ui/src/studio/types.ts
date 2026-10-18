// filepath: ui/src/studio/types.ts
//
// Studio responsive layout contract (feature A13).
//
// `StudioPage` hides `MainContent` below `md`, which made the
// generation results unreachable on mobile. The A13 layout keeps the
// desktop split (Controls sidebar + Results content ≥768px) and adds
// a `Controls | Results` tab bar at ≤767px. This module owns the tab
// types, the shared labels, and the pure decision helpers for the
// auto-switch to Results when a generation concludes.

import type { OutputFile } from '../types'

export type StudioTab = 'controls' | 'results'

export interface StudioLayoutProps {
  activeTab: StudioTab
  onTabChange: (tab: StudioTab) => void
  /** Notification of a new output (spec A13 §3) — set when a run
   *  concludes with a file the gallery hasn't seen yet. */
  pendingResult?: { id: string; createdAt: string }
}

/** Shared UI strings for the A13 surfaces (English, matching the app). */
export const STUDIO_LABELS = {
  tabs: {
    controls: 'Controls',
    results: 'Results',
  },
} as const

/** Spec A13 §7: never yank focus/scroll while the user interacted in
 *  the last 4 seconds. */
export const INTERACTION_GUARD_MS = 4000

/** The store flags a run with `isGenerating`; true → false means the
 *  generation concluded (completed, failed or cancelled — all of them
 *  refresh the results surface). */
export function generationConcluded(previous: boolean, current: boolean): boolean {
  return previous && !current
}

/**
 * Newest output that appeared between two snapshots (spec A13 §3
 * `pendingResult`). Outputs are identified by `name` — the gallery's
 * unique key per file — and the newest one wins on `created_at`.
 */
export function findNewOutput(
  previousNames: readonly string[],
  outputs: readonly OutputFile[],
): { id: string; createdAt: string } | null {
  let newest: OutputFile | null = null
  for (const output of outputs) {
    if (previousNames.includes(output.name)) continue
    if (!newest || output.created_at >= newest.created_at) newest = output
  }
  return newest ? { id: newest.name, createdAt: String(newest.created_at) } : null
}

/** True while the user is typing — auto-switching to Results would
 *  steal focus from the composer (spec A13 §4.4). */
export function isTextEntryTarget(element: Element | null): boolean {
  if (!element) return false
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (element as HTMLElement).isContentEditable === true
}

export interface AutoSwitchContext {
  /** The run just concluded (`generationConcluded`). */
  concluded: boolean
  /** True while the mobile tab layout is active (≤767px). */
  compact: boolean
  /** Tab selected at conclusion time. */
  activeTab: StudioTab
  /** `document.activeElement` at conclusion time. */
  activeElement: Element | null
  /** Timestamp (ms) of the user's last pointer/key interaction. */
  lastInteractionAt: number
  /** Current timestamp (ms). */
  now: number
}

/**
 * Auto-switch to Results (spec A13 §4.4 + §7): only when the run
 * concluded, the tab UI is the active layout, the user is still on
 * Controls, is not typing, and has been idle for at least
 * `INTERACTION_GUARD_MS`. Returns false otherwise — the caller keeps
 * `pendingResult` so the Results tab can show its "new" dot.
 */
export function shouldAutoSwitchToResults(ctx: AutoSwitchContext): boolean {
  if (!ctx.concluded || !ctx.compact) return false
  if (ctx.activeTab !== 'controls') return false
  if (isTextEntryTarget(ctx.activeElement)) return false
  if (ctx.now - ctx.lastInteractionAt < INTERACTION_GUARD_MS) return false
  return true
}
