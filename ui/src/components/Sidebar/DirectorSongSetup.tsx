import { useState, useEffect, useRef } from 'react'
import { Clock, Music, Sparkles, ChevronDown, ChevronUp, Loader2, Play, ListPlus, Settings } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { formatTimecode, parseTimecode } from '../../lib/durationPlanning'

const DIRECTOR_MUSIC_MODEL_ORDER = [
  'ace_step_v1_5_xl_sft_lm_4b',
  'minimax_music3',
]

const QUICK_DURATIONS = [
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '2m', seconds: 120 },
  { label: '3m', seconds: 180 },
]

const STYLE_PRESETS = [
  'Dark Synthwave, Cyberpunk',
  'Lo-Fi Beats, Relaxing',
  'Epic Orchestral, Cinematic',
  'Acoustic Indie Rock',
  'Trap & Hip-Hop, Deep Bass',
  'Ambient Dream Pop',
]

export function DirectorSongSetup({ hideSongLength = false }: { hideSongLength?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const models = useStore(s => s.models)
  const enabledModels = useStore(s => s.enabledModels)
  const nsfwMode = useStore(s => s.servicesConfig?.nsfw_mode ?? false)
  const musicModel = useStore(s => s.directorMusicModel)
  const setMusicModel = useStore(s => s.setDirectorMusicModel)
  const instrumental = useStore(s => s.directorSongInstrumental)
  const setInstrumental = useStore(s => s.setDirectorSongInstrumental)
  const duration = useStore(s => s.directorSongDuration)
  const setDuration = useStore(s => s.setDirectorSongDuration)

  const songDescription = useStore(s => s.directorSongDescription)
  const setSongDescription = useStore(s => s.setDirectorSongDescription)
  const songStyle = useStore(s => s.directorSongStyle)
  const setSongStyle = useStore(s => s.setDirectorSongStyle)
  const songLyrics = useStore(s => s.directorSongLyrics)
  const setSongLyrics = useStore(s => s.setDirectorSongLyrics)

  const generateTrack = useStore(s => s.directorGenerateTrack)
  const loading = useStore(s => s.directorLoading || s.directorTrackGenerating)
  const loadingMessage = useStore(s => s.directorLoadingMessage)
  const activityLabel = useStore(s => s.directorActivityLabel)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const setAppSection = useStore(s => s.setAppSection)

  const [showLyrics, setShowLyrics] = useState(false)
  const [customText, setCustomText] = useState<string | null>(null)
  const isCustom = customText !== null

  const musicModels = DIRECTOR_MUSIC_MODEL_ORDER
    .map(modelType => models.find(model => model.model_type === modelType))
    .filter(model => model != null)
    .filter(model => enabledModels.has(model.model_type))
    .filter(model => !model.nsfw_only || nsfwMode)

  const effectiveModel = musicModels.some(model => model.model_type === musicModel)
    ? musicModel
    : (musicModels[0]?.model_type || '')
  const selectedModel = musicModels.find(model => model.model_type === effectiveModel)
  const isMusic3 = selectedModel?.architecture === 'minimax_music3'
  const maximumDuration = isMusic3 ? 300 : 360

  useEffect(() => {
    if (effectiveModel && effectiveModel !== musicModel) {
      setMusicModel(effectiveModel)
    }
  }, [effectiveModel, musicModel, setMusicModel])

  useEffect(() => {
    const bounded = Math.min(maximumDuration, Math.max(5, duration))
    if (bounded !== duration) setDuration(bounded)
  }, [duration, maximumDuration, setDuration])

  const handleCommitCustom = () => {
    const text = (customText ?? formatTimecode(duration).slice(3)).trim()
    const parsed = parseTimecode(text)
    if (parsed != null) {
      const bounded = Math.min(maximumDuration, Math.max(5, Math.round(parsed)))
      setDuration(bounded)
      setCustomText(formatTimecode(bounded).slice(3))
    } else {
      setCustomText(formatTimecode(duration).slice(3))
    }
  }

  const canGenerate = (songDescription.trim() || songStyle.trim() || (!instrumental && songLyrics.trim())) && !loading

  return (
    <section
      className="bg-bg-tertiary rounded-lg p-3.5 border border-border space-y-3 shadow-sm transition-all"
      aria-label="Song generation settings"
    >
      {/* 1. Header & Modelo */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="music-model-select"
            className="flex items-center gap-1.5 text-xs text-text-muted uppercase tracking-wider font-semibold"
          >
            <Music size={13} className="text-violet-400" />
            <span>Modelo & Formato</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-text-secondary hover:text-text-primary transition-colors select-none">
            <input
              type="checkbox"
              checked={instrumental}
              onChange={e => setInstrumental(e.target.checked)}
              className="accent-violet-500 rounded cursor-pointer"
            />
            <span className="font-medium">Apenas Instrumental</span>
          </label>
        </div>

        {musicModels.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              id="music-model-select"
              value={effectiveModel}
              onChange={e => setMusicModel(e.target.value)}
              className="flex-1 min-w-0 bg-bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-violet-500 transition-colors"
            >
              {musicModels.map(model => (
                <option key={model.model_type} value={model.model_type}>
                  {model.name}
                </option>
              ))}
            </select>

            {!hideSongLength && (
              <div className="flex items-center gap-1 shrink-0 bg-bg-secondary border border-border rounded-lg px-2 py-1">
                <Clock size={12} className="text-text-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  aria-label="Custom song length"
                  title="Custom song length (mm:ss)"
                  value={customText !== null ? customText : formatTimecode(duration).slice(3)}
                  onChange={e => setCustomText(e.target.value)}
                  onFocus={() => {
                    if (customText === null) {
                      setCustomText(formatTimecode(duration).slice(3))
                    }
                    requestAnimationFrame(() => inputRef.current?.select())
                  }}
                  onBlur={handleCommitCustom}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCommitCustom()
                    if (e.key === 'Escape') setCustomText(null)
                  }}
                  placeholder="02:00"
                  className="w-12 bg-transparent text-xs text-text-primary font-mono text-center focus:outline-none"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300 flex items-center justify-between gap-2">
            <span>Modelos ACE-Step / MiniMax não habilitados</span>
            <button
              type="button"
              onClick={() => {
                setAppSection('configurations')
                setSettingsOpen(true)
              }}
              className="flex items-center gap-1 px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded text-2xs font-medium transition-colors"
            >
              <Settings size={11} />
              Configurar
            </button>
          </div>
        )}

        {/* Chips de duração rápida */}
        {!hideSongLength && (
          <div className="flex items-center gap-1.5 pt-0.5">
            <span className="text-2xs text-text-muted mr-1">Duração:</span>
            {QUICK_DURATIONS.map(q => (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  setDuration(q.seconds)
                  setCustomText(null)
                }}
                className={`px-2 py-0.5 rounded text-2xs font-mono transition-colors border ${
                  duration === q.seconds && !isCustom
                    ? 'bg-violet-500/20 border-violet-500/50 text-violet-300 font-semibold'
                    : 'bg-bg-secondary/60 border-border text-text-muted hover:text-text-primary'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Gênero / Estilo musical */}
      <div className="space-y-1.5">
        <label className="text-xs text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1">
          <Sparkles size={12} className="text-violet-400" />
          <span>Gênero &amp; Estilo Musical</span>
        </label>
        <input
          type="text"
          value={songStyle}
          onChange={e => setSongStyle(e.target.value)}
          placeholder="ex: Dark Synthwave, retro 80s, heavy drums, 120 bpm"
          className="w-full bg-bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-violet-500 transition-colors"
        />
        {/* Sugestões rápidas de estilo */}
        <div className="flex flex-wrap gap-1 pt-0.5">
          {STYLE_PRESETS.map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => setSongStyle(preset)}
              className="text-2xs px-2 py-0.5 rounded bg-bg-secondary hover:bg-bg-hover text-text-muted hover:text-text-secondary border border-border/60 transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Tema & Descrição Criativa da Trilha */}
      <div className="space-y-1.5">
        <label className="text-xs text-text-muted uppercase tracking-wider font-semibold">
          Tema &amp; Atmosfera da Faixa
        </label>
        <textarea
          rows={3}
          value={songDescription}
          onChange={e => setSongDescription(e.target.value)}
          placeholder="Descreva a atmosfera da música, instrumentos em destaque, ritmo e a progressão sonora do vídeo..."
          className="w-full bg-bg-secondary border border-border rounded-lg p-2.5 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-violet-500 transition-colors"
        />
      </div>

      {/* 4. Letra Personalizada (Opcional) */}
      {!instrumental && (
        <div className="border-t border-border/50 pt-2 space-y-1.5">
          <button
            type="button"
            onClick={() => setShowLyrics(!showLyrics)}
            className="flex items-center justify-between w-full text-xs text-text-secondary hover:text-text-primary transition-colors py-1"
          >
            <span className="font-medium flex items-center gap-1">
              {showLyrics ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              <span>Letra / Vocais Personalizados {songLyrics.trim() && '(preenchido)'}</span>
            </span>
            <span className="text-2xs text-text-muted">Opcional</span>
          </button>
          {showLyrics && (
            <textarea
              rows={4}
              value={songLyrics}
              onChange={e => setSongLyrics(e.target.value)}
              placeholder="Cole os versos ou estrutura lírica [Verse], [Chorus]..."
              className="w-full bg-bg-secondary border border-border rounded-lg p-2.5 text-xs text-text-primary font-mono placeholder:text-text-muted resize-none focus:outline-none focus:border-violet-500 transition-colors"
            />
          )}
        </div>
      )}

      {/* 5. Ações de Início & Fila */}
      <div className="pt-2 border-t border-border/50 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void generateTrack('now')}
            disabled={!canGenerate}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs shadow transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Compor a faixa com IA e iniciar imediatamente o planejamento de cenas"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin text-white" />
            ) : (
              <Play size={14} className="fill-current" />
            )}
            <span>{loading ? 'Gerando…' : 'Gerar Trilha'}</span>
          </button>

          <button
            type="button"
            onClick={() => void generateTrack('queue')}
            disabled={!canGenerate}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-primary border border-border font-medium text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Compor a faixa e guardar o projeto na fila"
          >
            <ListPlus size={14} className="text-violet-400" />
            <span>Adicionar à Fila</span>
          </button>
        </div>

        {/* Feedback de execução ao vivo */}
        {loading && (
          <div className="rounded-lg bg-violet-950/40 border border-violet-500/30 p-2 text-2xs text-violet-300 flex items-center gap-2 animate-pulse">
            <Loader2 size={12} className="animate-spin shrink-0 text-violet-400" />
            <span className="truncate">{loadingMessage || activityLabel || 'Sintetizando áudio com IA…'}</span>
          </div>
        )}
      </div>
    </section>
  )
}

