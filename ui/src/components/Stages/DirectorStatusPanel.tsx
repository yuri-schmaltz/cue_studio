import { Check, Loader2, X } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { useDirectorSlice } from '../../stores/directorSelectors'

export type StepMeta = {
  id: string
  label: string
  description: (clipCount: number) => string
}

export const STATUS_STEPS: StepMeta[] = [
  { id: 'upload', label: 'Upload', description: () => 'Recebendo áudio e referências' },
  { id: 'analyze', label: 'Analyze', description: () => 'Transcrevendo áudio, detectando vozes e seções' },
  { id: 'structure', label: 'Plan structure', description: (n) => n > 0 ? `Segmentando música em ${n} clipes e batidas` : 'Segmentando música em clipes e batidas' },
  { id: 'style', label: 'Scene description', description: () => 'Definindo descrição da cena, personagens e estilo' },
  { id: 'plan', label: 'Image prompts', description: (n) => n > 0 ? `LLM escrevendo prompts de imagem para ${n} clipes` : 'LLM escrevendo prompts de imagem' },
  { id: 'review', label: 'Review image prompts', description: (n) => n > 0 ? `Revisando prompts de imagem dos ${n} clipes` : 'Revisando prompts de imagem' },
  { id: 'generate_images', label: 'Generate images', description: (n) => n > 0 ? `Renderizando ${n} imagens iniciais` : 'Renderizando imagens iniciais' },
  { id: 'plan_video', label: 'Video prompts', description: (n) => n > 0 ? `LLM escrevendo prompts de vídeo para ${n} clipes` : 'LLM escrevendo prompts de vídeo' },
  { id: 'review_video', label: 'Review video prompts', description: (n) => n > 0 ? `Revisando prompts de vídeo dos ${n} clipes` : 'Revisando prompts de vídeo' },
  { id: 'generate_videos', label: 'Generate videos', description: (n) => n > 0 ? `Renderizando ${n} vídeos finais` : 'Renderizando vídeos finais' },
]

/**
 * DirectorStatusPanel — Card de progresso conciso e informativo localizado
 * na base da coluna central (DirectorPlanColumn).
 *
 * Apresenta:
 * 1. Linha de status do Pipeline (processando/ocioso) com mensagem dinâmica e cancelamento.
 * 2. Indicador da Etapa atual com contagem (ex: 2/10: Analyze).
 * 3. Barra de progresso segmentada em 10 etapas com tooltips informativos e cores de estado.
 */
export function DirectorStatusPanel() {
  const step = useDirectorSlice('step')
  const loading = useDirectorSlice('loading')
  const loadingMessage = useDirectorSlice('loadingMessage')
  const cancel = useStore(s => s.cancelPlan)
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
  // avoiding redundancy with the "processando" state label.
  const subStatus = imageGenProgress?.total
    ? `Imagem ${imageGenProgress.current}/${imageGenProgress.total}${imageGenProgress.currentClipLabel ? ` (${imageGenProgress.currentClipLabel})` : ''}`
    : loadingMessage && !/^(processando|processing)[\.…]*$/i.test(loadingMessage.trim())
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
              {loading ? 'processando' : 'ocioso'}
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

          {loading && (
            <button
              type="button"
              onClick={() => { void cancel() }}
              title="Interromper pipeline"
              aria-label="Interromper pipeline"
              className="shrink-0 p-0.5 rounded text-text-muted hover:text-red-400 hover:bg-bg-hover transition-colors ml-0.5"
            >
              <X size={11} />
            </button>
          )}
        </div>

        {/* Direita: Nome da Etapa e chip com contagem 1/10 */}
        <div className="flex items-center gap-1.5 shrink-0 text-2xs">
          <span className="text-text-muted">Etapa:</span>
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
