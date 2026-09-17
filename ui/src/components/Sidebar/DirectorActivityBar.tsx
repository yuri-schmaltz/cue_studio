// filepath: ui/src/components/Sidebar/DirectorActivityBar.tsx
//
// DirectorActivityBar — single source of truth for "what the Director is
// doing right now". Replaces the hard-coded "Recalculating…" string that
// used to sit inside the CLIP STRUCTURE card and stayed on-screen no
// matter which long-running step was actually in flight.
//
// Three variants are exported:
//   • <DirectorActivityBadge />       — compact inline label for cards
//                                       (used in DirectorPanel.tsx and
//                                       DirectorChat.tsx instead of the
//                                       stale "Recalculating…" text)
//   • <DirectorActivityBlock />       — full panel with cancel button,
//                                       progress bar, and a streaming
//                                       token counter for the LLM phase
//                                       (mounted in the middle column by
//                                       DirectorPlanColumn.tsx)
//   • <DirectorActivityProgressBar />— pure progress strip for embedding
//                                       inside other cards
//
// The bar reads four pieces of state from the store:
//   • directorActivityLabel   — human-readable phase name
//   • directorActivityFraction— 0..1 progress (NaN = indeterminate)
//   • llmStreamText           — incremental LLM tokens (live updates)
//   • directorLoading         — true while any Director step is running
//
// All four are derived in the store from the live pipeline status
// (see useStore.ts → _computeDirectorActivity). This component is purely
// a presenter.

import { Loader2, X } from 'lucide-react'
import { useStore } from '../../stores/useStore'

interface ActivityBadgeProps {
  /** Override the store label (e.g. for "Analyzing audio…" before the
   *  pipeline has started). When omitted, uses directorActivityLabel. */
  label?: string
  /** Show a stop button on the right. The default cancel calls
   *  useStore.cancelDirectorV2Plan() which aborts the in-flight HTTP
   *  request AND tells the backend to short-circuit the worker thread. */
  onCancel?: () => void
  /** Override the cancel tooltip. */
  cancelTitle?: string
  className?: string
}

/**
 * Compact inline label + spinner + (optional) cancel button.
 *
 * Drop-in replacement for the old "Recalculating…" pill. Reads
 * `directorLoading` and `directorActivityLabel` from the store so the
 * user always sees the phase that's actually running
 * ("Planning with LLM…", "Polishing prompts…", "Generating start image
 * 3/13…", etc.) instead of a generic placeholder.
 */
export function DirectorActivityBadge({
  label,
  onCancel,
  cancelTitle = 'Stop',
  className = '',
}: ActivityBadgeProps) {
  const loading = useStore(s => s.directorLoading)
  const activityLabel = useStore(s => s.directorActivityLabel)
  const fallbackMessage = useStore(s => s.directorLoadingMessage)
  if (!loading) return null
  const text = label || activityLabel || fallbackMessage || 'Working…'
  return (
    <div className={`relative flex items-center gap-1.5 text-2xs text-text-muted py-1 pr-5 ${className}`}>
      <Loader2 size={10} className="animate-spin" />
      <span>{text}…</span>
      <button
        type="button"
        onClick={onCancel || (() => useStore.getState().cancelDirectorV2Plan())}
        title={cancelTitle}
        aria-label={cancelTitle}
        className="absolute right-0 top-1/2 -translate-y-1/2 bg-bg-secondary rounded-full p-0.5 border border-border text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
      >
        <X size={10} />
      </button>
    </div>
  )
}

interface ProgressBarProps {
  /** Override the fraction (0..1). Defaults to directorActivityFraction. */
  fraction?: number
  /** Show a label above the bar (e.g. "Step 4 of 12"). */
  caption?: string
  className?: string
}

/**
 * Pure visual progress strip. Uses an animated diagonal stripe when the
 * fraction is NaN (indeterminate — e.g. the LLM streaming phase where the
 * backend hasn't reported step counts yet).
 */
export function DirectorActivityProgressBar({
  fraction,
  caption,
  className = '',
}: ProgressBarProps) {
  const storeFraction = useStore(s => s.directorActivityFraction)
  const value = fraction ?? storeFraction
  const indeterminate = Number.isNaN(value) || value < 0
  const pct = indeterminate ? 100 : Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={className}>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-busy={indeterminate ? 'true' : 'false'}
        aria-label={caption || 'Director progress'}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${
            indeterminate
              ? 'w-full bg-gradient-to-r from-accent-purple/40 via-accent-purple to-accent-purple/40 bg-[length:200%_100%] animate-[director-bar-slide_1.2s_linear_infinite]'
              : 'bg-accent-purple'
          }`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
      {caption && (
        <div className="mt-1 text-2xs text-text-muted">{caption}</div>
      )}
    </div>
  )
}

interface ActivityBlockProps {
  /** When true (default), mount a cancel button. */
  showCancel?: boolean
  className?: string
}

/**
 * Full-panel activity card: spinner, label, progress bar, optional
 * streaming token counter, and cancel button.
 *
 * This is the card that lives in the middle Director column while the
 * pipeline is running. Previously the column went blank during the LLM
 * passes because LlmLogStage only renders after the pass completes —
 * this card fills that gap so the user always sees something happening.
 */
export function DirectorActivityBlock({ showCancel = true, className = '' }: ActivityBlockProps) {
  const loading = useStore(s => s.directorLoading)
  const label = useStore(s => s.directorActivityLabel)
  const message = useStore(s => s.directorLoadingMessage)
  const fraction = useStore(s => s.directorActivityFraction)
  const streamText = useStore(s => s.llmStreamText)
  const streamDone = useStore(s => s.llmStreamDone)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  if (!loading) return null

  const step = pipelineStatus?.progress?.step ?? 0
  const totalSteps = pipelineStatus?.progress?.total_steps ?? 0
  const caption = totalSteps > 0 ? `Step ${step}/${totalSteps}` : undefined
  const showStream = !streamDone && streamText.length > 0
  // Rough token estimate: split on whitespace + 1. Good enough for a
  // "X tokens streamed" counter; LLM reports are visible elsewhere.
  const tokenCount = showStream ? streamText.trim().split(/\s+/).filter(Boolean).length : 0

  return (
    <div className={`bg-bg-secondary rounded-lg p-4 border border-border space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 size={14} className="animate-spin text-accent-purple shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-primary truncate">
              {label || 'Working…'}
            </div>
            {message && message !== label && (
              <div className="text-2xs text-text-muted truncate" title={message}>
                {message}
              </div>
            )}
          </div>
        </div>
        {showCancel && (
          <button
            type="button"
            onClick={() => useStore.getState().cancelDirectorV2Plan()}
            title="Cancel the Director run"
            aria-label="Cancel the Director run"
            className="shrink-0 bg-bg-tertiary rounded-full p-1 border border-border text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <DirectorActivityProgressBar fraction={fraction} caption={caption} />
      {showStream && (
        <div className="text-2xs text-text-muted">
          <span className="font-mono text-accent-blue/70">{tokenCount.toLocaleString()}</span>{' '}
          tokens streamed so far…
        </div>
      )}
    </div>
  )
}
