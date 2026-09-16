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

import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { useDirectorSlice } from '../../stores/directorSelectors'
import {
  DirectorChat,
  DirectorGenerationOptions,
} from '../Sidebar/DirectorChat'
import { DirectorPlanColumn } from '../Sidebar/DirectorPlanColumn'

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
// DirectorStatusPanel — a thin status strip that mirrors what the backend
// is doing right now (uploading audio, classifying sections, loading the
// LLM, planning image prompts, generating the start images, …) so the
// user doesn't have to dig through `app/.launcher.log` to figure out why
// nothing is happening. Each step is one of:
//
//   - done (✓ green)         — completed earlier in this session
//   - active (spinner)       — currently running, with a sub-message
//                              from the store (`directorLoadingMessage`)
//                              so the user can see the specific progress
//                              ("Transcribing audio…", "Loading model:
//                              gemma-4-E4B-it-heretic on cuda", etc.)
//   - pending (muted dot)    — hasn't started yet
//
// The panel only renders while `directorLoading === true` OR the user
// is past the upload step, so the workspace stays uncluttered at first
// launch (before any work has begun).
// ---------------------------------------------------------------------------
// Per-step metadata. The descriptions are functions (not strings) because
// some steps depend on the live clip count for the current song — a 28-clip
// song and a 14-clip song share the same pipeline but the user-facing copy
// needs to reflect what *this* run is actually doing. clipCount is the
// number of planned clips (post structure phase); falls back to a generic
// "the clips" form when the count isn't known yet (e.g. mid-structure).
type StepMeta = {
  id: string
  label: string
  description: (clipCount: number) => string
}

const STATUS_STEPS: StepMeta[] = [
  { id: 'upload', label: 'Upload', description: () => 'Receiving your audio and reference images' },
  { id: 'analyze', label: 'Analyze', description: () => 'Transcribing dialogue, detecting speakers, mapping sections' },
  { id: 'structure', label: 'Plan structure', description: (n) => n > 0
      ? `Segmenting the song into ${n} ${n === 1 ? 'clip' : 'clips'} and beats`
      : 'Segmenting the song into clips and beats' },
  { id: 'style', label: 'Scene description', description: () => 'Confirming the creative brief (characters, mood, palette)' },
  { id: 'plan', label: 'Image prompts', description: (n) => n > 0
      ? `LLM writing one image prompt per clip (${n} total)`
      : 'LLM writing one image prompt per clip' },
  { id: 'review', label: 'Review image prompts', description: (n) => n > 0
      ? `Reviewing the ${n} per-clip image prompts before generation`
      : 'Reviewing the per-clip image prompts before generation' },
  { id: 'generate_images', label: 'Generate images', description: (n) => n > 0
      ? `Rendering the ${n} start ${n === 1 ? 'image' : 'images'} with the image model`
      : 'Rendering the start images with the image model' },
  { id: 'plan_video', label: 'Video prompts', description: (n) => n > 0
      ? `LLM writing one video prompt per clip (${n} total)`
      : 'LLM writing one video prompt per clip' },
  { id: 'review_video', label: 'Review video prompts', description: (n) => n > 0
      ? `Reviewing the ${n} per-clip video prompts before generation`
      : 'Reviewing the per-clip video prompts before generation' },
  // Final stage: the actual video generation. This step does not have a
  // dedicated directorStep value in the store — once the user clicks
  // Generate from the review_video stage, the system queues the Director
  // pipeline and the queue page / status banner takes over reporting
  // progress. Surfacing it here gives the user a complete mental model
  // of the pipeline without having to mentally bridge from "review" to
  // "actual generation happens somewhere else now".
  { id: 'generate_videos', label: 'Generate videos', description: (n) => n > 0
      ? `Rendering the ${n} final ${n === 1 ? 'video' : 'videos'} with the video model`
      : 'Rendering the final videos with the video model' },
]

