/**
 * DirectorChat badge / chip / bubble primitives.
 *
 * Why this lives in its own file
 * ------------------------------
 * ``DirectorChat.tsx`` is the largest component in the codebase
 * (~3.9 kLOC). The badges, energy dots, shot status chips and
 * neutral bubbles that decorate the chat timeline were extracted
 * here because:
 *
 * * they have no state of their own beyond the props they receive,
 *   so they can be unit-tested in isolation;
 * * they are reused by other Director surfaces (e.g. the
 *   DirectorPlanColumn draws ``SectionBadge`` and ``EnergyDot``),
 *   so making them importable from one place avoids drift;
 * * carving them out shrinks ``DirectorChat.tsx`` by ~70 lines,
 *   making the remaining orchestration logic easier to scan.
 *
 * The components here are pure presentation — no store reads,
 * no callbacks — except for the explicit ``children`` slot used
 * by the bubble wrappers. They sit below the rest of the chat
 * column in the visual stack so the badge colour palette is
 * referenced through the same constants the chat column uses.
 */

import type { ReactNode } from 'react'

/**
 * Section colour map. Kept in sync with the parent module's
 * ``sectionColors`` table; duplicating it here would let the two
 * palettes drift. If the palette grows past ~12 entries we should
 * promote it to a shared module.
 */
const SECTION_COLORS: Record<string, string> = {
  analyze: 'bg-accent-blue/15 text-accent-blue',
  structure: 'bg-accent-purple/15 text-accent-purple',
  style: 'bg-accent-pink/15 text-accent-pink',
  plan: 'bg-chip-amber/15 text-chip-amber',
  review: 'bg-chip-cyan/15 text-chip-cyan',
  generate_images: 'bg-chip-green/15 text-chip-green',
  plan_video: 'bg-chip-violet/15 text-chip-violet',
  review_video: 'bg-chip-rose/15 text-chip-rose',
}

/**
 * Coloured pill that labels a Director section.
 */
export function SectionBadge({ label }: { label: string }) {
  return (
    <span
      className={`text-2xs px-1.5 py-0.5 rounded-full ${
        SECTION_COLORS[label] || 'bg-bg-hover text-text-muted'
      }`}
    >
      {label}
    </span>
  )
}

/**
 * Tiny colour-coded dot used to surface per-clip energy. The hue
 * mirrors the DirectorPlanColumn legend so users see the same scale
 * in both surfaces.
 */
export function EnergyDot({ energy }: { energy: number }) {
  const color =
    energy > 0.6
      ? 'bg-chip-red'
      : energy < 0.3
        ? 'bg-chip-blue'
        : 'bg-chip-yellow'
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color}`}
      title={`Energy: ${(energy * 100).toFixed(0)}%`}
    />
  )
}

/**
 * Per-shot status pill. The four states match the shot lifecycle
 * the backend reports.
 */
export function ShotStatus({
  status,
}: {
  status: 'pending' | 'generating' | 'ready' | 'failed'
}) {
  const labels = {
    pending: 'Pending',
    generating: 'Generating',
    ready: 'Ready',
    failed: 'Failed',
  }
  const styles = {
    pending: 'bg-bg-hover text-text-muted',
    generating: 'bg-accent-blue/15 text-accent-blue',
    ready: 'bg-indicator-success/15 text-indicator-success',
    failed: 'bg-red-500/15 text-red-400',
  }
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-2xs ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

/**
 * Neutral left-rail wrapper used for system messages in the chat
 * column. The app moved away from a conversational bubble pattern;
 * every event now sits on a left rule, regardless of who emitted
 * it, so the eye scans a single timeline.
 */
export function SystemBubble({ children }: { children: ReactNode }) {
  return (
    <div className="pl-3 py-2 border-l-2 border-border/60 space-y-2">
      {children}
    </div>
  )
}

/**
 * Accent-coloured left-rail wrapper for user messages. Indentation
 * is identical to ``SystemBubble`` so alignment stays consistent
 * across event sizes.
 */
export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="pl-3 py-2 border-l-2 border-accent-blue/40 space-y-1">
      {children}
    </div>
  )
}
