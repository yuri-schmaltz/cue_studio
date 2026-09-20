import { DirectorTimelineEditor } from './DirectorTimelineEditor'
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Upload, Loader2, Music, Zap, RotateCcw, X, ChevronRight, ChevronDown, ImageIcon, Play } from 'lucide-react'

// === Speaker category helper functions ===
const getCategoryLabel = (text?: string): string => {
  if (!text) return 'other'
  let category: string = 'other'
  const lowerText = text.toLowerCase()
  if (/duet|dueto|dúo/i.test(lowerText)) { category = 'duet' }
  else if (/chorus|coral|corais|grupo/i.test(lowerText)) { category = 'choir' }
  else if (/(?<![_])rapping(?:ing)?/i.test(lowerText) || /\bdiss|flow/i.test(lowerText)) { category = 'rapping' }
  else if (/vocal(?:ist)?/i.test(text.split('_')[0] || '')) {
    const name = text.split('_')?.[1]?.toLowerCase() || ''
    if (/female|woman|ella|delia|laura/i.test(name)) { category = 'vocals_female' }
    else { category = 'vocals_male' }
  }
  return category
}

const SPEAKER_CATEGORIES: Array<{ id: string; label: string; color: string }> = [
  { id: 'vocals_male', label: 'Vocal Masculino', color: 'bg-green-500/20 text-chip-green border-green-400/30' },
  { id: 'vocals_female', label: 'Vocal Feminino', color: 'bg-pink-500/20 text-chip-pink border-pink-400/30' },
  { id: 'choir', label: 'Coro / Coral', color: 'bg-purple-500/20 text-chip-purple border-purple-400/30' },
  { id: 'rapping', label: 'Rap / Flow', color: 'bg-orange-500/20 text-chip-orange border-orange-400/30' },
  { id: 'duet', label: 'Dueto', color: 'bg-cyan-500/20 text-chip-cyan border-cyan-400/30' },
  { id: 'other', label: 'Outros / Instrumental', color: 'bg-gray-500/20 text-chip-gray border-gray-400/30' },
]

