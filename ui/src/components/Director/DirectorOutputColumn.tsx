import { useState, useMemo } from 'react'
import {
  Film,
  Sparkles,
  ExternalLink,
  Send,
  Layers,
  Loader2,
  Maximize2,
} from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { getFileUrl } from '../../api/client'

export function DirectorOutputColumn() {
  const plannedClips = useStore(s => s.directorPlannedClips)
  const clipPlans = useStore(s => s.directorClipPlans)
  const clipImages = useStore(s => s.directorClipImages)
  const imageGenProgress = useStore(s => s.directorImageGenProgress)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  const applyToClips = useStore(s => s.directorApplyToClips)
  const queueCurrent = useStore(s => s.queueCurrentDirectorPipeline)
  const setAppSection = useStore(s => s.setAppSection)

  const [selectedClipIndex, setSelectedClipIndex] = useState(0)
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null)

  const totalClips = Math.max(plannedClips.length, clipPlans.length, clipImages.length)
  const generatedCount = useMemo(() => {
    return clipImages.length
  }, [clipImages])

  const selectedClipImage = clipImages.find(item => item.clipIndex === selectedClipIndex)
  const selectedPlan = clipPlans[selectedClipIndex]
  const selectedClip = plannedClips[selectedClipIndex]
  const isSelectedGenerating = imageGenProgress?.current === selectedClipIndex

  const getClipImageUrl = (item: typeof clipImages[number] | undefined): string | null => {
    if (!item) return null
    if (item.file) return URL.createObjectURL(item.file)
    if (item.filename) return getFileUrl(item.filename)
    return null
  }

  const selectedImageUrl = getClipImageUrl(selectedClipImage)

  const pipelineActive = Boolean(
    pipelineStatus && !['completed', 'failed', 'cancelled'].includes(pipelineStatus.status),
  )

  const handleOpenEditor = () => {
    applyToClips()
    setAppSection('editor')
  }

  // Footer data (video model and GPU VRAM)
  const rodapeModelName = useStore(s => {
    const selected = s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    const def = s.models.find(item => item.model_type === selected)
    return def?.name || selected
  })
  const rodapeArchitecture = useStore(s => {
    const selected = s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    return s.models.find(item => item.model_type === selected)?.architecture
  })
  const rodapeVramUsedGb = useStore(s => (s.systemStats?.gpu.available ? s.systemStats?.gpu.vram_used_gb : null))
  const rodapeVramTotalGb = useStore(s => s.systemStats?.gpu.vram_total_gb ?? 0)
  const rodapeGpuAvailable = useStore(s => s.systemStats?.gpu.available ?? false)
  const rodapeVram = rodapeGpuAvailable && rodapeVramUsedGb != null
    ? { usedGb: rodapeVramUsedGb, totalGb: rodapeVramTotalGb }
    : null

  return (
    <div className="h-full flex flex-col space-y-3 min-h-0" data-testid="director-output-column">
      {/* Header */}
      <header className="flex items-center justify-between shrink-0 px-1 py-0.5">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-accent-blue" />
          <h2 className="text-xs uppercase tracking-wider font-semibold text-text-muted">
            Outputs &amp; Preview
          </h2>
        </div>
        {totalClips > 0 && (
          <span className="text-2xs font-medium px-2 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue border border-accent-blue/30">
            {generatedCount}/{totalClips} gerados
          </span>
        )}
      </header>

      {/* Main output / preview body */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 -mr-1">
        {/* Preview Player / Canvas */}
        <section className="bg-bg-secondary rounded-lg p-3 border border-border flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-primary flex items-center gap-1.5">
              <Film size={13} className="text-text-muted" />
              {totalClips > 0 ? `Corte #${selectedClipIndex + 1}` : 'Monitor de Preview'}
            </span>
            {selectedClip && (
              <span className="text-2xs text-text-muted font-mono">
                {selectedClip.start.toFixed(1)}s – {selectedClip.end.toFixed(1)}s ({(selectedClip.end - selectedClip.start).toFixed(1)}s)
              </span>
            )}
          </div>

          {/* Canvas area */}
          <div className="aspect-video w-full rounded-md bg-black/60 border border-border/70 overflow-hidden relative flex items-center justify-center group select-none">
            {selectedImageUrl ? (
              <>
                <img
                  src={selectedImageUrl}
                  alt={`Preview do corte ${selectedClipIndex + 1}`}
                  className="w-full h-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => setFullscreenImage(selectedImageUrl)}
                  title="Ver imagem em tamanho ampliado"
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/90"
                >
                  <Maximize2 size={13} />
                </button>
              </>
            ) : isSelectedGenerating ? (
              <div className="flex flex-col items-center gap-2 text-accent-blue">
                <Loader2 size={24} className="animate-spin" />
                <span className="text-2xs font-medium">Gerando storyboard...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-text-muted/60 p-4 text-center">
                <Film size={26} className="text-text-muted/40 stroke-1" />
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-text-secondary">Nenhum preview para este corte</p>
                  <p className="text-2xs max-w-xs text-text-muted/80">
                    O storyboard ou os frames gerados para este clipe aparecerão aqui.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Prompt info under preview */}
          {selectedPlan && (
            <div className="rounded bg-bg-tertiary/60 p-2 border border-border/40 text-2xs space-y-1">
              <span className="text-text-muted font-medium uppercase tracking-wider block">
                Prompt do Corte
              </span>
              <p className="text-text-secondary line-clamp-3 leading-relaxed">
                {selectedPlan.video_prompt || selectedPlan.image_prompt || 'Sem prompt definido'}
              </p>
            </div>
          )}
        </section>

        {/* Storyboard / Clips Grid */}
        <section className="bg-bg-secondary rounded-lg p-3 border border-border flex flex-col gap-2">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Galeria de Cortes
            </span>
            <span className="text-2xs text-text-muted">
              {totalClips} {totalClips === 1 ? 'clipe' : 'clipes'}
            </span>
          </div>

          {totalClips === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-6 text-center space-y-2">
              <Sparkles size={18} className="mx-auto text-accent-blue/70" />
              <p className="text-2xs text-text-muted leading-relaxed">
                Adicione música ou roteiro no Briefing para planejar os cortes.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
              {Array.from({ length: totalClips }).map((_, idx) => {
                const clipImage = clipImages.find(item => item.clipIndex === idx)
                const imgUrl = getClipImageUrl(clipImage)
                const isSelected = selectedClipIndex === idx
                const isGeneratingCurrent = imageGenProgress?.current === idx

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedClipIndex(idx)}
                    className={`relative aspect-video rounded border overflow-hidden transition-all text-left group ${
                      isSelected
                        ? 'border-accent-blue ring-1 ring-accent-blue bg-accent-blue/10'
                        : 'border-border bg-bg-tertiary hover:border-border-light'
                    }`}
                  >
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={`Corte ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : isGeneratingCurrent ? (
                      <div className="w-full h-full flex items-center justify-center bg-bg-tertiary text-accent-blue">
                        <Loader2 size={12} className="animate-spin" />
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-bg-tertiary/70 text-text-muted">
                        <span className="text-2xs font-mono font-medium">#{idx + 1}</span>
                      </div>
                    )}

                    {/* Badge de número no canto */}
                    <span className="absolute bottom-1 left-1 px-1 py-0.2 bg-black/75 rounded text-3xs font-mono text-white">
                      {idx + 1}
                    </span>

                    {/* Status dot */}
                    {imgUrl && (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-sm" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Handoff Actions */}
        <section className="bg-bg-secondary rounded-lg p-3 border border-border space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block">
            Ações de Saída
          </span>

          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={handleOpenEditor}
              disabled={totalClips === 0}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors shadow-sm"
            >
              <ExternalLink size={13} />
              <span>Abrir no Editor Timeline</span>
            </button>

            <button
              type="button"
              onClick={() => queueCurrent()}
              disabled={totalClips === 0 || pipelineActive}
              className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg border border-border bg-bg-tertiary hover:bg-bg-tertiary/80 hover:border-border-light disabled:opacity-50 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary text-xs font-medium transition-colors"
            >
              <Send size={12} />
              <span>Adicionar à Fila (Queue)</span>
            </button>
          </div>
        </section>
      </div>

      {/* Footer com Status da GPU / VRAM e Modelo */}
      <div
        className="mt-auto shrink-0 border-t border-border/40 bg-bg-secondary/70 backdrop-blur-sm px-3 h-[54px] min-h-[54px] flex flex-col justify-center gap-1.5 text-2xs text-text-muted/80 select-none"
        data-testid="director-output-rodape"
        aria-label="Selected model and VRAM usage"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 min-w-0 truncate">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent-blue/70" />
            <span className="truncate">
              {rodapeModelName}
              {rodapeArchitecture && (
                <span className="text-text-muted/50 ml-1">· {rodapeArchitecture}</span>
              )}
            </span>
          </span>
          <span className="shrink-0 font-mono text-3xs text-text-muted/70">
            {rodapeVram ? `${rodapeVram.usedGb.toFixed(1)} / ${rodapeVram.totalGb.toFixed(0)} GB` : 'VRAM unavailable'}
          </span>
        </div>
      </div>

      {/* Fullscreen modal */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setFullscreenImage(null)}
        >
          <div className="relative max-w-4xl max-h-[85vh] flex flex-col items-center">
            <img
              src={getFileUrl(fullscreenImage)}
              alt="Preview ampliado"
              className="max-w-full max-h-[80vh] object-contain rounded-lg border border-border shadow-2xl"
            />
            <span className="text-2xs text-text-muted mt-2">Clique em qualquer lugar para fechar</span>
          </div>
        </div>
      )}
    </div>
  )
}
