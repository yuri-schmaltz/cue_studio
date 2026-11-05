/**
 * DirectorStatusBar — the Director's pipeline tracker, docked at the
 * bottom of the stage.
 *
 * Why it left the scenes column
 * ------------------------------
 * The ten pipeline steps used to live in a footer *inside* the middle
 * column, so the progress was only visible while that column was on
 * screen. The user could be reading the brief on the left, or the
 * technical options on the right, with no idea where the run had
 * reached. The steps are global to the Director — they describe the
 * run, not one column — so they now live in their own bar under the
 * three columns, visible from every panel.
 *
 * Layout: one compact row inside a card.
 *   left  — pipeline state (idle / busy) and the live message
 *   mid   — the segmented step tracker (one segment per step)
 *   right — the current step name and the X/Y counter
 *
 * The card shell mirrors the application tab strip above it, so the
 * bar reads as a peer of the top navigation instead of a bare strip
 * glued to the bottom edge of the stage.
 *
 * The bar replaces the old per-column footer, which in turn made room
 * for the "Generate Start Images" action that now sits at the bottom
 * of the scenes column.
 */

import { Check, Loader2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { useDirectorSlice } from '../../stores/directorSelectors'
import { STATUS_STEPS } from './directorStatusSteps'

/**
 * The Director status bar. Anchored under the three columns so the
 * pipeline tracker is readable no matter which panel is open.
 */
export function DirectorStatusBar() {
  const step = useDirectorSlice('step')
  const loading = useDirectorSlice('loading')
  const loadingMessage = useDirectorSlice('loadingMessage')
  const plannedClipsCount = useStore(s => s.directorPlannedClips.length)
  const imageGenProgress = useStore(s => s.directorImageGenProgress)
  const isShortFilm = useStore(s => s.directorSkill === 'short_film')

  const totalSteps = STATUS_STEPS.length
  let currentIndex = STATUS_STEPS.findIndex(s => s.id === step)
  if (currentIndex === -1) currentIndex = 0

  const activeStep = STATUS_STEPS[currentIndex] || STATUS_STEPS[0]
  const displayLabel = isShortFilm
    ? activeStep.id === 'structure'
      ? 'Scene structure'
      : activeStep.id === 'style'
        ? 'Story description'
        : activeStep.label
    : activeStep.label

  // Sub-status text displayed alongside the pipeline state. Only shown
  // when there is specific contextual information (e.g. image
  // progress), avoiding redundancy with the busy state label.
  const subStatus = imageGenProgress?.total
    ? `Image ${imageGenProgress.current}/${imageGenProgress.total}${imageGenProgress.currentClipLabel ? ` (${imageGenProgress.currentClipLabel})` : ''}`
    : loadingMessage && !/^(processing|busy|loading)[.…]*$/i.test(loadingMessage.trim())
      ? loadingMessage
      : null

  return (
    <footer
      className="shrink-0 director-status-card select-none"
      data-testid="director-status-bar"
      aria-label={`Pipeline progress: ${displayLabel}, step ${currentIndex + 1} of ${totalSteps}`}
    >
      {/* Left: pipeline state */}
      <div className="flex items-center gap-2 min-w-0 shrink-0 text-2xs">
        <span className="flex items-center gap-1.5 shrink-0">
          {loading ? (
            <Loader2 size={12} className="animate-spin text-accent-blue shrink-0" aria-hidden="true" />
          ) : (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
          )}
          <span className="text-text-muted">Pipeline:</span>
          <span className={loading ? 'text-accent-blue font-semibold' : 'text-text-secondary font-medium'}>
            {loading ? '' : 'idle'}
          </span>
        </span>

        {loading && subStatus && (
          <span className="text-text-muted truncate max-w-[220px]" title={subStatus}>
            · {subStatus}
          </span>
        )}
      </div>

      {/* Middle: segmented step tracker */}
      <div
        className="flex items-center gap-1 flex-1 min-w-0"
        role="progressbar"
        aria-valuenow={currentIndex + 1}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-label={`Step ${currentIndex + 1} of ${totalSteps}: ${displayLabel}`}
      >
        {STATUS_STEPS.map((s, idx) => {
          const isDone = idx < currentIndex
          const isCurrent = idx === currentIndex
          const stepName = isShortFilm
            ? s.id === 'structure'
              ? 'Scene structure'
              : s.id === 'style'
                ? 'Story description'
                : s.label
            : s.label
          const tooltipAlignClass = idx === 0
            ? 'left-0 translate-x-0'
            : idx === totalSteps - 1
              ? 'right-0 translate-x-0'
              : 'left-1/2 -translate-x-1/2'

          return (
            <div
              key={s.id}
              className={`h-1.5 flex-1 rounded-full transition-all duration-300 relative group cursor-default ${
                isDone
                  ? 'bg-emerald-500'
                  : isCurrent
                    ? loading
                      ? 'bg-accent-blue animate-pulse ring-1 ring-accent-blue/50'
                      : 'bg-accent-blue'
                    : 'bg-bg-tertiary border border-border/40'
              }`}
            >
              {/* Tooltip flutuante no hover */}
              <div
                className={`absolute bottom-full ${tooltipAlignClass} mb-2 hidden group-hover:flex flex-col gap-0.5 bg-bg-primary border border-border rounded-md px-2.5 py-1 text-2xs text-text-primary whitespace-nowrap shadow-xl z-30 pointer-events-none`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <span>{idx + 1}. {stepName}</span>
                  {isDone && <Check size={10} className="text-emerald-400 shrink-0" />}
                  {isCurrent && loading && <Loader2 size={10} className="animate-spin text-accent-blue shrink-0" />}
                  {isCurrent && !loading && <span className="text-accent-blue text-[10px] font-semibold">(atual)</span>}
                </div>
                <span className="text-text-muted text-[10px] font-normal">{s.description(plannedClipsCount)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Right: current step + counter */}
      <div className="flex items-center gap-1.5 shrink-0 text-2xs">
        <span
          className="text-text-primary font-medium truncate max-w-[180px]"
          title={activeStep.description(plannedClipsCount)}
        >
          {displayLabel}
        </span>
        <span className="font-mono text-2xs px-1.5 py-0.5 rounded bg-bg-tertiary border border-border/60 text-text-secondary font-medium tabular-nums ml-0.5">
          {currentIndex + 1}/{totalSteps}
        </span>
      </div>
    </footer>
  )
}
