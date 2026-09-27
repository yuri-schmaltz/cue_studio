import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../stores/useStore'
import { formatDuration, formatTimecode, parseTimecode } from '../../lib/durationPlanning'

const DIRECTOR_MUSIC_MODEL_ORDER = [
  'ace_step_v1_5_xl_sft_lm_4b',
  'minimax_music3',
]

// Director Music Video — "Generate a track" up-front options. The description
// itself is typed into the bottom composer (its Send button kicks off the whole
// write-song → render → analyze → video chain), so this panel cleanly frames the
// model selection, instrumental mode, and target song duration.
export function DirectorSongSetup() {
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

  const songPresets = [
    { label: '30s', seconds: 30 },
    { label: '1m', seconds: 60 },
    { label: '2m', seconds: 120 },
    { label: '3m', seconds: 180 },
    { label: '4m', seconds: 240 },
    { label: '5m', seconds: 300 },
    ...(maximumDuration >= 360 ? [{ label: '6m', seconds: 360 }] : []),
  ]

  const isPresetMatch = songPresets.some(p => p.seconds === duration)
  const [isCustom, setIsCustom] = useState(!isPresetMatch)
  const [customText, setCustomText] = useState<string | null>(null)

  useEffect(() => {
    if (effectiveModel && effectiveModel !== musicModel) {
      setMusicModel(effectiveModel)
    }
  }, [effectiveModel, musicModel, setMusicModel])

  useEffect(() => {
    const bounded = Math.min(maximumDuration, Math.max(5, duration))
    if (bounded !== duration) setDuration(bounded)
  }, [duration, maximumDuration, setDuration])

  const handleSelectPreset = (secs: number) => {
    setIsCustom(false)
    setCustomText(null)
    setDuration(secs)
  }

  const handleSelectCustom = () => {
    setIsCustom(true)
    setCustomText(formatTimecode(duration).slice(3))
    inputRef.current?.focus()
    inputRef.current?.select()
  }

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

  return (
    <section
      className="bg-bg-tertiary rounded-lg p-3 border border-border space-y-3"
      aria-label="Song generation settings"
    >
      {/* Row 1: Model selector + Instrumental toggle */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="music-model-select"
            className="text-xs text-text-muted uppercase tracking-wider font-medium"
          >
            Music model
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-text-secondary hover:text-text-primary transition-colors select-none">
            <input
              type="checkbox"
              checked={instrumental}
              onChange={e => setInstrumental(e.target.checked)}
              className="accent-violet-500 rounded cursor-pointer"
            />
            <span>Instrumental</span>
          </label>
        </div>

        {musicModels.length > 0 ? (
          <>
            <select
              id="music-model-select"
              value={effectiveModel}
              onChange={e => setMusicModel(e.target.value)}
              className="w-full bg-bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-violet-500 transition-colors"
            >
              {musicModels.map(model => (
                <option key={model.model_type} value={model.model_type}>
                  {model.name}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-between gap-2 text-2xs text-text-muted px-0.5">
              <span
                className="truncate"
                title={selectedModel?.selector_help || selectedModel?.description}
              >
                {isMusic3
                  ? 'Fast melody & vocal generation · 5m max'
                  : 'Quality-focused CFG with 4B LM · 6m max'}
              </span>
              {selectedModel?.is_downloaded === false && (
                <span className="shrink-0 text-amber-400 font-medium">
                  Downloads on first use
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="text-2xs text-amber-400">
            Enable ACE-Step or MiniMax-Music3 in Settings → System → Enabled Models.
          </p>
        )}
      </div>

      {/* Row 2: Song duration presets & Custom exact duration */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-text-muted uppercase tracking-wider font-medium">
            Song length
          </label>
          <span className="text-xs text-text-secondary tabular-nums font-mono font-medium">
            {formatDuration(duration, true)}
          </span>
        </div>

        {/* Standard duration preset pills row */}
        <div className="flex items-center gap-1.5">
          {songPresets.map(p => {
            const isActive = !isCustom && duration === p.seconds
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => handleSelectPreset(p.seconds)}
                className={`flex-1 py-1.5 rounded-md border text-xs font-medium transition-colors text-center truncate ${
                  isActive
                    ? 'border-violet-500 bg-violet-600/25 text-white shadow-sm'
                    : 'border-border bg-bg-secondary text-text-secondary hover:text-text-primary hover:border-border-light'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        {/* Custom duration button + exact duration input row (always visible) */}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={handleSelectCustom}
            className={`px-3 py-1 rounded-md border text-xs font-medium transition-colors text-center shrink-0 ${
              isCustom
                ? 'border-violet-500 bg-violet-600/25 text-white shadow-sm'
                : 'border-border bg-bg-secondary text-text-secondary hover:text-text-primary hover:border-border-light'
            }`}
          >
            Custom
          </button>
          <input
            ref={inputRef}
            type="text"
            value={customText !== null ? customText : formatTimecode(duration).slice(3)}
            onChange={e => {
              setCustomText(e.target.value)
              setIsCustom(true)
            }}
            onFocus={() => {
              if (customText === null) {
                setCustomText(formatTimecode(duration).slice(3))
              }
            }}
            onBlur={handleCommitCustom}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCommitCustom()
              if (e.key === 'Escape') {
                setCustomText(null)
                if (isPresetMatch) setIsCustom(false)
              }
            }}
            placeholder="02:00"
            className={`w-20 bg-bg-secondary border rounded-md px-2.5 py-1 text-xs text-text-primary font-mono text-center focus:outline-none transition-colors ${
              isCustom
                ? 'border-violet-500 ring-1 ring-violet-500/30'
                : 'border-border focus:border-violet-500'
            }`}
          />
          <span className="text-2xs text-text-muted select-none">
            Exact duration (max {formatDuration(maximumDuration, true)})
          </span>
        </div>
      </div>
    </section>
  )
}