function DirectorStatusPanel() {
  const step = useDirectorSlice('step')
  const loading = useDirectorSlice('loading')
  const loadingMessage = useDirectorSlice('loadingMessage')
  const cancel = useStore(s => s.cancelDirectorV2Plan)
  // Live progress feeds from the backend. The Director pipeline status
  // exposes {current, total, step, total_steps, current_clip, total_clips}
  // for the heavy generation phases; the image-generation step has its
  // own dedicated counter (directorImageGenProgress) which the polling
  // loop keeps fresh. Reading both lets each phase show its own precise
  // percentage instead of a generic spinner.
  const pipelineProgress = useStore(s => s.pipelineStatus?.progress)
  const imageGenProgress = useDirectorSlice('imageGenProgress')
  // Analyze phase feeds its own precise counter via the
  // /api/v1/audio/analyze/status polling loop. The backend reports
  // step numbers as "1 of 6 … 6 of 6" so the sub-bar shows "Step 3 / 6"
  // while Whisper / pyannote / vocal extraction are running. When the
  // counter is null (backend hasn't reported yet, or analyze was
  // skipped) we fall back to the indeterminate sliding bar.
  const analyzeProgress = useDirectorSlice('analyzeProgress')
  const plannedClipsCount = useStore(s => s.directorPlannedClips.length)
  const clipImagesCount = useStore(s => s.directorClipImages.length)
  const clipPlansCount = useStore(s => s.directorClipPlans.length)
  const [expanded, setExpanded] = useState(true)
  // Only mount the strip once the user has progressed past the empty
  // upload prompt, OR if the director is currently processing. Keeps
  // the first-run workspace clean.
  const currentIndex = STATUS_STEPS.findIndex(s => s.id === step)
  const hasActivity = loading || currentIndex > 0
  if (!hasActivity) return null

  const activeStep = STATUS_STEPS[currentIndex] || STATUS_STEPS[0]
  const completedCount = STATUS_STEPS.filter((_, i) => i < currentIndex).length
  const totalSteps = STATUS_STEPS.length
  const pct = Math.round(((currentIndex + (loading ? 0.5 : 1)) / totalSteps) * 100)

  // Per-step sub-progress. Each entry returns {pct, label} where pct is
  // 0..100 for the inner bar and label is the human-readable progress
  // string ("3 / 28 clips", "≈ 6,400 / 9,424 tokens"). When the step
  // is not active or the backend hasn't reported numbers yet, pct is
  // null and the caller renders a plain spinner instead of a bar.
  const subProgress = ((): { pct: number | null; label: string } => {
    if (!loading) return { pct: 100, label: 'Complete' }
    // Cast to string because the StatusStrip declares an extra
    // `generate_videos` step (the actual rendering phase that takes
    // over once the user clicks Generate from the review_video stage)
    // that is NOT a member of the store's DirectorStep union — the
    // Director pipeline status drives that phase, not directorStep.
    switch (step as string) {
      case 'upload': {
        // No upload progress is wired into the store yet — the XHR
        // upload fires through plain fetch, so the best we can show is
        // an indeterminate spinner. Placeholder so the sub-bar slot
        // exists for when it does get wired up.
        return { pct: null, label: loadingMessage || 'Uploading…' }
      }
      case 'analyze': {
        // The analyze phase runs a few sequential sub-steps
        // (transcribe → diarize → classify sections → structure).
        // The dedicated directorAnalyzeProgress slice (fed by the
        // /audio/analyze/status polling loop) gives us precise per-step
        // counts (1/6 → 6/6); pipelineProgress.total_steps is the
        // Director-orchestrator-level step counter and only lights up
        // once the analyze phase hands off to the LLM planner. Prefer
        // the analyze counter when it has numbers — it's the more
        // granular signal for the long first phase.
        if (analyzeProgress && analyzeProgress.total > 0) {
          const p = Math.round((analyzeProgress.current / analyzeProgress.total) * 100)
          return { pct: p, label: `Step ${analyzeProgress.current} / ${analyzeProgress.total}` }
        }
        if (pipelineProgress?.total_steps && pipelineProgress.total_steps > 0) {
          const p = Math.round(((pipelineProgress.step || 0) / pipelineProgress.total_steps) * 100)
          return { pct: p, label: `${pipelineProgress.step || 0} / ${pipelineProgress.total_steps} steps` }
        }
        return { pct: null, label: loadingMessage || 'Analyzing audio…' }
      }
      case 'structure': {
        return { pct: null, label: loadingMessage || `Segmenting into ${plannedClipsCount || 0} clips…` }
      }
      case 'plan': {
        // Image prompts pass 1 — the LLM streams up to max_tokens.
        // The base planner's _run_checkpointed_json_batches already
        // emits current/total via the planning progress callback as
        // each batch completes ("Planned 4 / 28 music-video timeline
        // items"), so we can show a precise batch-level percentage
        // here even though the per-token count is not exposed.
        if (pipelineProgress?.total && pipelineProgress.total > 0) {
          const p = Math.round((pipelineProgress.current / pipelineProgress.total) * 100)
          return {
            pct: p,
            label: `${pipelineProgress.current} / ${pipelineProgress.total} ${plannedClipsCount > 0 ? 'clips' : 'items'}`,
          }
        }
        return { pct: null, label: loadingMessage || 'Writing image prompts…' }
      }
      case 'generate_images': {
        // DirectorImageGenProgress carries {current, total,
        // currentClipLabel}. total is 28 (one per planned clip) for
        // non-short-film runs.
        if (imageGenProgress && imageGenProgress.total > 0) {
          const p = Math.round((imageGenProgress.current / imageGenProgress.total) * 100)
          return {
            pct: p,
            label: `${imageGenProgress.current} / ${imageGenProgress.total} — ${imageGenProgress.currentClipLabel || 'rendering'}`,
          }
        }
        // Fallback to clipImages count if the dedicated counter isn't
        // populated yet (it gets seeded on the first response from the
        // generation endpoint).
        if (plannedClipsCount > 0) {
          const p = Math.round((clipImagesCount / plannedClipsCount) * 100)
          return { pct: p, label: `${clipImagesCount} / ${plannedClipsCount} images` }
        }
        return { pct: null, label: loadingMessage || 'Generating images…' }
      }
      case 'plan_video': {
        // Same pattern as `plan` — the video-prompt batch planner
        // emits precise current/total via the planning progress
        // callback. Show that ratio whenever it's available.
        if (pipelineProgress?.total && pipelineProgress.total > 0) {
          const p = Math.round((pipelineProgress.current / pipelineProgress.total) * 100)
          return {
            pct: p,
            label: `${pipelineProgress.current} / ${pipelineProgress.total} video prompts`,
          }
        }
        return { pct: null, label: loadingMessage || 'Writing video prompts…' }
      }
      case 'generate_videos': {
        // Final render — pipeline status carries current_clip /
        // total_clips so the bar reflects the live clip index even
        // across multi-window sequences (some clips split into
        // several windows; total_clips stays at the master clip
        // count).
        const total = pipelineProgress?.total_clips ?? plannedClipsCount ?? 0
        const current = pipelineProgress?.current_clip ?? 0
        if (total > 0 && current > 0) {
          const p = Math.round((current / total) * 100)
          return {
            pct: p,
            label: pipelineProgress?.message || `Clip ${current} / ${total}`,
          }
        }
        if (clipPlansCount > 0) {
          return { pct: null, label: `${clipPlansCount} clips queued` }
        }
        return { pct: null, label: loadingMessage || 'Rendering videos…' }
      }
      default:
        return { pct: null, label: loadingMessage || 'Working…' }
    }
  })()

  return (
    <div
      className="min-w-0 shrink-0 border-b border-border bg-bg-secondary/60 px-4 py-2.5"
      data-testid="director-status-panel"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
          aria-expanded={expanded}
          title={expanded ? 'Hide planning steps' : 'Show planning steps'}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span>Director status</span>
        </button>
        {/* Inline progress chip — always visible so the user has a
            glanceable signal even when the strip is collapsed. */}
        <div className="flex items-center gap-1.5 min-w-0">
          {loading ? (
            <Loader2 size={11} className="animate-spin text-accent-blue shrink-0" />
          ) : (
            <Check size={11} className="text-emerald-400 shrink-0" />
          )}
          <span className="text-2xs text-text-secondary truncate">
            {loading ? (loadingMessage || activeStep.description(plannedClipsCount)) : `${activeStep.label} complete`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-2xs text-text-muted tabular-nums">
            {Math.min(completedCount + (loading ? 1 : 0), totalSteps)} / {totalSteps} · {pct}%
          </span>
          {loading && (
            <button
              type="button"
              onClick={() => cancel()}
              title="Stop planning"
              aria-label="Stop planning"
              className="rounded-md p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>
      {/* Progress bar — thin, two-tone (active segment in accent blue,
          completed in emerald, pending in bg-active). */}
      <div className="mt-1.5 h-1 rounded-full bg-bg-active overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ease-out ${loading ? 'bg-accent-blue' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Sub-progress bar — precise per-step percentage sourced from the
          backend's pipeline status or the dedicated image-gen counter.
          Sits just below the global bar so the user can see both "where
          am I in the 10-step pipeline" and "how much of THIS step is
          done". Falls back to an indeterminate pulse when the backend
          hasn't reported numbers yet (LLM streaming, structure
          segmentation, etc.) so the slot is always alive while the
          step is active. Hidden when not loading — keeps the strip
          compact once everything settles. */}
      {loading && (
        <div className="mt-1 flex items-center gap-2" data-testid="director-status-subprogress">
          <div className="relative h-0.5 flex-1 rounded-full bg-bg-active overflow-hidden">
            {subProgress.pct != null ? (
              <div
                className="absolute inset-y-0 left-0 bg-accent-blue/70 transition-all duration-500 ease-out"
                style={{ width: `${subProgress.pct}%` }}
              />
            ) : (
              // Indeterminate: a 30%-wide bar that glides left↔right so
              // the user sees *something* moving without a number to
              // trust. Pure CSS animation, no JS interval.
              <div className="absolute inset-y-0 left-0 w-1/3 bg-accent-blue/60 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
            )}
          </div>
          <span className="text-2xs text-text-muted tabular-nums whitespace-nowrap">
            {subProgress.pct != null ? `${subProgress.pct}%` : ''}
          </span>
        </div>
      )}
      {expanded && (
        <ol className="mt-2.5 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-1.5">
          {STATUS_STEPS.map((s, i) => {
            const isActive = i === currentIndex && loading
            const isDone = i < currentIndex || (i === currentIndex && !loading)
            return (
              <li
                key={s.id}
                className={`flex items-start gap-1.5 text-2xs leading-snug ${
                  isActive ? 'text-text-primary' : isDone ? 'text-text-secondary' : 'text-text-muted'
                }`}
                data-status={isActive ? 'active' : isDone ? 'done' : 'pending'}
              >
                <span className="mt-0.5 shrink-0">
                  {isActive ? (
                    <Loader2 size={10} className="animate-spin text-accent-blue" />
                  ) : isDone ? (
                    <Check size={10} className="text-emerald-400" />
                  ) : (
                    <span className="block h-2.5 w-2.5 rounded-full border border-border" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="font-medium uppercase tracking-wider">{s.label}</span>
                  {isActive && loadingMessage && (
                    <span className="block text-text-muted mt-0.5 normal-case tracking-normal">
                      {loadingMessage}
                    </span>
                  )}
                  {!isActive && (
                    <span className="block text-text-muted mt-0.5 normal-case tracking-normal">
                      {s.description(plannedClipsCount)}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

export function DirectorStage() {
  const pipelineId = useStore(s => s.pipelineId)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  const directorStep = useStore(s => s.directorStep)
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
    >
      <div className="director-stage-columns">
        <aside className="director-stage-chat" aria-label="Director chat & decisions">
          <DirectorChat />
        </aside>
        <section className="director-stage-plan" aria-label="Director plan & shots">
          <DirectorStatusPanel />
          <div className="flex-1 min-h-0 min-w-0 overflow-auto">
            {pipelineStatus?.status === 'paused' ? (
              <section aria-label="Production review and progress">
                <DirectorReview />
              </section>
            ) : <DirectorPlanColumn />}
          </div>
        </section>
        <aside className="director-stage-options" aria-label="Director generation options">
          {directorStep !== 'upload' ? (
            <DirectorGenerationOptions />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-bg-tertiary p-6 text-center text-xs text-text-muted">
              Generation options appear after you upload your audio and reference images.
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}