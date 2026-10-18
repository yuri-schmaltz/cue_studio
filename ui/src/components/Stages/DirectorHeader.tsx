// filepath: ui/src/components/Stages/DirectorHeader.tsx
//
// Director header (feature A12 §2.1): a compact bar above the stage
// columns that shows
//
//   • the stepper — Briefing → Scenes → Options → Review — with the
//     current group highlighted (aria-current="step") and completed
//     groups check-marked;
//   • the next action ("Continue to …") linking to the following
//     column;
//   • a "Back to briefing" link once the flow has left the briefing
//     group.
//
// All labels come from DIRECTOR_LABELS (director/types.ts) so the
// wording stays in one place. Action links are real anchors — without
// an `onNavigate` they do a plain hash jump; DirectorStage passes
// `onNavigate` to also switch the mobile tab (≤767px) and scroll the
// target column into view.

import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import {
  buildDirectorHeaderState,
  DIRECTOR_LABELS,
  DIRECTOR_STEP_ORDER,
  type PipelineDirectorStep,
} from '../../director/types'

interface DirectorHeaderProps {
  /** Current backend pipeline step; the header derives its group. */
  pipelineStep: PipelineDirectorStep
  /** When provided, action links call this instead of doing a raw
   *  hash jump. */
  onNavigate?: (href: string) => void
}

export function DirectorHeader({ pipelineStep, onNavigate }: DirectorHeaderProps) {
  const state = buildDirectorHeaderState(pipelineStep)
  const stepIndex = DIRECTOR_STEP_ORDER.indexOf(state.step)
  const previous = state.previousAction
  const next = state.nextAction

  const navigate = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!onNavigate) return
    event.preventDefault()
    onNavigate(href)
  }

  const linkClassName =
    'flex items-center gap-1 rounded px-1 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue'

  return (
    <header
      data-testid="director-header"
      data-step={state.step}
      className="shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-border bg-bg-secondary px-3 py-2"
    >
      <ol className="flex min-w-0 items-center gap-1" aria-label="Director progress">
        {DIRECTOR_STEP_ORDER.map((id, idx) => {
          const status = idx < stepIndex ? 'done' : idx === stepIndex ? 'current' : 'todo'
          return (
            <li key={id} className="flex items-center gap-1">
              {idx > 0 && (
                <ArrowRight size={10} className="shrink-0 text-text-muted/50" aria-hidden="true" />
              )}
              <span
                aria-current={status === 'current' ? 'step' : undefined}
                title={DIRECTOR_LABELS.steps[id]}
                className={`flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-2xs ${
                  status === 'current'
                    ? 'bg-accent-blue/15 font-semibold text-accent-blue'
                    : status === 'done'
                      ? 'font-medium text-emerald-400/90'
                      : 'text-text-muted'
                }`}
              >
                {status === 'done' && <Check size={10} aria-hidden="true" />}
                {DIRECTOR_LABELS.steps[id]}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="flex items-center gap-3 text-2xs">
        {previous && (
          <a
            href={previous.href}
            onClick={(event) => navigate(event, previous.href)}
            className={`${linkClassName} text-text-muted hover:text-text-primary`}
          >
            <ArrowLeft size={11} aria-hidden="true" />
            {previous.label}
          </a>
        )}
        {next && (
          <a
            href={next.href}
            onClick={(event) => navigate(event, next.href)}
            className={`${linkClassName} font-medium text-accent-blue hover:text-accent-blue-hover`}
          >
            {next.label}
            <ArrowRight size={11} aria-hidden="true" />
          </a>
        )}
      </div>
    </header>
  )
}
