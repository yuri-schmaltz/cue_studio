import { DirectorReview } from '../DirectorDashboard/DirectorReview'
// filepath: ui/src/components/Stages/DirectorStage.tsx
//
// DirectorStage — Strategy B (Director-as-Stage) from the
// merge feasibility analysis. This component is a thin wrapper that
// mounts the existing `<DirectorChat/>` inside a Studio-styled shell so
// it can be displayed as a tab alongside the other Studio controls
// instead of forcing the user to flip `sidebarMode: 'director' | 'studio'`.
//
// Why this exists
// ----------------
// Pre-merge, the only way to access the Director planning UI was to
// flip the top-level mode toggle (`AppModeToggle`). That meant the
// user lost the Studio queue / generation context every time they
// wanted to plan a new scene or revisit a prompt plan. Strategy B
// promotes Director to a Stage that lives inside the Workspace; the
// old `sidebarMode === 'director'` mode is kept as a feature-flagged
// fallback so this rollout can be reverted with zero risk.
//
// What's NOT here
// ---------------
// - No new state. The DirectorChat reads from the same Director
//   slices (`directorStep`, `directorLoading`, `directorClipPlans`, …).
// - No API changes. Cancel still routes through
//   `useStore.cancelDirectorV2Plan()` + `useStore.stopPipeline()`.
// - No Python changes. `director_pipeline.py`, `v2_plan_cancel.py`,
//   `DirectorOrchestrator` are untouched.
//
// The wrapper only renders a header + the existing DirectorChat and
// listens for the parent to mount/unmount it. Cancellation, planning,
// and prompt polish flow through unchanged.
//
// Skill chooser
// -------------
// A "Choose different skill" button in the header opens an in-stage
// modal with the same Music Video / Short Film cards the DirectorChat
// shows on first launch. Clicking a card calls
// `useStore.resetDirectorSkillOnly()` (preserves audio, analysis,
// scene description, plan progress) + `setDirectorSkill(skill)` so
// the chat picks up at the new skill's "upload" step. Cancelling
// leaves the existing skill untouched.

import { useEffect } from 'react'
import { useStore } from '../../stores/useStore'
import { useIsMobile } from '../../lib/useIsMobile'
import {
  DirectorChat,
  DirectorGenerationOptions,
} from '../Sidebar/DirectorChat'
import { DirectorPlanColumn } from '../Sidebar/DirectorPlanColumn'
import { DirectorTourOverlay } from './DirectorTourOverlay'

/**
 * Mounts the Director planning UI as a Stage inside the Workspace.
 *
 * The 3-column layout (chat / plan / setup) gives the user a single
 * surface for everything Director: creative conversation on the left,
 * per-shot artifacts (clip structure, image prompts, generated images,
 * video prompts) in the middle, and the technical choices (aspect
 * ratio, resolution, workflow, models, LoRAs) on the right.
 *
 * The skill chooser modal that used to live here was removed — the
 * `<SkillSelector/>` inside DirectorChat already offers the same
 * switching surface during the upload step.
 */

// ---------------------------------------------------------------------------
// DirectorStatusPanel — moved to a separate file
// (./DirectorStatusPanel.tsx) so the App shell can mount it inside the
// bottom HardwareStatusBar alongside GPU/VRAM/CPU/RAM/No model. The
// status strip is now a single inline row (step pills + counter +
// cancel) instead of a stacked card with a two-tone progress bar — the
// progress information lives entirely in the per-step pill colours and
// the X/Y counter, which keeps the bottom bar compact.
// ---------------------------------------------------------------------------


export function DirectorStage() {
  const pipelineId = useStore(s => s.pipelineId)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  const isMobile = useIsMobile(800)
  // The right column is now strictly per-take (changes land in the
  // per-pipeline snapshot at submit time) and stays editable throughout.

  // Make sure the DirectorChat's LLM-log polling effect runs whenever
  // the Stage is mounted. The legacy `<DirectorChat/>` was only mounted
  // when sidebarMode === 'director', so its effects could rely on that
  // signal; here we forward a minimal re-mount hint by changing the
  // wrapper key. Polling itself is already keyed off `useEffect` deps
  // inside DirectorChat, so we don't actually need a key — but we keep
  // the place marker so a future log-stream-pause change has a hook.
  useEffect(() => {
    // Intentionally empty: present so React DevTools shows the mount.
    return () => {
      // Same: cleanup hook reserved for future "pause LLM stream when
      // stage is hidden" behavior (out of scope for Stage 1).
    }
  }, [pipelineId, pipelineStatus?.status])

  return (
    <div
      className="flex flex-col h-full min-h-0 bg-bg-secondary"
      data-testid="director-stage"
      data-pipeline-status={pipelineStatus?.status ?? 'idle'}
      data-mobile={isMobile ? 'true' : 'false'}
    >
      {/* First-run guided tour — only fires once per browser (see
          DirectorTourOverlay for the localStorage flag). Sits outside
          the columns container so its fixed positioning can cover the
          full viewport while still highlighting each column. */}
      <DirectorTourOverlay />
      <div className="director-stage-columns">
        <aside className="director-stage-chat" aria-label="Director chat & decisions">
          <DirectorChat />
        </aside>
        <section className="director-stage-plan" aria-label="Director plan & shots">
          <div className="flex-1 min-h-0 min-w-0 overflow-auto">
            {pipelineStatus?.status === 'paused' ? (
              <section aria-label="Production review and progress">
                <DirectorReview />
              </section>
            ) : <DirectorPlanColumn />}
          </div>
        </section>
        <aside className="director-stage-options" aria-label="Director generation options">
          {/* DirectorGenerationOptions owns its own locked-vs-unlocked body.
              The header (with the Style Bibles shortcut and the Básico /
              Avançado toggle) renders unconditionally so the Style Bibles
              button stays reachable from the moment the Director opens,
              even before the user uploads audio. */}
          <DirectorGenerationOptions />
        </aside>
      </div>
    </div>
  )
}