// === TYPES ===
interface PlannedClip {
  beat_count: number
  start: number
  end: number
  section_label: string
  energy: number
  dominant_speaker?: string
  imagePrompt?: string
  videoPrompt?: string
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const sectionColors: Record<string, string> = {
  intro: 'bg-blue-500/20 text-chip-blue',
  verse: 'bg-green-500/20 text-chip-green',
  chorus: 'bg-purple-500/20 text-chip-purple',
  bridge: 'bg-yellow-500/20 text-chip-yellow',
  outro: 'bg-gray-500/20 text-chip-gray',
  instrumental: 'bg-cyan-500/20 text-chip-cyan',
}

const sectionBarColors: Record<string, string> = {
  intro: 'bg-blue-500',
  verse: 'bg-green-500',
  chorus: 'bg-purple-500',
  bridge: 'bg-yellow-500',
  outro: 'bg-gray-500',
  instrumental: 'bg-cyan-500',
}

const sectionLabels = ['intro', 'verse', 'chorus', 'bridge', 'outro', 'instrumental'] as const
const colorMap = Object.fromEntries(
  sectionLabels.map(label => [label, sectionColors[label] || 'bg-bg-hover text-text-muted'])
) as Record<string, string>

function SectionBadge({ label }: { label: string }) {
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-full ${colorMap[label]}`}>
      {label}
    </span>
  )
}

function EnergyDot({ energy }: { energy: number }) {
  const color = energy > 0.6 ? 'bg-chip-red' : energy < 0.3 ? 'bg-chip-blue' : 'bg-chip-yellow'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={`Energy: ${(energy * 100).toFixed(0)}%`} />
}

interface PlannedClipWithImage extends PlannedClip {
  image?: string
}

// === DIRECTOR PANEL COMPONENT ===
export function DirectorPanel() {
  const step = useStore(s => s.directorStep)
  const loading = useStore(s => s.directorLoading)
  const loadingMessage = useStore(s => s.directorLoadingMessage)
  const error = useStore(s => s.directorError)
  const analysis = useStore(s => s.directorAnalysis)
  const plannedClips = useStore(s => s.directorPlannedClips) as PlannedClip[]
  const energyBias = useStore(s => s.directorEnergyBias)
  const clipPlans = useStore(s => s.directorClipPlans)
  const sceneDescription = useStore(s => s.directorSceneDescription)
  const audioFile = useStore(s => s.directorAudioFile)
  const referenceImage = useStore(s => s.directorReferenceImage)
  const clipImages = useStore(s => s.directorClipImages)
  const imageGenProgress = useStore(s => s.directorImageGenProgress)
  const uploadAndAnalyze = useStore(s => s.directorUploadAndAnalyze)
  const setEnergyBias = useStore(s => s.directorSetEnergyBias)
  const confirmStructure = useStore(s => s.directorConfirmStructure)
  const setSceneDescription = useStore(s => s.directorSetSceneDescription)
  const setReferenceImage = useStore(s => s.directorSetReferenceImage)
  const planPrompts = useStore(s => s.directorPlanPrompts)
  const planVideoPrompts = useStore(s => s.directorPlanVideoPrompts)
  const generateStartImages = useStore(s => s.directorGenerateStartImages)
  const applyToClips = useStore(s => s.directorApplyToClips)
  const directorGenerate = useStore(s => s.directorGenerate)
  const editClipPlan = useStore(s => s.directorEditClipPlan)
  const reset = useStore(s => s.directorReset)
  const speakers = useStore(s => s.directorSpeakers)
  const speakerMappings = useStore(s => s.directorSpeakerMappings)
  const setSpeakerMapping = useStore(s => s.directorSetSpeakerMapping)
  const insertSpeakerMention = useStore(s => s.directorInsertSpeakerMention)
  const autoMode = useStore(s => s.directorAutoMode)
  const setAutoMode = useStore(s => s.setDirectorAutoMode)

  const refImagePreview = useMemo(
    () => referenceImage ? URL.createObjectURL(referenceImage) : null,
    [referenceImage]
  )

  // === PERFORMANCE OPTIMIZATION: Memoized analysis state ===
  const analysisMemo = useMemo(() => {
    if (analysis?.lyrics) return analysis
    return undefined
  }, [analysis])

  // Sample lyrics per speaker for identification
  const speakerSamples = useMemo(() => {
    if (!analysisMemo?.lyrics) return {} as Record<string, string[]>
    const samples: Record<string, string[]> = {}
    for (const seg of analysis.lyrics) {
      if (seg.speaker && !samples[seg.speaker]) {
        samples[seg.speaker] = []
      }
      if (seg.speaker && samples[seg.speaker].length < 2) {
        samples[seg.speaker].push(seg.text)
      }
    }
    return samples
  }, [analysisMemo?.lyrics])

  const [dragOver, setDragOver] = useState(false)
  const [localBias, setLocalBias] = useState<number | null>(null)
  const [showAnalysisDetails, setShowAnalysisDetails] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})

  // === PERFORMANCE: useMemo for category computation (avoids recompute on every render) ===
  const categorizedClips = useMemo(() => {
    if (!analysisMemo?.lyrics || plannedClips.length === 0) return [] as PlannedClipWithImage[]
    const byCategory: Record<string, PlannedClip[]> = {}
    for (const clip of plannedClips) {
      let category = 'other'
      for (const seg of analysis.lyrics) {
        if (seg.start >= clip.start && seg.end <= clip.end && seg.speaker) {
          const label = getCategoryLabel(seg.text)
          category = label
          break
        }
      }
      if (!byCategory[category]) byCategory[category] = []
      byCategory[category].push(clip)
    }
    const categories = Object.keys(byCategory).sort()
    setCollapsedCategories(prev => {
      const next: Record<string, boolean> = {}
      for (const cat of categories) {
        if (!prev[cat]) next[cat] = true
      }
      return next
    })
    // Return clips with category attached
    return plannedClips.map(clip => ({
      ...clip,
      category: getAutoCategory(clip),
      sampleText: getFirstSample(clip),
    })) as PlannedClipWithImage[]
  }, [analysisMemo?.lyrics, plannedClips])

  const [hoveringField, setHoveringField] = useState<{ field?: 'start' | 'end'; index?: number }>({})

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('audio/') && !AUDIO_ACCEPT.split(',').some(ext => file.name.toLowerCase().endsWith(ext))) {
      return
    }
    uploadAndAnalyze(file)
  }, [uploadAndAnalyze])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  // === PERFORMANCE: useMemo for total duration and beat distribution ===
  const totalClipDuration = useMemo(
    () => plannedClips.length > 0 ? plannedClips[plannedClips.length - 1].end : 0,
    [plannedClips]
  )

  const beatDistribution = useMemo(() => {
    if (plannedClips.length === 0) return ''
    const counts: Record<number, number> = {}
    for (const c of plannedClips) {
      counts[c.beat_count] = (counts[c.beat_count] || 0) + 1
    }
    return Object.entries(counts).sort(([a], [b]) => Number(a) - Number(b)).map(([beats, count]) => `${count}x${beats}-beat`).join(', ')
  }, [plannedClips])

  // === PERFORMANCE: useMemo for processed clips (avoids recompute on every render) ===
  const processedClips = useMemo(() => {
    return categorizedClips.map(clip => ({
      ...clip,
      category: getAutoCategory(clip),
      sampleText: getFirstSample(clip),
    })) as PlannedClipWithImage[]
  }, [categorizedClips])

  const refAudioPreview = useMemo(() => audioFile ? URL.createObjectURL(audioFile) : null, [audioFile])

  return (
    <div className="bg-bg-tertiary/50 border border-accent-blue/30 rounded-lg p-3 space-y-3">
      {/* Timeline editor (separate column, collapsible) */}
      <DirectorTimelineEditor />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Music size={14} className="text-accent-blue" />
          <span className="text-xs font-medium text-text-primary">Director</span>
          {analysisMemo && (
            <span className="text-2xs text-text-muted">
              {analysisMemo.bpm.toFixed(0)} BPM
            </span>
          )}
        </div>
        {step !== 'upload' && (
          <button
            onClick={reset}
            className="text-2xs text-text-muted hover:text-text-primary flex items-center gap-0.5 transition-colors"
            title="Start over"
          >
            <RotateCcw size={10} /> Start Over
          </button>
        )}
      </div>

      {/* Error — rich banner */}
      {error && (
        <DirectorErrorBanner error={error} pipelineStatus={useStore.getState().pipelineStatus} />
      )}

      {/* === LEFT COLUMN: Audio Upload & Clip Structure === */}
      <div className="flex flex-col gap-3">
        {/* Step 1 — Upload zone (fixed height with scroll) */}
        {step === 'upload' && (
          <>
            <label className={`group relative w-full h-[45vh] min-h-[80px] border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center rounded-md overflow-hidden ${dragOver ? 'border-accent-blue bg-accent-blue/10' : 'border-input-field hover:border-input-field-hover'} ${audioFile ? '' : 'text-text-muted'}`}>
              <input type="file" accept={AUDIO_ACCEPT} className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              <div className={`${audioFile ? 'opacity-50' : ''} transition-opacity`}>
                <Upload size={24} className="mb-1.5" />
                <span className="text-xs font-medium">Arraste seu áudio aqui</span>
                <span className="text-3xs mt-1 text-text-muted">ou clique para selecionar (.wav, .mp3, .flac)</span>
              </div>
            </label>

            {/* Local bias slider (only when audio is uploaded) */}
            {audioFile && (
              <div className="mt-auto p-2 bg-bg-primary/50 rounded-md">
                <div className="flex items-center justify-between mb-1.5 text-xs">
                  <span className="text-text-secondary">Bias de energia</span>
                  <span className={`text-xs ${localBias !== null ? 'text-accent-blue' : ''}`}>{localBias !== null ? `${(localBias * 100).toFixed(0)}%` : '-'}</span>
                </div>
                <input type="range" min={-3} max={3} step={0.1} value={localBias ?? 0} onChange={(e) => setLocalBias(parseFloat(e.target.value))} className="w-full h-1 bg-accent-blue/20 rounded-lg appearance-none cursor-pointer accent-accent-blue" />
              </div>
            )}
          </>
        )}

        {/* Step 2 — Structure preview */}
        {step === 'analyze' && (
          <div className="space-y-3">
            <label className="text-xs font-medium text-text-primary flex items-center gap-1.5 cursor-pointer select-none" onClick={() => setShowAnalysisDetails(!showAnalysisDetails)}>
              <ChevronRight size={12} className={`transition-transform ${showAnalysisDetails ? 'rotate-90' : ''}`} />
              Análise da música — {showAnalysisDetails ? 'Esconder detalhes' : 'Mostrar detalhes'}
            </label>

            {/* Analysis details collapsible */}
            <div className={`space-y-2 transition-all overflow-hidden ${showAnalysisDetails ? 'max-h-[30vh]' : ''}`}>
              <div className="bg-bg-primary/50 rounded-md p-2.5 space-y-2 text-xs">
                {analysisMemo && (
                  <>
                    {/* BPM / key */}
                    <div className="flex items-center justify-between bg-accent-blue/10 px-2 py-1 rounded-md">
                      <span className="text-text-secondary font-medium">{analysisMemo.bpm.toFixed(1)} BPM</span>
                      {analysisMemo.key && <span className="text-text-muted text-2xs">Chord: {analysisMemo.key}</span>}
                    </div>

                    {/* Energy bias */}
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-text-secondary font-medium">Bias de energia</span>
                        <span className={`text-xs ${energyBias > 0 ? 'text-accent-red' : energyBias < 0 ? 'text-accent-blue' : ''}`}>
                          {energyBias !== null && energyBias !== undefined ? `${(energyBias * 100).toFixed(0)}%` : '-'}
                        </span>
                      </div>
                      <input type="range" min={-3} max={3} step={0.1} value={energyBias ?? 0} onChange={(e) => setEnergyBias(parseFloat(e.target.value))} className="w-full h-1 bg-accent-blue/20 rounded-lg appearance-none cursor-pointer accent-accent-blue" />
                    </div>

                    {/* Beat distribution */}
                    {beatDistribution && (
                      <div className="flex items-center gap-1.5 text-text-muted">
                        <Zap size={10} className="shrink-0" />
                        <span>{beatDistribution}</span>
                      </div>
                    )}

                    {/* Clips */}
                    {plannedClips.length > 0 && (
                      <div className="space-y-1">
                        {plannedClips.map((clip, i) => (
                          <div key={i} className="flex items-center justify-between bg-bg-primary/30 px-2 py-1.5 rounded-md">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className={`text-xs font-medium ${clip.section_label === 'chorus' ? 'text-accent-purple' : ''}`}>[{formatTime(clip.start)}–{formatTime(clip.end)}]</span>
                              {clip.section_label !== 'instrumental' && <SectionBadge label={clip.section_label} />}
                              <EnergyDot energy={clip.energy} />
                            </div>
                            <button onClick={() => editClipPlan(i)} className="text-text-muted hover:text-accent-blue text-2xs">✎</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Confirm & next */}
              <div className="flex items-center gap-3 pt-1.5">
                {energyBias !== null && energyBias !== undefined && (
                  <button onClick={() => confirmStructure()} className="text-xs px-2 py-0.5 rounded-md bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/40 transition-colors font-medium whitespace-nowrap">Confirmar estrutura</button>
                )}
                {energyBias === null && energyBias !== undefined && plannedClips.length > 0 && (
                  <div className="text-xs text-text-muted flex items-center gap-1.5"><Zap size={10} /> Estrutura pronta</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 3 — Clip plans */}
        {step === 'plan' && (
          <ClipStructureCard clips={processedClips} sceneDescription={sceneDescription} setSceneDescription={setSceneDescription} planPrompts={planPrompts} planVideoPrompts={planVideoPrompts} clipImages={clipImages} imageGenProgress={imageGenProgress} applyToClips={applyToClips} refAudioPreview={refAudioPreview} />
        )}

        {/* Step 4 — Generate */}
        {step === 'generate' && (
          <div className="space-y-2.5">
            {/* Scene description */}
            <SceneDescriptionEditor sceneDescription={sceneDescription} setSceneDescription={setSceneDescription} refImagePreview={refAudioPreview} />

            {/* Image generation progress */}
            {imageGenProgress > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>Gerando imagens de referência...</span>
                  <span>{Math.round(imageGenProgress)}%</span>
                </div>
                <div className="h-1.5 w-full bg-accent-blue/20 rounded-full overflow-hidden">
                  <div className="h-full bg-accent-blue transition-all" style={{ width: `${imageGenProgress}%` }} />
                </div>
              </div>
            )}

            {/* Generate button */}
            {step === 'generate' && generateStartImages === 0 && (
              <button onClick={directorGenerate} className="w-full h-[32px] bg-accent-blue text-text-primary rounded-md font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-accent-blue-hover transition-colors">
                <Play size={10} /> Gerar vídeo
              </button>
            )}

            {/* Generate button disabled while generating */}
            {step === 'generate' && generateStartImages > 0 && (
              <div className="flex items-center justify-between px-2 py-1 bg-accent-blue/5 rounded-md text-xs">
                <span className="text-text-muted">Gerando vídeo...</span>
                <Loader2 size={12} className="animate-spin text-accent-blue" />
              </div>
            )}

            {/* Generate button disabled when no scene description */}
            {step === 'generate' && generateStartImages === 0 && !sceneDescription.trim() && (
              <button disabled className="w-full h-[32px] bg-bg-hover text-text-muted rounded-md font-medium text-xs flex items-center justify-center gap-1.5 cursor-not-allowed">
                Preencha a descrição da cena primeiro
              </button>
            )}

            {/* Generation result */}
            {generateStartImages === 3 && directorGenerate !== null && (
              <div className={`p-3 rounded-md text-xs ${directorGenerate ? 'bg-accent-green/10' : ''}`}>
                {directorGenerate ? (
                  <>
                    <span className="font-medium">Vídeo gerado com sucesso!</span> — clique abaixo para assistir.
                  </>
                ) : (
                  'Gerando vídeo...'
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 5 — Editing */}
        {step === 'edit' && plannedClips.length > 0 && (
          <ClipEditorCard clips={processedClips} editClipPlan={editClipPlan} sceneDescription={sceneDescription} setSceneDescription={setSceneDescription} planPrompts={planPrompts} applyToClips={applyToClips} directorGenerate={directorGenerate} />
        )}

        {/* Step 6 — Finished */}
        {step === 'finished' && (
          <div className="space-y-2.5">
            <FinishedCard plannedClips={plannedClips} referenceImage={refAudioPreview} sceneDescription={sceneDescription} />
          </div>
        )}

        {/* Reset button — always visible when not in upload step */}
        {step !== 'upload' && (
          <button onClick={reset} className="text-xs text-text-muted hover:text-accent-blue transition-colors flex items-center justify-center gap-1.5">
            <RotateCcw size={10} /> Reiniciar
          </button>
        )}
      </div>

      {/* === RIGHT COLUMN: Speaker Management === */}
      {step !== 'upload' && step !== 'finished' && (
        <SpeakerManagementCard speakers={speakers} speakerMappings={speakerMappings} setSpeakerMapping={setSpeakerMapping} insertSpeakerMention={insertSpeakerMention} autoMode={autoMode} setAutoMode={setAutoMode} />
      )}
    </div>
  )
}

// ============================================================
// === LEFT COLUMN SUB-COMPONENTS (Director Panel) ===
// ============================================================

function SceneDescriptionEditor({ sceneDescription, setSceneDescription, refImagePreview }: { sceneDescription: string | null; setSceneDescription: (s: string | null) => void; refImagePreview: string | null }) {
  const [hoveringField, setHoveringField] = useState<string>('')

  return (
    <div className="space-y-2">
      {/* Scene description with hover preview */}
      <label className="text-xs font-medium text-text-primary flex items-center gap-1.5 cursor-pointer select-none" onClick={() => { setSceneDescription(null); setHoveringField('') }}>
        <ChevronRight size={12} className={`transition-transform ${sceneDescription ? 'rotate-90' : ''}`} />
        Descrição da cena — {sceneDescription ? 'Limpar' : 'Editar'}
      </label>

      {/* Reference image upload zone */}
      <div className="border border-input-field rounded-md p-2.5 bg-bg-primary/30">
        {!refImagePreview && (
          <>
            <div className="text-3xs text-text-muted mb-1 flex items-center gap-1.5 cursor-pointer select-none" onClick={() => setSceneDescription(null)}>
              <ImageIcon size={12} /> Limpar imagem de referência
            </div>
            <label className={`group relative w-full h-[45vh] min-h-[80px] border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center rounded-md overflow-hidden ${hoveringField === 'ref' ? 'border-accent-blue bg-accent-blue/10' : ''} ${sceneDescription ? 'opacity-30 pointer-events-none' : ''}`}>
              <input type="file" accept={IMAGE_ACCEPT} className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => { const f = e.target.files?.[0]; if (f) setSceneDescription(URL.createObjectURL(f)) }} />
              <div className={`${sceneDescription ? 'opacity-50' : ''}`}>
                <ImageIcon size={24} className="mb-1.5 text-text-muted" />
                <span className="text-xs font-medium">Imagem de referência (opcional)</span>
                <span className="text-3xs mt-1 text-text-muted">PNG, JPG, WEBP</span>
              </div>
            </label>
          </>
        )}

        {refImagePreview && (
          <>
            <div className="relative rounded overflow-hidden border border-accent-blue/40 bg-bg-primary/30" onMouseEnter={() => setHoveringField('preview')} onMouseLeave={() => setHoveringField('')}>
              <img src={refImagePreview} alt="Reference image preview" className="w-full h-[28vh] object-contain p-1.5" />
            </div>

            {/* Hover preview tooltip — appears above the image when hovering */}
            {hoveringField === 'preview' && sceneDescription && (
              <div className="absolute -top-8 left-0 right-0 bg-bg-primary/95 backdrop-blur-sm text-xs p-2 rounded-md border border-accent-blue shadow-lg">
                {sceneDescription.trim()}
              </div>
            )}

            {/* Inline edit field with tooltip */}
            <textarea
              value={sceneDescription || ''}
              onChange={(e) => setSceneDescription(e.target.value)}
              placeholder="Descreva a cena para cada clip (ex: 'um homem com cicatriz na testa, olhos arregalados, vestindo uma jaqueta jeans desbotada...')"
              className={`w-full h-[5vh] min-h-[32px] px-2 text-xs rounded-md resize-none bg-bg-primary/70 border transition-colors outline-none focus:outline-none focus:bg-accent-blue/5 focus:border-accent-blue ${hoveringField === 'scene' ? 'border-accent-blue' : 'border-input-field hover:border-input-field-hover'} cursor-text`}
              onMouseEnter={() => setHoveringField('scene')}
              onMouseLeave={() => setHoveringField('')}
            />

            {/* Hover preview for scene description */}
            {hoveringField === 'scene' && sceneDescription && (
              <div className="absolute -bottom-8 left-0 right-0 bg-bg-primary/95 backdrop-blur-sm text-xs p-2 rounded-md border border-accent-blue shadow-lg whitespace-pre-wrap">
                {sceneDescription.trim()}
              </div>
            )}

            {/* Upload button — only shown when no image is selected */}
            {!refImagePreview && (
              <button onClick={() => setSceneDescription('')} className="text-2xs text-text-muted hover:text-accent-blue absolute top-1.5 right-1">
                X
              </button>
            )}
          </>
        )}
      </div>

      {/* Prompt fields */}
      <div className={`space-y-0.5 transition-opacity ${sceneDescription ? 'opacity-30 pointer-events-none' : ''}`}>
        <label className="text-xs font-medium text-text-primary flex items-center gap-1.5 cursor-pointer select-none" onClick={() => setSceneDescription(null)}>
          <ChevronRight size={12} className={`transition-transform ${sceneDescription ? 'rotate-90' : ''}`} />
          Prompt do vídeo — {sceneDescription ? 'Limpar' : 'Editar'}
        </label>

        {/* Prompt image upload (optional) */}
        {!refImagePreview && (
          <div className="border border-input-field rounded-md p-2.5 bg-bg-primary/30">
            <label className={`group relative w-full h-[45vh] min-h-[80px] border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center rounded-md overflow-hidden ${hoveringField === 'prompt' ? 'border-accent-blue bg-accent-blue/10' : ''}`}>
              <input type="file" accept={IMAGE_ACCEPT} className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => { const f = e.target.files?.[0]; if (f && sceneDescription) setSceneDescription(sceneDescription + '\n\nImagem: ' + f.name) }} />
              <div className={`${sceneDescription ? 'opacity-50' : ''}`}>
                <ImageIcon size={24} className="mb-1.5 text-text-muted" />
                <span className="text-xs font-medium">Imagem para gerar o vídeo (opcional)</span>
                <span className="text-3xs mt-1 text-text-muted">PNG, JPG, WEBP</span>
              </div>
            </label>

            {/* Hover preview for prompt image upload */}
            {hoveringField === 'prompt' && sceneDescription && (
              <div className="absolute -top-8 left-0 right-0 bg-bg-primary/95 backdrop-blur-sm text-xs p-2 rounded-md border border-accent-blue shadow-lg truncate max-w-full">
                {sceneDescription.trim()}
              </div>
            )}
          </div>
        )}

        {/* Prompt textarea with tooltip */}
        <textarea
          value={sceneDescription || ''}
          onChange={(e) => setSceneDescription(e.target.value)}
          placeholder="Descreva a cena para cada clip (ex: 'um homem com cicatriz na testa, olhos arregalados, vestindo uma jaqueta jeans desbotada...')"
          className={`w-full h-[5vh] min-h-[32px] px-2 text-xs rounded-md resize-none bg-bg-primary/70 border transition-colors outline-none focus:outline-none focus:bg-accent-blue/5 focus:border-accent-blue ${hoveringField === 'scene' ? 'border-accent-blue' : 'border-input-field hover:border-input-field-hover'} cursor-text`}
          onMouseEnter={() => setHoveringField('scene')}
          onMouseLeave={() => setHoveringField('')}
        />

        {/* Hover preview for scene description */}
        {hoveringField === 'scene' && sceneDescription && (
          <div className="absolute -bottom-8 left-0 right-0 bg-bg-primary/95 backdrop-blur-sm text-xs p-2 rounded-md border border-accent-blue shadow-lg whitespace-pre-wrap">
            {sceneDescription.trim()}
          </div>
        )}

        {/* Upload button — only shown when no image is selected */}
        {!refImagePreview && !sceneDescription.trim() && (
          <button onClick={() => setSceneDescription('')} className="text-2xs text-text-muted hover:text-accent-blue absolute top-1.5 right-1">
            X
          </button>
        )}

        {/* Done indicator */}
        {refImagePreview || sceneDescription.trim() ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-accent-green/10 text-accent-green rounded-full text-xs font-medium">
            <Check size={10} /> Prompt pronto
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ClipStructureCard({
  clips, sceneDescription, setSceneDescription, planPrompts, planVideoPrompts, clipImages, imageGenProgress, applyToClips, refAudioPreview,
}: {
  clips: PlannedClipWithImage[]
  sceneDescription: string | null
  setSceneDescription: (s: string | null) => void
  planPrompts: number[] | null
  planVideoPrompts: boolean
  clipImages: Record<string, string>
  imageGenProgress: number
  applyToClips: () => void
  refAudioPreview: string | null
}) {
  const [hoveringField, setHoveringField] = useState<{ field?: 'start' | 'end'; index?: number }>({})

  return (
    <div className="space-y-2">
      {/* Scene description editor with hover preview */}
      <SceneDescriptionEditor sceneDescription={sceneDescription} setSceneDescription={setSceneDescription} refImagePreview={refAudioPreview} />

      {/* Plan prompts / video prompts toggles */}
      <div className="flex items-center gap-2">
        <label className={`text-xs font-medium text-text-primary cursor-pointer select-none ${planPrompts ? 'text-accent-blue' : ''}`} onClick={() => planPrompts && setPlanPrompts(!planPrompts)}>
          {planPrompts ? (
            <>Mostrar prompts</>
          ) : (
            <>Esconder prompts</>
          )}
        </label>

        <label className={`text-xs font-medium text-text-primary cursor-pointer select-none ${planVideoPrompts ? 'text-accent-purple' : ''}`}>
          {planVideoPrompts ? 'Geração de imagens ativada' : 'Desativar geração de imagens'}
        </label>
      </div>

      {/* Clips list with hover preview */}
      <div className="space-y-1 max-h-[28vh] overflow-y-auto pr-1 custom-scrollbar">
        {clips.map((clip, i) => (
          <ClipRow key={i} index={i} clip={clip} hoveringField={hoveringField?.field === 'start' && hoveringField?.index === i ? 'start' : ''} hoverPreviewText={hoveringField?.field === 'end' && hoveringField?.index === i ? String(clip.end) : null} onMouseEnter={() => { setHoveringField({ field: 'start', index: i }) }} onMouseLeave={() => setHoveringField({})} />
        ))}
      </div>

      {/* Apply button */}
      <button onClick={applyToClips} className="w-full h-[32px] bg-accent-blue text-text-primary rounded-md font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-accent-blue-hover transition-colors">
        Aplicar mudanças
      </button>

      {/* Done indicator */}
      {applyToClips !== undefined && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-accent-green/10 text-accent-green rounded-full text-xs font-medium">
          <Check size={10} /> Estrutura concluída
        </div>
      )}
    </div>
  )
}

function ClipRow({ index, clip, hoveringField, hoverPreviewText, onMouseEnter, onMouseLeave }: { index: number; clip: PlannedClipWithImage; hoveringField: string; hoverPreviewText: string | null; onMouseEnter: () => void; onMouseLeave: () => void }) {
  return (
    <div className="group flex items-center justify-between bg-bg-primary/30 px-2 py-1.5 rounded-md transition-colors hover:bg-bg-primary">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        {/* Start time with hover preview */}
        <div className="relative w-[78px] shrink-0">
          <input type="number" step={0.1} min={0} max={600} value={clip.start} onChange={(e) => { /* Would call editClipPlan here — needs store update */ }} className={`w-full h-[24px] px-1 text-xs rounded bg-bg-primary border outline-none focus:outline-none focus:border-accent-blue text-center transition-colors ${hoveringField === 'start' && index === clip.start ? 'border-accent-blue ring-2 ring-accent-blue/20' : 'border-input-field hover:border-input-field-hover'} cursor-text`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} title="Início do clip" />
          {hoveringField === 'start' && index === clip.start && hoverPreviewText !== null && (
            <div className="absolute -top-6 left-0 right-0 bg-bg-primary/95 backdrop-blur-sm text-xs p-1.5 rounded-md border border-accent-blue shadow-lg whitespace-nowrap">
              Tempo de início do clip: {hoverPreviewText}s
            </div>
          )}
        </div>

        {/* Duration label */}
        <span className="text-2xs text-text-muted w-[34px] shrink-0">{clip.end - clip.start.toFixed(1)}s</span>

        {/* Section badge */}
        {clip.section_label !== 'instrumental' && <SectionBadge label={clip.section_label} />}

        {/* Energy dot */}
        <EnergyDot energy={clip.energy} />

        {/* Beat count badge */}
        <div className="text-2xs text-text-muted px-1.5 py-0.5 bg-bg-primary rounded-md border border-input-field">
          {clip.beat_count}-beat
        </div>

        {/* Category pill (auto-mode) */}
        {clip.category !== 'other' && (
          <span className="text-[9px] px-1 py-0.25 bg-accent-blue/10 text-accent-blue rounded-full border border-accent-blue/30">
            {SPEAKER_CATEGORIES.find(c => c.id === clip.category)?.label || clip.category}
          </span>
        )}
      </div>

      {/* End time with hover preview */}
      <div className="relative w-[78px] shrink-0 text-right pr-1">
        <input type="number" step={0.1} min={0} max={600} value={clip.end} onChange={(e) => { /* Would call editClipPlan here — needs store update */ }} className={`w-full h-[24px] px-1 text-xs rounded bg-bg-primary border outline-none focus:outline-none focus:border-accent-blue text-right transition-colors cursor-text ${hoveringField === 'end' && index === clip.start ? 'border-accent-blue ring-2 ring-accent-blue/20' : 'border-input-field hover:border-input-field-hover'} ${clip.end < clip.start + 1.5 ? 'bg-red-500/10 border-red-400' : ''}`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} title="Fim do clip" />
        {hoveringField === 'end' && index === clip.start && hoverPreviewText !== null && (
          <div className="absolute -bottom-6 left-0 right-0 bg-bg-primary/95 backdrop-blur-sm text-xs p-1.5 rounded-md border border-accent-blue shadow-lg whitespace-nowrap">
            Tempo de fim do clip: {hoverPreviewText}s
          </div>
        )}
      </div>

      {/* Edit button */}
      <button className="text-text-muted hover:text-accent-blue text-xs p-0.5 rounded transition-colors" title="Editar clip">✎</button>
    </div>
  )
}

function ClipEditorCard({ clips, editClipPlan, sceneDescription, setSceneDescription, planPrompts, applyToClips, directorGenerate }: { clips: PlannedClipWithImage[]; editClipPlan: (i: number) => void; sceneDescription: string | null; setSceneDescription: (s: string | null) => void; planPrompts: number[] | null; applyToClips: () => void; directorGenerate: boolean }) {
  return (
    <div className="space-y-2">
      {/* Scene description editor */}
      <SceneDescriptionEditor sceneDescription={sceneDescription} setSceneDescription={setSceneDescription} refImagePreview={null} />

      {/* Clips list for editing */}
      <div className={`space-y-1 max-h-[28vh] overflow-y-auto pr-1 custom-scrollbar ${sceneDescription ? 'opacity-30 pointer-events-none' : ''}`}>
        {clips.map((clip, i) => (
          <ClipRow key={i} index={i} clip={clip} hoveringField="" hoverPreviewText={null} onMouseEnter={() => { }} onMouseLeave={() => { }} />
        ))}
      </div>

      {/* Apply button */}
      <button onClick={applyToClips} className="w-full h-[32px] bg-accent-blue text-text-primary rounded-md font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-accent-blue-hover transition-colors">
        Aplicar mudanças
      </button>

      {/* Generate button */}
      {directorGenerate && (
        <button className="w-full h-[32px] bg-accent-green text-text-primary rounded-md font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-accent-green-hover transition-colors">
          <Play size={10} /> Gerar vídeo
        </button>
      )}

      {/* Done indicator */}
      {directorGenerate && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-accent-green/10 text-accent-green rounded-full text-xs font-medium">
          <Check size={10} /> Estrutura concluída
        </div>
      )}
    </div>
  )
}

function FinishedCard({ plannedClips, referenceImage, sceneDescription }: { plannedClips: PlannedClip[]; referenceImage: string | null; sceneDescription: string | null }) {
  return (
    <div className="space-y-2">
      {/* Summary stats */}
      <div className="bg-bg-primary/50 rounded-md p-3 space-y-1 text-xs">
        <div className="flex items-center justify-between bg-accent-blue/10 px-2 py-1.5 rounded-md">
          <span>{plannedClips.length} clips</span>
          <span className="text-text-muted">{formatTime(plannedClips[plannedClips.length - 1].end)}</span>
        </div>

        {/* Section distribution */}
        <div className="space-y-0.5">
          {sectionLabels.map(label => (
            <div key={label} className="flex items-center justify-between text-text-muted">
              <span>{label}</span>
              <span>({(plannedClips.filter(c => c.section_label === label).length || 0)})</span>
            </div>
          ))}
        </div>

        {/* Beat distribution */}
        {(() => {
          if (plannedClips.length === 0) return null
          const counts: Record<number, number> = {}
          for (const c of plannedClips) {
            counts[c.beat_count] = (counts[c.beat_count] || 0) + 1
          }
          if (!Object.keys(counts).length) return <div className="text-text-muted">—</div>
          return Object.entries(counts).sort(([a], [b]) => Number(a) - Number(b)).map(([beats, count]) => `${count}x${beats}-beat`).join(', ') ? (
            <div className="flex items-center gap-1.5 text-text-muted"><Zap size={10} /> {Object.entries(counts).sort(([a], [b]) => Number(a) - Number(b)).map(([beats, count]) => `${count}x${beats}-beat`).join(', ')}</div>
          ) : null
        })()}

        {/* Reference image */}
        {referenceImage && (
          <div className="flex items-center gap-1.5 text-text-muted">
            <span>Imagem de referência:</span>
            <img src={referenceImage} alt="" className="w-4 h-4 rounded border border-input-field object-cover" />
          </div>
        )}

        {/* Scene description */}
        {sceneDescription && (
          <div className="flex items-center gap-1.5 text-text-muted">
            <span>Cena:</span>
            <span className="px-1.5 py-0.5 bg-accent-blue/10 rounded-full text-[10px] truncate max-w-[8ch]">{sceneDescription.trim().slice(0, 40)}</span>
          </div>
        )}
      </div>

      {/* Next step button */}
      <button className="w-full h-[32px] bg-accent-blue text-text-primary rounded-md font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-accent-blue-hover transition-colors">
        Próximo →
      </button>
    </div>
  )
}

// ============================================================
// === RIGHT COLUMN: SPEAKER MANAGEMENT CARD ===
// ============================================================

function SpeakerManagementCard({ speakers, speakerMappings, setSpeakerMapping, insertSpeakerMention, autoMode, setAutoMode }: { speakers: Record<string, string[]>; speakerMappings: Record<string, string>; setSpeakerMapping: (speakerId: string, newLabel: string) => void; insertSpeakerMention: (clipIndex: number | null, text?: string) => void; autoMode: boolean; setAutoMode: (enabled: boolean) => void }) {
  const [hoveringField, setHoveringField] = useState<{ field?: 'label' | 'name'; speakerId?: string }>({})

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <RotateCcw size={14} className="text-accent-blue" />
          <span className="text-xs font-medium text-text-primary">Speaker Management</span>
          {autoMode && <span className="text-[10px] px-1.5 py-0.25 bg-accent-green/20 text-accent-green rounded-full border border-accent-green/30">Auto-mode ON</span>}
        </div>
        {!autoMode ? (
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-text-primary" onClick={() => setAutoMode(true)}>
            <input type="checkbox" checked={autoMode} onChange={(e) => setAutoMode(e.target.checked)} /> Auto-categorizar
          </label>
        ) : (
          <button onClick={() => setAutoMode(false)} className="text-xs text-text-primary hover:text-accent-blue transition-colors">Desativar auto-mode</button>
        )}
      </div>

      {/* Speaker cards grid */}
      {Object.entries(speakers).map(([speakerId, samples], i) => (
        <SpeakerCard key={speakerId} index={i} speakerId={speakerId} label={speakerMappings[speakerId] || 'Unknown'} samples={samples.slice(0, 1)} onLabelChange={(newLabel: string) => setSpeakerMapping(speakerId, newLabel)} hoveringField={hoveringField?.field === 'label' && hoveringField?.speakerId === speakerId ? 'label' : ''} hoverPreviewText={hoveringField?.field === 'name' && hoveringField?.speakerId === speakerId ? samples[0] : null} onMouseEnter={() => { if (!autoMode) setHoveringField({ field: 'label', speakerId }) }} onMouseLeave={() => setHoveringField({})} />
      ))}

      {/* Insert mention button */}
      <button onClick={() => insertSpeakerMention(null)} className="text-2xs text-text-muted hover:text-accent-blue transition-colors flex items-center justify-center gap-1.5">
        + Adicionar menção a um speaker
      </button>
    </div>
  )
}

function SpeakerCard({ index, speakerId, label, samples, onLabelChange, hoveringField, hoverPreviewText, onMouseEnter, onMouseLeave }: { index: number; speakerId: string; label: string; samples: string[]; onLabelChange: (newLabel: string) => void; hoveringField: string; hoverPreviewText: string | null; onMouseEnter: () => void; onMouseLeave: () => void }) {
  return (
    <div className="relative group">
      {/* Category badge */}
      <span className={`absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] px-0.5 py-0.25 rounded-full bg-bg-primary border border-input-field whitespace-nowrap transition-colors ${hoveringField === 'label' ? 'border-accent-blue ring-1 ring-accent-blue/30' : ''}`}>
        {index + 1}
      </span>

      {/* Label field with hover preview */}
      <input type="text" value={label} onChange={(e) => onLabelChange(e.target.value)} className={`w-full h-[24px] px-2 text-xs rounded border transition-colors outline-none focus:outline-none focus:bg-accent-blue/5 focus:border-accent-blue text-center cursor-text ${hoveringField === 'label' ? 'border-accent-blue ring-1 ring-accent-blue/30 bg-accent-blue/5' : 'border-input-field hover:border-input-field-hover'} transition-colors`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />

      {/* Hover preview tooltip */}
      {hoveringField === 'label' && hoverPreviewText !== null && (
        <div className="absolute -bottom-6 left-0 right-0 bg-bg-primary/95 backdrop-blur-sm text-xs p-1.5 rounded-md border border-accent-blue shadow-lg whitespace-nowrap">
          Exemplo: {hoverPreviewText}
        </div>
      )}

      {/* Speaker ID badge (hidden by default in auto-mode) */}
      <span className="text-[9px] text-text-muted absolute -top-5 left-0 px-1.5 bg-bg-primary rounded-md border border-input-field opacity-0 group-hover:opacity-100 transition-opacity">ID: {speakerId}</span>

      {/* Collapse/expand toggle */}
      <button className="absolute top-1 right-0.5 text-text-muted hover:text-accent-blue text-[9px] p-0.5 rounded opacity-0 group-hover:opacity-100 transition-colors" title={hoverPreviewText || 'Expandir'}>
        {hoveringField === 'label' ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
      </button>
    </div>
  )
}

function Check({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

// ============================================================
// === ERROR BANNER SUB-COMPONENTS ===
// ============================================================

function DirectorErrorBanner({ error, pipelineStatus }: { error: string; pipelineStatus: 'idle' | 'uploading' | 'analyzing' | 'plan' | 'generate' }) {
  if (error.includes('Out of memory')) return <OOMErrorBanner />
  if (error.includes('VRAM')) return <VramWarningBanner />
  if (pipelineStatus === 'generating') return <GeneratingBanner progress={100} />
  if (error.includes('network')) return <NetworkErrorBanner />
  if (error.includes('LoRA')) return <LoraErrorBanner />
  if (error.includes('disk')) return <DiskSpaceWarningBanner />
  return (
    <div className="p-3 bg-red-500/10 border border-red-400/30 rounded-md text-xs text-red-600 font-medium">
      {error}
    </div>
  )
}

function OOMErrorBanner() {
  return (
    <div className="p-3 bg-red-500/10 border border-red-400/30 rounded-md text-xs space-y-2">
      <div className="font-medium text-red-700 flex items-center gap-2">
        <X size={12} /> OOM — Reinicie com mais RAM ou use `--low-memory-mode`
      </div>
      <div className="text-red-600/80 leading-relaxed">
        A GPU ou CPU esgotou a memória durante o upload. Tente reduzir o tamanho do áudio ou aumente a memória do sistema.
      </div>
    </div>
  )
}

function VramWarningBanner() {
  return (
    <div className="p-3 bg-yellow-500/10 border border-yellow-400/30 rounded-md text-xs space-y-2">
      <div className="font-medium text-yellow-700 flex items-center gap-2">
        <Zap size={12} /> VRAM baixa — Modo de baixo consumo ativado
      </div>
      <div className="text-yellow-600/80 leading-relaxed">
        A GPU tem pouca memória. O sistema usará kernels inteiros e CPU para compensar. Desempenho reduzido.
      </div>
    </div>
  )
}

function GeneratingBanner({ progress }: { progress: number }) {
  return (
    <div className="p-3 bg-accent-blue/10 border border-accent-blue/30 rounded-md text-xs">
      <div className="flex items-center justify-between font-medium text-accent-blue mb-1.5">
        <span>Gerando vídeo...</span>
        <span>{progress}%</span>
      </div>
      <div className="h-1.5 w-full bg-accent-blue/20 rounded-full overflow-hidden">
        <div className="h-full bg-accent-blue transition-all" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

function NetworkErrorBanner() {
  return (
    <div className="p-3 bg-red-500/10 border border-red-400/30 rounded-md text-xs space-y-2">
      <div className="font-medium text-red-700 flex items-center gap-2">
        <X size={12} /> Erro de rede — Verifique sua conexão
      </div>
      <div className="text-red-600/80 leading-relaxed">
        Não foi possível baixar um modelo ou arquivo. Verifique seu firewall, proxy ou tente novamente mais tarde.
      </div>
    </div>
  )
}

function LoraErrorBanner() {
  return (
    <div className="p-3 bg-yellow-500/10 border border-yellow-400/30 rounded-md text-xs space-y-2">
      <div className="font-medium text-yellow-700 flex items-center gap-2">
        <Zap size={12} /> Erro ao carregar LoRA — Ignorado
      </div>
      <div className="text-yellow-600/80 leading-relaxed">
        O arquivo de LoRA não pôde ser carregado. Ele será ignorado e o modelo padrão será usado.
      </div>
    </div>
  )
}

function DiskSpaceWarningBanner() {
  return (
    <div className="p-3 bg-yellow-500/10 border border-yellow-400/30 rounded-md text-xs space-y-2">
      <div className="font-medium text-yellow-700 flex items-center gap-2">
        <Zap size={12} /> Espaço em disco baixo — 85% usado
      </div>
      <div className="text-yellow-600/80 leading-relaxed">
        Limpe arquivos temporários ou aumente o espaço de armazenamento para evitar falhas.
      </div>
    </div>
  )
}

// ============================================================
// === ACTIVITY BADGE SUB-COMPONENT (right column) ===
// ============================================================

function DirectorActivityBadge({ label }: { label: string }) {
  return (
    <span className="text-[10px] px-2 py-0.5 bg-accent-green/10 text-accent-green rounded-full border border-accent-green/30 font-medium">
      {label}
    </span>
  )
}

// ============================================================
// === TIMELINE EDITOR (collapsible, separate column) ===
// ============================================================

function DirectorTimelineEditor() {
  const step = useStore(s => s.directorStep)
  const analysis = useStore(s => s.directorAnalysis)
  const plannedClips = useStore(s => s.directorPlannedClips) as PlannedClip[]
  const clipPlans = useStore(s => s.directorClipPlans)

  if (step === 'upload' || step === 'finished') return null

  // Build section colors map for the timeline
  const colorMapTimeline: Record<string, string> = {
    intro: 'bg-blue-500', verse: 'bg-green-500', chorus: 'bg-purple-500', bridge: 'bg-yellow-500', outro: 'bg-gray-500', instrumental: 'bg-cyan-500',
  }

  // Find the section for a given timestamp
  const getSectionAt = (time: number) => {
    if (!analysis || !plannedClips.length) return null
    let maxEnd = -1
    let bestClip: PlannedClip | null = null
    for (const clip of plannedClips) {
      if (clip.end > time && clip.start <= time && clip.end > maxEnd) {
        maxEnd = clip.end
        bestClip = clip
      }
    }
    return bestClip?.section_label || 'instrumental'
  }

  // Get the next section after a given timestamp
  const getNextSectionAt = (time: number) => {
    if (!analysis || !plannedClips.length) return null
    let maxEnd = -1
    let bestClip: PlannedClip | null = null
    for (const clip of plannedClips) {
      if (clip.start > time && clip.end > maxEnd) {
        maxEnd = clip.end
        bestClip = clip
      }
    }
    return bestClip?.section_label || 'instrumental'
  }

  // Build a timeline bar from start to end, segmented by section
  const renderTimelineBar = () => {
    if (!plannedClips.length) return <div className="h-8 bg-bg-primary rounded-md" />

    let currentPos = 0.0
    const segments: React.ReactNode[] = []

    for (const clip of plannedClips) {
      const widthPct = ((clip.end - clip.start) / Math.max(1, plannedClips[plannedClips.length - 1].end)) * 100
      const sectionLabel = clip.section_label || 'instrumental'
      segments.push(
        <div key={clip.start} className="h-full rounded-l-md" style={{ width: `${widthPct}%` }} title={`${sectionLabel} — ${formatTime(clip.start)} – ${formatTime(clip.end)}`}>
          {clip.section_label !== 'instrumental' && (
            <svg viewBox="0 0 24 24" className="w-3 h-3 text-white fill-current shrink-0 self-center">
              <path d="M1,1 L23,11 L1,21 Z M5.5,9 L8.5,14 L6.5,17 Z" />
            </svg>
          )}
        </div>
      )
      currentPos = clip.end
    }

    return segments.length > 0 ? (
      <div className="h-8 w-full flex items-center gap-1 overflow-hidden rounded-md bg-accent-blue/20" style={{ maskImage: 'linear-gradient(to right, black 0%, black calc(100% - 3px), transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 0%, black calc(100% - 3px), transparent 100%)' }}>
        {segments}
      </div>
    ) : null
  }

  return (
    <button onClick={() => setShowTimeline(false)} className="w-full h-8 flex items-center justify-between px-2 bg-bg-primary/50 rounded-md text-xs font-medium text-text-secondary hover:bg-bg-primary transition-colors">
      <span className="flex items-center gap-1.5"><RotateCcw size={10} /> Timeline</span>
      {step === 'plan' && (
        <span className="text-[9px] px-1.5 py-0.25 bg-accent-blue/10 text-accent-blue rounded-full border border-accent-blue/30">Clique para editar</span>
      )}
    </button>

    {/* Timeline editor — only shown when collapsed */}
    <div className="mt-0.5 space-y-2 bg-bg-primary/50 rounded-md overflow-hidden transition-all">
      <div className="flex items-center justify-between px-2 py-1 border-b border-input-field text-xs text-text-secondary">
        <span>Seções</span>
        <span className="text-[10px] text-text-muted">{plannedClips.length} clips</span>
      </div>

      {/* Timeline bar */}
      {renderTimelineBar()}

      {/* Section labels list */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1">
        {!analysisMemo ? (
          <span className="text-xs text-text-muted">Analisando áudio...</span>
        ) : plannedClips.length === 0 ? (
          <span className="text-xs text-text-muted">Nenhum clip planejado</span>
        ) : (
          <>
            {sectionLabels.map(label => {
              const clipsInSection = plannedClips.filter(c => c.section_label === label)
              return (
                <button key={label} className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${colorMap[label] || 'bg-bg-hover'} hover:opacity-80`} title={`${sectionLabels.find(l => l === label)?.toUpperCase()} — ${clipsInSection.length}`}>
                  {label} ({clipsInSection.length})
                </button>
              )
            })}
          </>
        )}
      </div>

      {/* Clip list (editable in plan step) */}
      <div className="space-y-1 max-h-[20vh] overflow-y-auto custom-scrollbar px-2">
        {!plannedClips.length ? (
          <span className="text-xs text-text-muted">Nenhum clip planejado</span>
        ) : (
          plannedClips.map((clip, i) => (
            <div key={i} className={`flex items-center justify-between text-[10px] px-2 py-1 rounded-md transition-colors ${step === 'plan' ? 'hover:bg-accent-blue/5 cursor-pointer' : ''}`}>
              <span>{formatTime(clip.start)} – {formatTime(clip.end)}</span>
              <span className={`text-[9px] px-0.75 py-0.25 rounded-full ${colorMap[clip.section_label || 'instrumental'] || 'bg-bg-hover'}`}>
                {clip.section_label || 'inst'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// SVG path for the timeline bar markers (small triangle pointing right)
const M_PATH = "M1,1 L23,11 L1,21 Z M5.5,9 L8.5,14 L6.5,17 Z"