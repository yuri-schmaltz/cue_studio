import { Check, Loader2, X } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { useDirectorSlice } from '../../stores/directorSelectors'

// ---------------------------------------------------------------------------
// DirectorStatusPanel — single-line status strip mirroring what the
// Director pipeline is doing right now (analyze, plan, generate images,
// review, etc.). Extracted from DirectorStage so the App shell can render
// it inside the bottom HardwareStatusBar (via the bar's `leftSlot`) —
// the user asked to flatten the previous stacked card onto the same row
// as GPU/VRAM/CPU/RAM/No model. Everything here renders on a single
// horizontal line: 10 step pills + a counter chip + a cancel button.
// The previous stacked card (label row + two-tone progress bar + chip
// list) is gone — the chips themselves carry the progress information.
// ---------------------------------------------------------------------------

type StepMeta = {
  id: string
  label: string
  description: (clipCount: number) => string
}

export const STATUS_STEPS: StepMeta[] = [
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

/**
 * Renders the pipeline status as a single-line strip. Designed to live
 * inside the bottom status bar (HardwareStatusBar's leftSlot) alongside
 * the GPU/VRAM/CPU/RAM/No model gauges. Layout:
 *
 *   [step pills with ✓ / spinner / · separators]  [2/10]  [×]
 *
 * Each step is colour-coded:
 *   - done     → emerald ✓ + secondary text
 *   - active   → blue spinner + primary text (and a tooltip with the
 *                current loadingMessage so the user can see what the
 *                backend is doing — "Transcribing audio…", "Loading
 *                model: gemma-4-E4B-it-heretic on cuda", etc.)
 *   - pending  → muted dot + muted text
 *
 * The strip returns null while the user has not progressed past the
 * upload step (and nothing is loading), keeping the bottom bar uncluttered
 * on first launch.
 */
export function DirectorStatusPanel() {
  const step = useDirectorSlice('step')
  const loading = useDirectorSlice('loading')
  const loadingMessage = useDirectorSlice('loadingMessage')
  const cancel = useStore(s => s.cancelDirectorV2Plan)
  const plannedClipsCount = useStore(s => s.directorPlannedClips.length)

  const currentIndex = STATUS_STEPS.findIndex(s => s.id === step)
  const hasActivity = loading || currentIndex > 0
  if (!hasActivity) return null

  const activeStep = STATUS_STEPS[currentIndex] || STATUS_STEPS[0]
  const completedCount = STATUS_STEPS.filter((_, i) => i < currentIndex).length
  const totalSteps = STATUS_STEPS.length

  return (
    <div
      className="flex items-center gap-2 min-w-0"
      data-testid="director-status-panel"
      aria-live="polite"
      aria-label={`Director pipeline: ${activeStep.label}, step ${Math.min(completedCount + (loading ? 1 : 0), totalSteps)} of ${totalSteps}`}
    >
      {/* Inline progress strip — only renders while loading so the bar
          stays out of the way when idle. Shows current/total clip
          counts (e.g. 2/3) when the pipeline exposes them, otherwise
          the indeterminate shimmer (animate-pulse). The backend fills
          in `directorImageGenProgress.current / total` for image
          generation and similar fields for video generation; when
          nothing is exposed yet, the bar still shows progress via the
          chip animation alone. */}
      {loading && (() => {
        const p = useStore(s => s.directorImageGenProgress)
        const determinate = Boolean(p?.total && p.total > 0)
        const pct = determinate
          ? Math.min(100, Math.round(((p?.current ?? 0) / (p?.total ?? 1)) * 100))
          : 40
        return (
          <div
            aria-hidden="true"
            data-testid="director-status-progress"
            className="relative h-1 w-16 rounded-full bg-bg-tertiary overflow-hidden shrink-0"
          >
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${
                determinate ? 'bg-accent-blue' : 'bg-accent-blue/60 animate-pulse'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )
      })()}
      {/* Compact status icon — mirrors the active/loading state so the
          user sees a single visual cue before reading the chips. */}
      {loading ? (
        <Loader2 size={11} className="animate-spin text-accent-blue shrink-0" aria-hidden="true" />
      ) : (
        <Check size={11} className="text-emerald-400 shrink-0" aria-hidden="true" />
      )}

      {/* Inline step chips — each one a tiny ✓ / spinner / dot followed
          by the label. `whitespace-nowrap` keeps everything on a single
          line; if the bar ever gets narrower than the chip strip, the
          outer flex parent can wrap (overflow handled by min-w-0 +
          flex-shrink on the chips). */}
      <ol className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
        {STATUS_STEPS.map((s, i) => {
          // Three visual states, derived strictly from the pipeline
          // advance marker (currentIndex):
          //   - active  : this step is currently running (loading=true
          //               and the store has bumped us into this step).
          //   - done    : we have already advanced past this step.
          //   - pending : we haven't reached this step yet — OR the
          //               store says we're here but with loading=false,
          //               which means the user has only navigated the
          //               UI to this step (e.g. opened a project mid-
          //               flow) without the backend actually running
              //               work. Showing ✓ in that case would lie.
          const isActive = i === currentIndex && loading
          const isDone = i < currentIndex
          return (
            <li
              key={s.id}
              className={`flex items-center gap-1 text-2xs whitespace-nowrap ${
                isActive ? 'text-text-primary' : isDone ? 'text-text-secondary' : 'text-text-muted'
              }`}
              data-status={isActive ? 'active' : isDone ? 'done' : 'pending'}
              title={
                isActive && loadingMessage
                  ? `${s.label} — ${loadingMessage}`
                  : isActive
                    ? s.description(plannedClipsCount)
                    : s.label
              }
            >
              <span className="shrink-0">
                {isActive ? (
                  <Loader2 size={9} className="animate-spin text-accent-blue" />
                ) : isDone ? (
                  <Check size={9} className="text-emerald-400" />
                ) : (
                  <span className="block h-1.5 w-1.5 rounded-full bg-text-muted/40" />
                )}
              </span>
              <span>{s.label}</span>
            </li>
          )
        })}
      </ol>

      {/* Counter chip + cancel button — mirrors the previous stacked
          card's right-hand cluster so the user still sees the global
          position (2/10) and can abort the pipeline when loading. */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-2xs font-medium text-text-secondary tabular-nums px-1.5 py-0.5 rounded bg-bg-tertiary border border-border/60">
          {Math.min(completedCount + (loading ? 1 : 0), totalSteps)}/{totalSteps}
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
  )
}
