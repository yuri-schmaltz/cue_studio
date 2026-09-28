import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../stores/useStore'
import { formatTimecode, parseTimecode } from '../../lib/durationPlanning'

const DIRECTOR_MUSIC_MODEL_ORDER = [
  'ace_step_v1_5_xl_sft_lm_4b',
  'minimax_music3',
]

// Director Music Video — single card that frames the music model selection,
// the instrumental toggle, and the custom exact duration. The composer below
// owns the descriptive prompt; this panel intentionally stays narrow.
//
// Layout: model <select> (with a per-model category chip under each option)
// shares the same row as the exact-time input, so the whole "pick a model +
// pick a length" decision fits on one line. The historical preset row
// (30s/1m/2m/…) was removed to make room for the inline time field.
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
  // _customText is local draft state for the mm:ss field. We commit on blur
  // or Enter; Escape reverts the draft to whatever the store currently holds.
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

  return (
    <section
      className="h-full min-h-[96px] bg-bg-tertiary rounded-lg p-3 border border-border space-y-1.5"
      aria-label="Song generation settings"
    >
      {/* Row: model <select> + exact-time mm:ss input share one line.
          The category chip below the row gives each model its own hint
          without occupying a second row of vertical real estate. */}
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
            <div className="flex items-center gap-2">
              <select
                id="music-model-select"
                value={effectiveModel}
                onChange={e => setMusicModel(e.target.value)}
                className="flex-1 min-w-0 bg-bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-violet-500 transition-colors"
              >
                {musicModels.map(model => {
                  // The bare model name is enough to identify the option
                  // inside the closed <select>. The category line ("Quality-
                  // focused CFG with 4B LM" / "Fast melody & vocal
                  // generation") lives in a separate row below so the
                  // selected option text never spills over the dropdown.
                  return (
                    <option key={model.model_type} value={model.model_type}>
                      {model.name}
                    </option>
                  )
                })}
              </select>
              {!hideSongLength && (
                <input
                  ref={inputRef}
                  type="text"
                  aria-label="Custom song length"
                  title="Custom song length (mm:ss)"
                  value={customText !== null ? customText : formatTimecode(duration).slice(3)}
                  onChange={e => {
                    setCustomText(e.target.value)
                  }}
                  onFocus={() => {
                    if (customText === null) {
                      setCustomText(formatTimecode(duration).slice(3))
                    }
                    requestAnimationFrame(() => inputRef.current?.select())
                  }}
                  onBlur={handleCommitCustom}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCommitCustom()
                    if (e.key === 'Escape') {
                      setCustomText(null)
                    }
                  }}
                  placeholder="02:00"
                  className={`w-20 shrink-0 bg-bg-secondary border rounded-md px-2 py-1 text-xs text-text-primary font-mono text-center focus:outline-none transition-colors ${
                    isCustom
                      ? 'border-violet-500 ring-1 ring-violet-500/30'
                      : 'border-border focus:border-violet-500'
                  }`}
                />
              )}
            </div>
          </>
        ) : (
          <p className="text-2xs text-amber-400">
            Enable ACE-Step or MiniMax-Music3 in Settings → System → Enabled Models.
          </p>
        )}
      </div>
    </section>
  )
}
