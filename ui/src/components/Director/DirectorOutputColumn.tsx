import { useState } from 'react'
import {
  Film,
  Sparkles,
  Layers,
  Loader2,
  Maximize2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { getFileUrl } from '../../api/client'

export function DirectorOutputColumn() {
  const plannedClips = useStore(s => s.directorPlannedClips)
  const clipPlans = useStore(s => s.directorClipPlans)
  const clipImages = useStore(s => s.directorClipImages)
  const imageGenProgress = useStore(s => s.directorImageGenProgress)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  const editClipPlan = useStore(s => s.directorEditClipPlan)

  const selectedClipIndex = useStore(s => s.directorSelectedClipIndex)
  const setSelectedClipIndex = useStore(s => s.setDirectorSelectedClipIndex)
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null)

  const totalClips = Math.max(plannedClips.length, clipPlans.length, clipImages.length)

  const selectedClipImage = clipImages.find(item => item.clipIndex === selectedClipIndex)
  const selectedPlan = clipPlans[selectedClipIndex]
  const selectedClip = plannedClips[selectedClipIndex]
  const isSelectedGenerating = imageGenProgress?.current === selectedClipIndex

  // Resolve generated video for this clip if available
  const rawClips = (pipelineStatus as (typeof pipelineStatus & { clips?: Array<{ video_filename?: string | null }> }))?.clips
  const clipState = rawClips?.[selectedClipIndex]
  const rawVideo = clipState?.video_filename || pipelineStatus?.output_files?.[selectedClipIndex]
  const selectedVideoFilename = typeof rawVideo === 'string' && (rawVideo.endsWith('.mp4') || rawVideo.endsWith('.webm') || rawVideo.endsWith('.mov'))
    ? rawVideo
    : null
  const isVideoGenerating = pipelineStatus?.status === 'running' && pipelineStatus?.progress?.current_clip === selectedClipIndex + 1

  const getClipImageUrl = (item: typeof clipImages[number] | undefined): string | null => {
    if (!item) return null
    if (item.file) return URL.createObjectURL(item.file)
    if (item.filename) return getFileUrl(item.filename)
    return null
  }

  const selectedImageUrl = getClipImageUrl(selectedClipImage)

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
      </header>

      {/* Main output / preview body */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 -mr-1">
        {/* Preview Player / Canvas */}
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-primary flex items-center gap-1.5">
              <Film size={13} className="text-text-muted" />
              {totalClips > 0 ? `Corte #${selectedClipIndex + 1}` : 'Monitor de Preview'}
            </span>
            <div className="flex items-center gap-2">
              {totalClips > 1 && (
                <div className="flex items-center gap-1 bg-bg-tertiary/80 rounded border border-border/60 px-1 py-0.5">
                  <button
                    type="button"
                    onClick={() => setSelectedClipIndex(Math.max(0, selectedClipIndex - 1))}
                    disabled={selectedClipIndex === 0}
                    className="p-1 rounded text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed hover:bg-bg-secondary"
                    title="Cena anterior"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span className="text-2xs font-mono font-medium text-text-secondary px-1">
                    {selectedClipIndex + 1} / {totalClips}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedClipIndex(Math.min(totalClips - 1, selectedClipIndex + 1))}
                    disabled={selectedClipIndex >= totalClips - 1}
                    className="p-1 rounded text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed hover:bg-bg-secondary"
                    title="Próxima cena"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              )}
              {selectedClip && (
                <span className="text-2xs text-text-muted font-mono">
                  {selectedClip.start.toFixed(1)}s – {selectedClip.end.toFixed(1)}s ({(selectedClip.end - selectedClip.start).toFixed(1)}s)
                </span>
              )}
            </div>
          </div>

          {/* Canvas area */}
          <div className="aspect-video w-full rounded-md bg-black/60 border border-border/70 overflow-hidden relative flex items-center justify-center group select-none">
            {selectedVideoFilename ? (
              <video
                src={getFileUrl(selectedVideoFilename)}
                controls
                playsInline
                preload="metadata"
                className="w-full h-full object-contain"
              />
            ) : isVideoGenerating ? (
              <div className="flex flex-col items-center gap-2 text-accent-purple">
                <Loader2 size={24} className="animate-spin" />
                <span className="text-2xs font-medium">Renderizando vídeo...</span>
              </div>
            ) : selectedImageUrl ? (
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
        </section>

        {/* Informações detalhadas da cena selecionada */}
        <section className="flex flex-col gap-2.5 flex-1 min-h-[140px]">
          <div className="flex items-center justify-between pb-1 border-b border-border/40 shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <Film size={12} className="text-accent-blue" />
              Prompt de Vídeo {totalClips > 0 ? `(Cena #${selectedClipIndex + 1})` : ''}
            </span>
            {totalClips > 0 && (
              <span className="text-2xs text-text-muted">
                {selectedClipIndex + 1} de {totalClips}
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 bg-bg-tertiary/60 rounded-md p-3 border border-border/60 text-xs text-text-primary leading-relaxed flex flex-col gap-2">
            {selectedPlan ? (
              <div className="flex-1 flex flex-col gap-2 min-h-0">
                <textarea
                  value={selectedPlan.video_prompt || ''}
                  onChange={e => editClipPlan(selectedClipIndex, 'video_prompt', e.target.value)}
                  placeholder="Descreva o movimento de câmera e ação do vídeo..."
                  className="w-full flex-1 min-h-[90px] bg-bg-secondary border border-border rounded-lg p-2.5 text-xs text-text-primary placeholder:text-text-muted/60 resize-none focus:outline-none focus:border-accent-blue transition-colors leading-relaxed"
                />
                {selectedPlan.image_prompt && (
                  <div className="shrink-0 pt-2 border-t border-border/40">
                    <span className="text-3xs uppercase tracking-wider font-semibold text-text-muted block mb-1">
                      Prompt da Imagem Inicial
                    </span>
                    <p className="text-2xs text-text-secondary leading-relaxed bg-bg-secondary/70 p-2 rounded border border-border/50 max-h-24 overflow-y-auto">
                      {selectedPlan.image_prompt}
                    </p>
                  </div>
                )}
              </div>
            ) : totalClips === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-4 space-y-1.5">
                <Sparkles size={16} className="text-accent-blue/70" />
                <p className="text-2xs text-text-muted">Adicione música ou roteiro no Briefing para planejar os cortes.</p>
              </div>
            ) : (
              <p className="text-text-muted italic">Nenhum prompt definido para esta cena.</p>
            )}
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
