// filepath: ui/src/director/types.ts
//
// Director flow contract (feature A12).
//
// The Director pipeline advances through nine backend steps
// (`upload` → `analyze` → … → `review_video`) but the user-facing flow
// is grouped into four surfaces shown in the header stepper:
//
//   Briefing (audio input) → Scenes (planning) → Options (generation
//   setup) → Review (results).
//
// This module owns that grouping, the `DirectorHeaderState` derived
// from it (current step + next action + "Back to briefing"), the
// labels table the header/tabs render (English, matching the rest of
// the app), and the mobile tab mapping DirectorStage uses at ≤767px.

/** The nine `directorStep` values the store can hold
 *  (see `useStore.directorStep`). */
export type PipelineDirectorStep =
  | 'upload'
  | 'analyze'
  | 'structure'
  | 'style'
  | 'plan'
  | 'review'
  | 'generate_images'
  | 'plan_video'
  | 'review_video'

/** User-facing step group shown in the Director header stepper
 *  (spec A12 §3: Briefing / Cenas / Opções / Revisão). */
export type DirectorStep = 'briefing' | 'scenes' | 'options' | 'review'

/** Panels that get a tab on mobile (≤767px). `review` has no tab of
 *  its own — its surfaces (DirectorReview, final prompts) render
 *  inside the plan column, so it maps to the `scenes` tab. */
export type DirectorMobileTab = 'briefing' | 'scenes' | 'options'

/** A header action — a link the user can follow to advance the flow
 *  or jump back to the Briefing column. */
export interface DirectorAction {
  label: string
  href: string
}

export interface DirectorHeaderState {
  step: DirectorStep
  nextAction?: DirectorAction
  previousAction?: DirectorAction
}

/** Per-scene card status vocabulary.
 *
 *  NOTE: the spec contract listed `'pending' | 'running' | 'review' |
 *  'done' | 'failed'`; this app's ShotStatus badge already renders
 *  "Generating" / "Ready" for the in-flight / finished states, so the
 *  shared vocabulary follows the app (adaptation reported in A12).
 *  `failed` — the acceptance-critical value — is identical. */
export type SceneCardStatus = 'pending' | 'generating' | 'ready' | 'failed'

/** Scene card data contract (spec A12 §3). `DirectorChat` still owns
 *  the per-phase markup (image vs video cards differ in actions), so
 *  this interface documents the shared card shape; the status field is
 *  fed by the pure derivations in `./sceneStatus.ts`. */
export interface SceneCard {
  id: string
  index: number
  durationSec: number
  takes: number
  status: SceneCardStatus
  prompt: string
  thumb?: string
}

/** Header step order, left to right. */
export const DIRECTOR_STEP_ORDER: readonly DirectorStep[] = ['briefing', 'scenes', 'options', 'review']

/** Pipeline step → header step group. Mirrors the visibility rules in
 *  `DirectorPlanColumn` (structure/style/plan surface in the plan
 *  column; generation runs against the options column; review results
 *  land back in the plan column). */
export const DIRECTOR_PIPELINE_GROUPS: Record<PipelineDirectorStep, DirectorStep> = {
  upload: 'briefing',
  analyze: 'briefing',
  structure: 'scenes',
  style: 'scenes',
  plan: 'scenes',
  generate_images: 'options',
  plan_video: 'options',
  review: 'review',
  review_video: 'review',
}

/** In-page anchors for the three stage columns (+ review alias). The
 *  plan column hosts both the scenes and the review surfaces, so it
 *  answers to `#director-scenes` (and `#director-review` while
 *  DirectorReview is mounted). */
export const DIRECTOR_COLUMN_HREFS = {
  briefing: '#director-briefing',
  scenes: '#director-scenes',
  options: '#director-options',
  review: '#director-scenes',
} as const

/** All user-facing strings for the A12 surfaces. Components must read
 *  labels from this table instead of hardcoding them (same convention
 *  as QUEUE_LABELS in queue/types.ts). */
export const DIRECTOR_LABELS = {
  steps: {
    briefing: 'Briefing',
    scenes: 'Scenes',
    options: 'Options',
    review: 'Review',
  },
  tabs: {
    briefing: 'Briefing',
    scenes: 'Scenes',
    options: 'Options',
  },
  next: {
    briefing: 'Continue to scenes',
    scenes: 'Continue to options',
    options: 'Continue to review',
  },
  backToBriefing: 'Back to briefing',
  /** CTA shown on a scene whose generation failed (spec A12 §5). */
  retryScene: 'Try again',
} as const

/** Map a pipeline step to its header group. */
export function deriveDirectorStep(pipelineStep: PipelineDirectorStep): DirectorStep {
  return DIRECTOR_PIPELINE_GROUPS[pipelineStep]
}

/**
 * Header state for the current pipeline step (spec A12 §3).
 *
 * - `nextAction` points at the following group's column; the last
 *   group (review) has no next action.
 * - `previousAction` is the "Back to briefing" link, present only once
 *   the flow has left the briefing group (spec A12 §2.1).
 */
export function buildDirectorHeaderState(pipelineStep: PipelineDirectorStep): DirectorHeaderState {
  const step = deriveDirectorStep(pipelineStep)
  const next: DirectorAction | null =
    step === 'briefing'
      ? { label: DIRECTOR_LABELS.next.briefing, href: DIRECTOR_COLUMN_HREFS.scenes }
      : step === 'scenes'
        ? { label: DIRECTOR_LABELS.next.scenes, href: DIRECTOR_COLUMN_HREFS.options }
        : step === 'options'
          ? { label: DIRECTOR_LABELS.next.options, href: DIRECTOR_COLUMN_HREFS.review }
          : null
  const previous: DirectorAction | null =
    step === 'briefing'
      ? null
      : { label: DIRECTOR_LABELS.backToBriefing, href: DIRECTOR_COLUMN_HREFS.briefing }
  return {
    step,
    ...(next ? { nextAction: next } : {}),
    ...(previous ? { previousAction: previous } : {}),
  }
}

/** Mobile tab that shows the surfaces for a header step. */
export function tabForStep(step: DirectorStep): DirectorMobileTab {
  return step === 'review' ? 'scenes' : step
}

/** Resolve an in-page column href back to the mobile tab that shows
 *  it. Returns null for hrefs that don't belong to the stage. */
export function tabForHref(href: string): DirectorMobileTab | null {
  switch (href) {
    case DIRECTOR_COLUMN_HREFS.briefing:
      return 'briefing'
    case DIRECTOR_COLUMN_HREFS.scenes:
    case '#director-review':
      return 'scenes'
    case DIRECTOR_COLUMN_HREFS.options:
      return 'options'
    default:
      return null
  }
}
