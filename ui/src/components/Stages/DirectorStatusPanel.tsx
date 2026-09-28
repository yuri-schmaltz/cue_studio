import { Check, Loader2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { useDirectorSlice } from '../../stores/directorSelectors'

export type StepMeta = {
  id: string
  label: string
  description: (clipCount: number) => string
}

export const STATUS_STEPS: StepMeta[] = [
  { id: 'upload', label: 'Upload', description: () => 'Receiving audio and references' },
  { id: 'analyze', label: 'Analyze', description: () => 'Transcribing audio, detecting voices and sections' },
  { id: 'structure', label: 'Plan structure', description: (n) => n > 0 ? `Segmenting music into ${n} clips and beats` : 'Segmenting music into clips and beats' },
  { id: 'style', label: 'Scene description', description: () => 'Defining scene description, characters and style' },
  { id: 'plan', label: 'Image prompts', description: (n) => n > 0 ? `LLM writing image prompts for ${n} clips` : 'LLM writing image prompts' },
  { id: 'review', label: 'Review image prompts', description: (n) => n > 0 ? `Reviewing image prompts of ${n} clips` : 'Reviewing image prompts' },
  { id: 'generate_images', label: 'Generate images', description: (n) => n > 0 ? `Rendering ${n} initial images` : 'Rendering initial images' },
  { id: 'plan_video', label: 'Video prompts', description: (n) => n > 0 ? `LLM writing video prompts for ${n} clips` : 'LLM writing video prompts' },
  { id: 'review_video', label: 'Review video prompts', description: (n) => n > 0 ? `Reviewing video prompts of ${n} clips` : 'Reviewing video prompts' },
  { id: 'generate_videos', label: 'Generate videos', description: (n) => n > 0 ? `Rendering ${n} final videos` : 'Rendering final videos' },
]

/**
 * DirectorStatusPanel — Concise, informative progress card anchored to the
 * bottom of the central column (DirectorPlanColumn).
 *
 * Presents:
 * 1. Pipeline status line (idle/busy) with dynamic message.
 * 2. Current step indicator with count (e.g. 2/10: Analyze).
 * 3. Segmented 10-step progress bar with informative tooltips and state colors.
 */
export function DirectorStatusPanel() {
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

  // Sub-status text displayed alongside the pipeline state. Only shown when there
  // is specific contextual information (e.g. image progress or a descriptive phase),
  // avoiding redundancy with the busy state label rendered just to the left.
  const subStatus = imageGenProgress?.total
    ? `Image ${imageGenProgress.current}/${imageGenProgress.total}${imageGenProgress.currentClipLabel ? ` (${imageGenProgress.currentClipLabel})` : ''}`
    : loadingMessage && !/^(processing|busy|loading)[\.…]*$/i.test(loadingMessage.trim())
      ? loadingMessage
      : null

  return (
    <footer
      className="mt-auto shrink-0 border-t border-border/40 bg-bg-secondary/70 backdrop-blur-sm px-4 py-2.5 space-y-2 select-none"
      data-testid="director-status-panel"
      aria-label={`Progresso do pipeline: ${displayLabel}, etapa ${currentIndex + 1} de ${totalSteps}`}
    >
      {/* Linha 1: Status do Pipeline à esquerda, Etapa atual com contador à direita */}
      <div className="flex items-center justify-between gap-3 text-2xs">
        {/* Esquerda: Estado do Pipeline */}
        <div className="flex items-center gap-2 min-w-0">
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
            <span
              className="text-text-muted truncate max-w-[280px]"
              title={subStatus}
            >
              · {subStatus}
            </span>
          )}
        </div>

        {/* Right: Step name, inline description during loading
            (replaces the tooltip that only appeared on chip hover) and
            count 1/10. When idle the description stays hidden — only
            o label + chip, mantendo o painel enxuto. */}
        <div className="flex items-center gap-1.5 shrink-0 text-2xs">
          <span
            className="text-text-primary font-medium truncate max-w-[180px]"
            title={activeStep.description(plannedClipsCount)}
          >
            {displayLabel}
          </span>
          {loading && (
            <span
              className="text-text-muted truncate max-w-[260px]"
              title={activeStep.description(plannedClipsCount)}
            >
              · {activeStep.description(plannedClipsCount)}
            </span>
          )}
          <span className="font-mono text-2xs px-1.5 py-0.5 rounded bg-bg-tertiary border border-border/60 text-text-secondary font-medium tabular-nums ml-0.5">
            {currentIndex + 1}/{totalSteps}
          </span>
        </div>
      </div>

      {/* Linha 2: Barra de progresso segmentada em 10 etapas */}
      <div
        className="flex items-center gap-1 w-full"
        role="progressbar"
        aria-valuenow={currentIndex + 1}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-label={`Etapa ${currentIndex + 1} de ${totalSteps}: ${displayLabel}`}
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
    </footer>
  )
}
